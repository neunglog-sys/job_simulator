import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence } from "motion/react";
import { AiAvatarStage } from "../components/conversation/AiAvatarStage";
import { AvatarStatusBadge } from "../components/conversation/AvatarStatusBadge";
import { ConversationHistoryModal } from "../components/conversation/ConversationHistoryModal";
import { ConversationHeader } from "../components/conversation/ConversationHeader";
import { ConversationPanel } from "../components/conversation/ConversationPanel";
import { CoachSelectionDialog } from "../components/conversation/CoachSelectionDialog";
import { FinalReportPanel } from "../components/conversation/FinalReportPanel";
import { FixedNavigationMenu } from "../components/conversation/FixedNavigationMenu";
import { PanelIndexTabs } from "../components/conversation/PanelIndexTabs";
import { RecommendedJobsModal } from "../components/conversation/RecommendedJobsModal";
import { SurveyDrawer } from "../components/conversation/SurveyDrawer";
import {
  VirtualCompanyGateModal,
  type VirtualCompanyGateReason,
} from "../components/conversation/VirtualCompanyGateModal";
import { YouthPolicyCard } from "../components/conversation/YouthPolicyCard";
import { YouthPolicyModal } from "../components/conversation/YouthPolicyModal";
import { FRONTEND_ENDPOINTS } from "../config/endpoints";
import { initialConversationMessages } from "../data/conversationMockData";
import {
  ApiError,
  attachStoredResume,
  createConsultation,
  createRecommendation,
  createReport,
  deleteConsultation,
  fetchAvatarStatus,
  fetchConsultations,
  fetchConsultationMessages,
  fetchLatestRecommendation,
  fetchReport,
  fetchScenarios,
  fetchSurveyItems,
  generateMuseTalkBlob,
  streamAvatarSpeakChunks,
  streamConsultationReply,
  submitConsultationSurvey,
  updateConsultationTitle,
  type AvatarProvider,
  type ConsultationStreamDoneMetrics,
  type SurveyItem,
  type ConsultationSummary,
  type Recommendation,
  type MuseTalkSpeakRequest,
  type ScenarioSummary,
} from "../lib/api";
import {
  getStoredCoachId,
  saveCoachId,
  type CoachAvatarId,
} from "../lib/coachPreference";
import styles from "../styles/oneToOneConversation.module.css";
import { INITIAL_REPORT_STATE } from "../types/conversation";
import type {
  AvatarStatus,
  ActiveConversationPanel,
  ConversationMessage,
  NavigationMenuId,
  RecordingState,
  ReportState,
} from "../types/conversation";
import type { SurveyAnswers, SurveyQuestionData } from "../types/survey";

// 진행 중이던 상담 id를 기억해 이어받는다 — 새로고침마다 새 상담을 만들면 대화 이력이 날아간다.
const CONSULTATION_RESUME_KEY = "consultation:current";

type ActiveConversationModal =
  | "history"
  | "recommendations"
  | "virtualCompanyGate"
  | "youthPolicy"
  | null;

type ConversationPerfTrace = {
  id: string;
  sent_at: number;
  llm_first_token_at?: number;
  llm_done_at?: number;
  avatar_started_at?: number;
  user_chars: number;
  llm_output_chars?: number;
  avatar_speech_chars?: number;
  server?: ConsultationStreamDoneMetrics;
};

type AvatarSpeechMedia = {
  url: string;
  displayCharacters: number;
};

function splitMuseTalkSpeech(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const sentenceMatches =
    normalized.match(/[^.!?。！？]+[.!?。！？]?/g)?.map((sentence) => sentence.trim()) ??
    [normalized];
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    const chunk = current.trim();
    if (chunk) chunks.push(chunk);
    current = "";
  };

  const pushLongSentence = (sentence: string) => {
    const words = sentence.split(" ");
    let buffer = "";
    for (const word of words) {
      const candidate = buffer ? `${buffer} ${word}` : word;
      if (candidate.length <= MUSE_TALK_CHUNK_MAX_CHARS) {
        buffer = candidate;
        continue;
      }
      if (buffer) chunks.push(buffer);
      buffer = word;
    }
    if (buffer) chunks.push(buffer);
  };

  for (const sentence of sentenceMatches) {
    if (!sentence) continue;
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= MUSE_TALK_CHUNK_MAX_CHARS) {
      current = candidate;
      continue;
    }

    pushCurrent();
    if (sentence.length > MUSE_TALK_CHUNK_MAX_CHARS) pushLongSentence(sentence);
    else current = sentence;
  }

  pushCurrent();
  return chunks.length > 0 ? chunks : [normalized];
}

function takeCompletedMuseTalkSentences(
  text: string,
  force = false,
): { chunks: string[]; rest: string } {
  const matches = Array.from(text.matchAll(/[.!?。！？]\s*/g));
  const lastBoundary = matches.at(-1);
  const boundaryEnd =
    lastBoundary && lastBoundary.index !== undefined
      ? lastBoundary.index + lastBoundary[0].length
      : -1;

  if (boundaryEnd > 0) {
    return {
      chunks: splitMuseTalkSpeech(text.slice(0, boundaryEnd)),
      rest: text.slice(boundaryEnd),
    };
  }

  if (force && text.trim()) {
    return { chunks: splitMuseTalkSpeech(text), rest: "" };
  }

  return { chunks: [], rest: text };
}

function toAvatarSpeechText(text: string): string {
  const normalized = text
    .replace(/\*\*/g, "")
    .replace(/[`*_~>#-]/g, "")
    .replace(/\[[^\]]+\]\([^)]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";

  const sentences =
    normalized.match(/[^.!?。！？]+[.!?。！？]?/g)?.map((sentence) => sentence.trim()) ??
    [normalized];
  const selected: string[] = [];
  let totalLength = 0;

  for (const sentence of sentences) {
    const candidateLength = totalLength + sentence.length;
    if (selected.length >= AVATAR_SPEECH_MAX_SENTENCES) break;
    if (candidateLength > AVATAR_SPEECH_MAX_CHARS && selected.length > 0) break;
    selected.push(sentence);
    totalLength = candidateLength;
  }

  const speech = selected.join(" ").trim();
  if (speech.length <= AVATAR_SPEECH_MAX_CHARS) return speech;

  const limited = speech.slice(0, AVATAR_SPEECH_MAX_CHARS);
  const naturalEnd = Math.max(
    limited.lastIndexOf("."),
    limited.lastIndexOf("!"),
    limited.lastIndexOf("?"),
    limited.lastIndexOf("。"),
    limited.lastIndexOf("！"),
    limited.lastIndexOf("？"),
  );

  return naturalEnd > AVATAR_SPEECH_MAX_CHARS * 0.55
    ? limited.slice(0, naturalEnd + 1).trim()
    : // 마침표를 붙일 1자를 미리 깎는다. limited가 정확히 420자이고 끝이 쉼표/공백이
      // 아니면 replace가 no-op이라 421자가 되고, 청크 분할기(420자 상한)가 2청크로 쪼개
      // flush를 꺼도 프리페치 동시 WS 경로가 살아난다.
      `${limited.slice(0, AVATAR_SPEECH_MAX_CHARS - 1).replace(/[,\s]+$/g, "")}.`;
}

function toSurveyQuestions(items: SurveyItem[]): SurveyQuestionData[] {
  return items.map((item) => ({
    id: item.id,
    prompt: item.text,
    options: item.options.map((option) => ({ value: option.key, label: option.label })),
  }));
}

async function resumeOrCreateConsultation(): Promise<number> {
  const saved = Number(sessionStorage.getItem(CONSULTATION_RESUME_KEY));
  if (saved) {
    try {
      await fetchConsultationMessages(saved); // 존재·소유권 확인 겸용
      return saved;
    } catch {
      sessionStorage.removeItem(CONSULTATION_RESUME_KEY);
    }
  }
  const consultation = await createConsultation();
  sessionStorage.setItem(CONSULTATION_RESUME_KEY, String(consultation.id));
  return consultation.id;
}

type StageStyle = CSSProperties & {
  "--conversation-scale": number;
};

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionEventLike = Event & {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
};

type SpeechRecognitionErrorEventLike = Event & {
  readonly error: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 900;
const VOICE_LEVEL_THRESHOLD = 0.025;
const VOICE_START_GRACE_MS = 1_400;
const VOICE_SILENCE_TIMEOUT_MS = 2_800;
const VOICE_EQUALIZER_BAND_COUNT = 9;
const MUSE_TALK_CHUNK_MAX_CHARS = 420;
/** LLM 답변을 문장 단위로 쪼개 **먼저 나온 문장부터** 아바타에 보낼지.
 *
 * 2026-07-26 실측(같은 문장, 같은 서버):
 *   한 번에 25.8초 생성 → 립싱크 상관 0.291, 입 변화 σ 2.03, lag −3(불안정)
 *   문장 4개로 쪼갬     → 상관 0.561~0.729, σ 2.71~3.12, lag 0~+1(안정)
 * 원인은 datagen이 latent를 `(i + delay_frame) % 298`로 고르는 데 있다. 긴 발화는
 * 페르소나 사이클을 2바퀴 넘게 돌아 같은 latent가 4~5번 반복 입력되고, 그만큼
 * 모델이 만드는 입 모양의 다양성이 줄어든다.
 *
 * ⚠️ 켜면 다중 청크가 실제로 발생한다. 문장 사이 머리가 튀지 않으려면 각 청크가
 *    같은 session_id와 순번(seq)을 달고 나가야 한다 — enqueueMuseTalkChunk가
 *    세션을 자동 시작하고, 답변이 끝나거나 중단되면 닫는다.
 *    (이 부분은 동작이 확인됐다: 서버 로그에서 seq0 start_frame=367 → seq1 start_frame=412로 이어짐)
 *
 * 🔴 그래서 지금은 **꺼 둔다.** 2026-07-26 실측에서 첫 재생이 오히려 12.7초로 악화됐다
 *    (기준선: 7/23 프로덕션 N=40 p50 7.83초).
 *
 *    지연이 어디서 나는지는 4가지 조건으로 좁혀 뒀고, 서버와 터널은 무죄로 확정됐다.
 *      코랩 로컬 · 단독       첫 바이트 0.69s
 *      코랩 로컬 · 동시 2청크  첫 바이트 0.675s / 2.03s
 *      터널 경유 · 단독       첫 바이트 1.22s
 *      터널 경유 · 동시 2청크  첫 바이트 1.18s / 2.42s   ← 브라우저와 완전히 같은 조건
 *      실제 브라우저 · 동시 2청크 첫 바이트 10.9s        ← 여기서만 느리다
 *    코랩 서버는 어느 경우에도 0.83~1.03초에 첫 바이트를 내보냈다(로그 14/14).
 *    남은 구간은 nginx → FastAPI 릴레이 → 브라우저뿐이다. 릴레이는 투명 펌프라
 *    `await client_ws.send_text()`가 막히면 그만큼 첫 바이너리 기록도 밀린다
 *    (services/api/app/domains/avatar/service.py 의 upstream_to_client).
 *    → 브라우저가 소켓을 제때 안 비우는 쪽이 유력하다. 별도로 규명한 뒤 다시 켠다.
 *
 *    끄면 청크가 1개뿐이라 session_id/seq 경로는 그대로 두어도 무해하다. */
const MUSE_TALK_STREAM_SENTENCE_FLUSH = false;
const AVATAR_SPEECH_MAX_SENTENCES = 5;
const AVATAR_SPEECH_MAX_CHARS = 420;
const TEXT_REVEAL_FALLBACK_MS_PER_CHARACTER = 72;
const TEXT_REVEAL_MIN_MS_PER_CHARACTER = 24;
const TEXT_REVEAL_MAX_MS_PER_CHARACTER = 120;

const STAR_POINTS = Array.from({ length: 54 }, (_, index) => ({
  left: `${(index * 37 + 7) % 98}%`,
  top: `${(index * 61 + 5) % 92}%`,
  size: index % 13 === 0 ? 3 : index % 5 === 0 ? 2 : 1,
  delay: `${-(index % 9) * 0.38}s`,
}));

export function OneToOneConversationPage() {
  const [stageScale, setStageScale] = useState(1);
  const [selectedCoachId, setSelectedCoachId] = useState<CoachAvatarId | null>(
    () => getStoredCoachId(),
  );
  const [isCoachSelectionOpen, setIsCoachSelectionOpen] = useState(
    () => getStoredCoachId() === null,
  );
  const activeCoachId = selectedCoachId ?? "male";
  const selectedCoachIdRef = useRef<CoachAvatarId>(activeCoachId);
  const [messages, setMessages] = useState<ConversationMessage[]>(initialConversationMessages);
  const [inputValue, setInputValue] = useState("");
  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus>("thinking");
  const [avatarSpeechMedia, setAvatarSpeechMedia] = useState<AvatarSpeechMedia | null>(null);
  const avatarHlsUrl = avatarSpeechMedia?.url ?? null;
  const [avatarProvider, setAvatarProvider] = useState<AvatarProvider | null>(null);
  // AiAvatarStage의 MuseTalkStageRequest와 같은 모양이어야 한다
  // (session_id·seq를 실어 보내야 서버가 청크 순서를 강제할 수 있다).
  const [museTalkRequest, setMuseTalkRequest] =
    useState<
      (MuseTalkSpeakRequest & { id: number; displayCharacters: number }) | null
    >(null);
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [voiceIssue, setVoiceIssue] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<ActiveConversationPanel>("chat");
  const [surveyAnswers, setSurveyAnswers] = useState<SurveyAnswers>({});
  const [surveyCompleted, setSurveyCompleted] = useState(false);
  const [activeMenuId, setActiveMenuId] =
    useState<NavigationMenuId>("new-consultation");
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [voiceBands, setVoiceBands] = useState<number[]>(
    () => Array.from({ length: VOICE_EQUALIZER_BAND_COUNT }, () => 0),
  );
  const [consultationId, setConsultationId] = useState<number | null>(null);
  const [surveyQuestions, setSurveyQuestions] = useState<SurveyQuestionData[]>([]);
  const [surveySubmitting, setSurveySubmitting] = useState(false);
  const [surveyError, setSurveyError] = useState<string | null>(null);
  const [reportState, setReportState] = useState<ReportState>(INITIAL_REPORT_STATE);
  const [activeModal, setActiveModal] = useState<ActiveConversationModal>(null);
  const [virtualCompanyGateReason, setVirtualCompanyGateReason] =
    useState<VirtualCompanyGateReason>("survey");
  const [consultationHistory, setConsultationHistory] = useState<ConsultationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [scenarioSummaries, setScenarioSummaries] = useState<ScenarioSummary[]>([]);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  const [recommendationNeedsMoreChat, setRecommendationNeedsMoreChat] = useState(false);
  const [recommendationFollowupQuestions, setRecommendationFollowupQuestions] =
    useState<string[]>([]);
  const sendingRef = useRef(false);
  const recommendationCacheRef = useRef<Recommendation | null>(null);
  const recommendationRequestRef = useRef<{
    consultationId: number;
    promise: Promise<Recommendation>;
  } | null>(null);
  const perfTraceRef = useRef<ConversationPerfTrace | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceAudioContextRef = useRef<AudioContext | null>(null);
  const voiceSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const voiceAnimationFrameRef = useRef<number | null>(null);
  const voiceProcessingTimerRef = useRef<number | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceSessionActiveRef = useRef(false);
  const voiceInputBaseRef = useRef("");
  const voiceFinalTranscriptRef = useRef("");
  const avatarQueueRef = useRef<AvatarSpeechMedia[]>([]);
  const avatarPlayingRef = useRef(false);
  /** 한 답변을 묶는 식별자와 청크 순번.
   *
   * 문장 단위로 쪼개진 청크들이 같은 session_id를 공유하고 seq로 재생 순서를 알린다.
   * 서버가 그 순서대로 줄을 세워 앞 청크가 끝난 프레임에서 이어붙이므로,
   * 문장이 바뀔 때 머리가 튀지 않는다(실측 이음새 22.0dB → 37.8dB).
   * 순서를 클라이언트가 추정할 수 없어서(프리페치가 병렬로 돈다) 서버에 맡긴다. */
  const speechSessionIdRef = useRef<string>("");
  const speechSeqRef = useRef(0);
  const museTalkRequestIdRef = useRef(0);
  const museTalkPrefetchGenerationRef = useRef(0);
  /** 아직 생성하지 않은 청크 대기열. 텍스트만이 아니라 **순번까지** 들고 있어야
   *  프리페치가 서버에 재생 순서를 알려줄 수 있다. */
  const museTalkPendingTextRef = useRef<
    Array<{ text: string; sessionId: string; seq: number }>
  >([]);
  const museTalkPrefetchRunningRef = useRef(false);
  const museTalkBlobUrlsRef = useRef<string[]>([]);
  const avatarSpeakGenerationRef = useRef(0);
  const avatarSpeakPendingTextRef = useRef<
    Array<{ speech: string; displayCharacters: number }>
  >([]);
  const avatarSpeakRunningRef = useRef(false);
  const synchronizedMessageIdRef = useRef<string | null>(null);
  const synchronizedFullTextRef = useRef("");
  const synchronizedVisibleCharactersRef = useRef(0);
  const synchronizedTargetCharactersRef = useRef(0);
  const synchronizedStreamDoneRef = useRef(false);
  const synchronizedSpeechFailedRef = useRef(false);
  const synchronizedRevealFrameRef = useRef<number | null>(null);
  const synchronizedRevealGenerationRef = useRef(0);

  const revokeMuseTalkBlobUrl = useCallback((url: string | null) => {
    if (!url?.startsWith("blob:")) return;
    URL.revokeObjectURL(url);
    museTalkBlobUrlsRef.current = museTalkBlobUrlsRef.current.filter((item) => item !== url);
  }, []);

  const revokeMuseTalkBlobUrls = useCallback(() => {
    for (const url of museTalkBlobUrlsRef.current) URL.revokeObjectURL(url);
    museTalkBlobUrlsRef.current = [];
  }, []);

  const cancelSynchronizedTextReveal = useCallback(() => {
    synchronizedRevealGenerationRef.current += 1;
    if (synchronizedRevealFrameRef.current !== null) {
      window.cancelAnimationFrame(synchronizedRevealFrameRef.current);
      synchronizedRevealFrameRef.current = null;
    }
  }, []);

  const renderSynchronizedText = useCallback(
    (visibleCharacters: number, phase: ConversationMessage["phase"] = "streaming") => {
      const messageId = synchronizedMessageIdRef.current;
      if (!messageId) return;

      const safeVisibleCharacters = Math.min(
        synchronizedFullTextRef.current.length,
        Math.max(0, visibleCharacters),
      );
      synchronizedVisibleCharactersRef.current = safeVisibleCharacters;
      const visibleText = synchronizedFullTextRef.current.slice(0, safeVisibleCharacters);
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? { ...message, content: visibleText, phase }
            : message,
        ),
      );
    },
    [],
  );

  const finishSynchronizedTextReveal = useCallback(() => {
    cancelSynchronizedTextReveal();
    const messageId = synchronizedMessageIdRef.current;
    if (!messageId) return;

    const fullText = synchronizedFullTextRef.current;
    synchronizedVisibleCharactersRef.current = fullText.length;
    synchronizedTargetCharactersRef.current = fullText.length;
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? { ...message, content: fullText, phase: undefined }
          : message,
      ),
    );
    synchronizedMessageIdRef.current = null;
  }, [cancelSynchronizedTextReveal]);

  const completeSynchronizedTextSegment = useCallback(() => {
    cancelSynchronizedTextReveal();
    renderSynchronizedText(synchronizedTargetCharactersRef.current);
  }, [cancelSynchronizedTextReveal, renderSynchronizedText]);

  const fallbackToStreamingText = useCallback(() => {
    synchronizedSpeechFailedRef.current = true;
    if (synchronizedStreamDoneRef.current) {
      finishSynchronizedTextReveal();
      return;
    }
    cancelSynchronizedTextReveal();
    renderSynchronizedText(synchronizedFullTextRef.current.length);
  }, [
    cancelSynchronizedTextReveal,
    finishSynchronizedTextReveal,
    renderSynchronizedText,
  ]);

  const startSynchronizedTextReveal = useCallback(
    (displayCharacters: number, durationMs: number | null) => {
      const messageId = synchronizedMessageIdRef.current;
      if (!messageId) return;

      cancelSynchronizedTextReveal();
      const fullLength = synchronizedFullTextRef.current.length;
      const startCharacters = synchronizedVisibleCharactersRef.current;
      const targetCharacters = Math.min(
        fullLength,
        Math.max(
          startCharacters + 1,
          synchronizedTargetCharactersRef.current + Math.max(1, displayCharacters),
        ),
      );
      synchronizedTargetCharactersRef.current = targetCharacters;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        renderSynchronizedText(targetCharacters);
        return;
      }

      const charactersToReveal = targetCharacters - startCharacters;
      if (charactersToReveal <= 0) return;

      const durationPerCharacter =
        durationMs && durationMs > 0
          ? Math.min(
              TEXT_REVEAL_MAX_MS_PER_CHARACTER,
              Math.max(
                TEXT_REVEAL_MIN_MS_PER_CHARACTER,
                durationMs / charactersToReveal,
              ),
            )
          : TEXT_REVEAL_FALLBACK_MS_PER_CHARACTER;
      const revealDuration = Math.max(
        durationPerCharacter,
        charactersToReveal * durationPerCharacter,
      );
      const generation = synchronizedRevealGenerationRef.current;
      const startedAt = window.performance.now();

      renderSynchronizedText(Math.min(targetCharacters, startCharacters + 1));

      const revealNext = (now: number) => {
        if (generation !== synchronizedRevealGenerationRef.current) return;

        const progress = Math.min(1, (now - startedAt) / revealDuration);
        const nextVisibleCharacters = Math.min(
          targetCharacters,
          startCharacters + Math.max(1, Math.floor(charactersToReveal * progress)),
        );
        if (nextVisibleCharacters !== synchronizedVisibleCharactersRef.current) {
          renderSynchronizedText(nextVisibleCharacters);
        }

        if (progress < 1) {
          synchronizedRevealFrameRef.current = window.requestAnimationFrame(revealNext);
        } else {
          synchronizedRevealFrameRef.current = null;
        }
      };

      synchronizedRevealFrameRef.current = window.requestAnimationFrame(revealNext);
    },
    [cancelSynchronizedTextReveal, renderSynchronizedText],
  );

  const resetAvatarSpeech = useCallback(() => {
    museTalkPrefetchGenerationRef.current += 1;
    avatarSpeakGenerationRef.current += 1;
    avatarQueueRef.current = [];
    museTalkPendingTextRef.current = [];
    avatarSpeakPendingTextRef.current = [];
    museTalkPrefetchRunningRef.current = false;
    avatarSpeakRunningRef.current = false;
    // 중단·오류로 발화가 끊기면 세션도 닫는다. 안 닫으면 다음 답변이 죽은 세션의
    // seq를 이어받아 서버가 오지 않을 앞 청크를 기다린다(최대 20초 대기).
    speechSessionIdRef.current = "";
    speechSeqRef.current = 0;
    revokeMuseTalkBlobUrls();
    avatarPlayingRef.current = false;
    setAvatarSpeechMedia(null);
    setMuseTalkRequest(null);
  }, [revokeMuseTalkBlobUrls]);

  const enqueueAvatarSpeech = useCallback((media: AvatarSpeechMedia) => {
    if (!avatarPlayingRef.current) {
      avatarPlayingRef.current = true;
      setAvatarSpeechMedia(media);
      setAvatarStatus("thinking");
      return;
    }
    avatarQueueRef.current.push(media);
  }, []);

  const pumpAvatarSpeakPrefetch = useCallback(
    async (generation: number) => {
      if (avatarSpeakRunningRef.current) return;
      avatarSpeakRunningRef.current = true;

      try {
        while (generation === avatarSpeakGenerationRef.current) {
          const pendingSpeech = avatarSpeakPendingTextRef.current.shift();
          if (!pendingSpeech) return;

          try {
            let allocatedDisplayCharacters = 0;
            await streamAvatarSpeakChunks(
              pendingSpeech.speech,
              (chunk) => {
                if (generation !== avatarSpeakGenerationRef.current) return;
                const remainingDisplayCharacters = Math.max(
                  0,
                  pendingSpeech.displayCharacters - allocatedDisplayCharacters,
                );
                const displayCharacters =
                  chunk.index >= chunk.total - 1
                    ? remainingDisplayCharacters
                    : Math.min(
                        remainingDisplayCharacters,
                        Math.max(
                          1,
                          Math.round(
                            pendingSpeech.displayCharacters *
                              (chunk.text.length / Math.max(1, pendingSpeech.speech.length)),
                          ),
                        ),
                      );
                allocatedDisplayCharacters += displayCharacters;
                enqueueAvatarSpeech({
                  url: chunk.hls_url,
                  displayCharacters,
                });
              },
              { avatarId: selectedCoachIdRef.current },
            );
          } catch (error) {
            if (generation === avatarSpeakGenerationRef.current) {
              console.error("[Avatar]", "stream_prefetch_failed", error);
              fallbackToStreamingText();
              setAvatarStatus("idle");
            }
            return;
          }
        }
      } finally {
        avatarSpeakRunningRef.current = false;
        if (
          generation === avatarSpeakGenerationRef.current &&
          avatarSpeakPendingTextRef.current.length > 0
        ) {
          void pumpAvatarSpeakPrefetch(generation);
        }
      }
    },
    [enqueueAvatarSpeech, fallbackToStreamingText],
  );

  const enqueueAvatarSpeechText = useCallback(
    (text: string, displayCharacters = text.length) => {
      const speech = text.trim();
      if (!speech) return;

      const generation = avatarSpeakGenerationRef.current;
      avatarSpeakPendingTextRef.current.push({
        speech,
        displayCharacters: Math.max(1, displayCharacters),
      });
      void pumpAvatarSpeakPrefetch(generation);
    },
    [pumpAvatarSpeakPrefetch],
  );

  const pumpMuseTalkPrefetch = useCallback(
    async (generation: number) => {
      if (museTalkPrefetchRunningRef.current) return;
      museTalkPrefetchRunningRef.current = true;

      try {
        while (generation === museTalkPrefetchGenerationRef.current) {
          const chunk = museTalkPendingTextRef.current.shift();
          if (!chunk) return;

        try {
          const result = await generateMuseTalkBlob({
            text: chunk.text,
            avatar_id: selectedCoachIdRef.current,
            session_id: chunk.sessionId,
            seq: chunk.seq,
          });
          if (generation !== museTalkPrefetchGenerationRef.current) {
            return;
          }

          const url = URL.createObjectURL(result.blob);
          museTalkBlobUrlsRef.current.push(url);
          console.info("[MuseTalk]", "prefetch_done", {
            pending: museTalkPendingTextRef.current.length,
            bytes: result.bytes,
            elapsed_ms: result.elapsed_ms,
            statuses: result.statuses,
          });
          enqueueAvatarSpeech({
            url,
            displayCharacters: chunk.text.length,
          });
        } catch (error) {
          if (generation === museTalkPrefetchGenerationRef.current) {
            console.error("[MuseTalk]", "prefetch_failed", error);
            fallbackToStreamingText();
          }
          return;
        }
        }
      } finally {
        museTalkPrefetchRunningRef.current = false;
        if (
          generation === museTalkPrefetchGenerationRef.current &&
          museTalkPendingTextRef.current.length > 0
        ) {
          void pumpMuseTalkPrefetch(generation);
        }
      }
    },
    [enqueueAvatarSpeech, fallbackToStreamingText],
  );

  const enqueueMuseTalkChunk = useCallback(
    (text: string) => {
      const chunk = text.trim();
      if (!chunk) return;

      const pipelineBusy =
        avatarPlayingRef.current ||
        avatarQueueRef.current.length > 0 ||
        museTalkPendingTextRef.current.length > 0 ||
        museTalkPrefetchRunningRef.current;

      // 재생 순번은 **분할 시점에** 매긴다. 이후 어느 경로(MSE·프리페치)로 가든 같은 번호를 쓴다.
      // 세션이 아직 없으면 여기서 시작한다 — 문장 단위 flush(flushMuseTalkSentences)는
      // enqueueMuseTalkSpeech를 거치지 않고 이 함수를 직접 부르기 때문에, 세션 발급을
      // 여기 두지 않으면 session_id가 빈 문자열로 나가 **서버의 위상 체이닝이 통째로 꺼진다**
      // (그러면 문장이 바뀔 때마다 프레임 0에서 다시 시작해 머리가 튄다).
      if (!speechSessionIdRef.current) {
        speechSessionIdRef.current = `s${Date.now().toString(36)}${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        speechSeqRef.current = 0;
      }
      const sessionId = speechSessionIdRef.current;
      const seq = speechSeqRef.current++;

      if (!pipelineBusy) {
        avatarPlayingRef.current = true;
        if (perfTraceRef.current && !perfTraceRef.current.avatar_started_at) {
          perfTraceRef.current.avatar_started_at = window.performance.now();
        }
        setMuseTalkRequest({
          id: ++museTalkRequestIdRef.current,
          text: chunk,
          displayCharacters: chunk.length,
          avatar_id: selectedCoachIdRef.current,
          session_id: sessionId,
          seq,
        });
        setAvatarStatus("thinking");
        return;
      }

      const generation = museTalkPrefetchGenerationRef.current;
      museTalkPendingTextRef.current.push({ text: chunk, sessionId, seq });
      void pumpMuseTalkPrefetch(generation);
    },
    [pumpMuseTalkPrefetch],
  );

  const enqueueMuseTalkSpeech = useCallback(
    (text: string) => {
      const chunks = splitMuseTalkSpeech(text);
      console.info("[MuseTalk]", "sentence_chunks", chunks.length, chunks);
      museTalkPrefetchGenerationRef.current += 1;
      // 새 답변 = 새 세션. 여기서 발급하지 않고 **비우기만** 한다 — 실제 발급은 첫 청크가
      // 만들어질 때(enqueueMuseTalkChunk) 일어난다. 그래야 문장 flush로 이미 세션이
      // 시작된 경우 그 세션을 덮어써 체인을 끊는 일이 없다.
      speechSessionIdRef.current = "";
      speechSeqRef.current = 0;
      if (chunks.length === 0) {
        setAvatarStatus("idle");
        return;
      }

      for (const chunk of chunks) enqueueMuseTalkChunk(chunk);
    },
    [enqueueMuseTalkChunk],
  );

  const playQueuedAvatarSpeech = useCallback(() => {
    const nextMedia = avatarQueueRef.current.shift();
    if (!nextMedia) {
      avatarPlayingRef.current = false;
      setAvatarStatus("idle");
      return;
    }

    avatarPlayingRef.current = true;
    setAvatarSpeechMedia(nextMedia);
    setAvatarStatus("thinking");
  }, []);

  const cleanupVoiceResources = useCallback(() => {
    if (voiceAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(voiceAnimationFrameRef.current);
      voiceAnimationFrameRef.current = null;
    }

    voiceSourceRef.current?.disconnect();
    voiceSourceRef.current = null;

    const audioContext = voiceAudioContextRef.current;
    voiceAudioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => undefined);
    }

    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;
  }, []);

  const finishVoiceSession = useCallback(
    (showProcessing = true) => {
      const hadActiveSession = voiceSessionActiveRef.current;
      voiceSessionActiveRef.current = false;

      const recognition = speechRecognitionRef.current;
      speechRecognitionRef.current = null;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try {
          recognition.stop();
        } catch {
          recognition.abort();
        }
      }

      cleanupVoiceResources();
      setVoiceLevel(0);
      setVoiceBands(Array.from({ length: VOICE_EQUALIZER_BAND_COUNT }, () => 0));

      if (!hadActiveSession) return;

      if (voiceProcessingTimerRef.current !== null) {
        window.clearTimeout(voiceProcessingTimerRef.current);
      }

      if (!showProcessing) {
        setRecordingState("idle");
        setAvatarStatus("idle");
        return;
      }

      setRecordingState("processing");
      setAvatarStatus("thinking");
      voiceProcessingTimerRef.current = window.setTimeout(() => {
        setRecordingState("idle");
        setAvatarStatus("idle");
        voiceProcessingTimerRef.current = null;
      }, 450);
    },
    [cleanupVoiceResources],
  );

  useEffect(() => {
    const updateScale = () => {
      setStageScale(Math.min(1, window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT));
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const status = await fetchAvatarStatus();
        if (cancelled) return;
        setAvatarProvider(status.enabled ? (status.provider ?? "gradio") : null);
      } catch {
        if (!cancelled) setAvatarProvider(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const id = await resumeOrCreateConsultation();
        if (cancelled) return;
        setConsultationId(id);

        // 마이페이지에 저장해 둔 이력서가 있으면 상담 시작과 함께 백그라운드로 자동 분석·연결(B안).
        // 사전 설문 게이트 덕에 자유대화 전까지 시간이 넉넉해 첫 발화 전에 끝난다. 저장된 이력서가
        // 없거나 분석이 실패해도 상담 시작을 막지 않도록 fire-and-forget(에러 무시).
        void attachStoredResume(id).catch(() => undefined);

        const [history, survey] = await Promise.all([
          fetchConsultationMessages(id),
          fetchSurveyItems(id),
        ]);
        if (cancelled) return;

        if (history.length > 0) {
          setMessages(
            history.map((message) => ({
              id: `message-${message.id}`,
              role: message.role,
              content: message.content,
              createdAt: message.created_at,
            })),
          );
        }
        setSurveyQuestions(toSurveyQuestions(survey.items));
        setSurveyCompleted(survey.completed);
      } catch {
        // 백엔드 연결 실패 — 로컬 대화만 유지하는 오프라인 폴백
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      voiceSessionActiveRef.current = false;
      speechRecognitionRef.current?.abort();
      speechRecognitionRef.current = null;
      cleanupVoiceResources();
      if (voiceProcessingTimerRef.current !== null) {
        window.clearTimeout(voiceProcessingTimerRef.current);
      }
      cancelSynchronizedTextReveal();
    };
  }, [cancelSynchronizedTextReveal, cleanupVoiceResources]);

  // 스트림이 빈 채로 끝나거나 끊겨도, 백엔드에는 응답이 이미 생성·저장돼 있을 수 있다
  // (핫리로드로 소켓만 끊긴 경우 등) — "죄송해요"를 보여주기 전에 서버 상태를 한 번 확인한다.
  const recoverAssistantReply = useCallback(async (): Promise<string | null> => {
    if (!consultationId) return null;
    try {
      const history = await fetchConsultationMessages(consultationId);
      const last = history[history.length - 1];
      return last?.role === "assistant" ? last.content : null;
    } catch {
      return null;
    }
  }, [consultationId]);

  const handleSendMessage = useCallback(async () => {
    const content = inputValue.trim();
    if (!content || sendingRef.current) return;

    finishSynchronizedTextReveal();
    const userMessage: ConversationMessage = {
      id: `message-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, userMessage]);
    setInputValue("");

    if (!consultationId) {
      setMessages((current) => [
        ...current,
        {
          id: `message-${Date.now()}-offline`,
          role: "assistant",
          content: "상담 세션 연결이 아직 준비되지 않았어요. 잠시 후 다시 시도해주세요.",
        },
      ]);
      return;
    }

    sendingRef.current = true;
    setAvatarStatus("thinking");
    resetAvatarSpeech();
    const assistantMessageId = `message-${Date.now()}-assistant`;
    synchronizedMessageIdRef.current = assistantMessageId;
    synchronizedFullTextRef.current = "";
    synchronizedVisibleCharactersRef.current = 0;
    synchronizedTargetCharactersRef.current = 0;
    synchronizedStreamDoneRef.current = false;
    synchronizedSpeechFailedRef.current = false;
    setMessages((current) => [
      ...current,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "진로 코치가 작성중입니다",
        phase: "pending",
      },
    ]);
    const traceId = `conv-${Date.now()}`;
    perfTraceRef.current = {
      id: traceId,
      sent_at: window.performance.now(),
      user_chars: content.length,
    };
    console.info("[PERF]", "request_start", {
      trace_id: traceId,
      consultation_id: consultationId,
      user_chars: content.length,
    });
    let started = false;
    let reply = "";
    let museTalkSentenceBuffer = "";
    let museTalkStartedFromStream = false;
    let museTalkStreamedSentences = 0;
    let museTalkStreamedChars = 0;
    let avatarSpeakSentenceBuffer = "";
    let avatarSpeakStartedFromStream = false;
    let avatarSpeakStreamedSentences = 0;
    let avatarSpeakStreamedChars = 0;
    // 백엔드(#131) 상세요청 응답 → skip_tts=true. 긴 텍스트를 아바타가 읽으면 지연만 커지므로 발화 생략.
    let skipTts = false;
    /** LLM 답변을 문장 단위로 쪼개 먼저 나온 문장부터 아바타에 보낸다.
     *
     * ⚠️ 2026-07-27 수정: 이 경로에 `toAvatarSpeechText`와 문장/글자 캡이 **빠져 있었다.**
     * 아래 flushAvatarSpeakSentences(비-MuseTalk 경로)는 처음부터 둘 다 걸고 있었는데
     * 여기만 답변 전체를 마크다운째로 TTS에 태우고 있었다. 그 결과:
     *   · flush ON은 flush OFF보다 통상 3~5배 많은 오디오·영상을 만들었다
     *     (OFF는 :1191에서 toAvatarSpeechText로 5문장/420자로 잘라 보낸다)
     *   · "flush ON이 느리다"는 관측의 일부가 지연이 아니라 **작업량 차이**였다 —
     *     두 모드의 비교 자체가 성립하지 않았다
     *   · `**`·`#`·`-` 같은 마크다운 기호가 그대로 TTS에 들어갔다
     * 캡을 걸면 답변이 길 때 뒷부분을 말하지 않게 되는데, 이는 flush OFF의 **현행 동작과
     * 동일**하므로 회귀가 아니다. */
    const flushMuseTalkSentences = (force = false) => {
      if (avatarProvider !== "musetalk" || !MUSE_TALK_STREAM_SENTENCE_FLUSH) return;
      const result = takeCompletedMuseTalkSentences(museTalkSentenceBuffer, force);
      museTalkSentenceBuffer = result.rest;
      if (result.chunks.length === 0) return;

      const speechChunks: string[] = [];
      for (const sentence of result.chunks) {
        if (museTalkStreamedSentences >= AVATAR_SPEECH_MAX_SENTENCES) break;

        const speech = toAvatarSpeechText(sentence);
        if (!speech) continue;

        // 첫 문장은 420자를 넘어도 보낸다. 안 그러면 긴 첫 문장에서 아바타가 아예 말을 안 한다.
        const nextLength = museTalkStreamedChars + speech.length;
        if (nextLength > AVATAR_SPEECH_MAX_CHARS && museTalkStreamedSentences > 0) break;

        museTalkStreamedSentences += 1;
        museTalkStreamedChars = nextLength;
        speechChunks.push(speech);
      }

      if (speechChunks.length === 0) return;
      // 캡에 걸려 뒷부분을 잘랐어도 **말은 시작했으므로** true다. false로 두면 답변 종료 시
      // enqueueMuseTalkSpeech가 전체를 처음부터 다시 말한다.
      museTalkStartedFromStream = true;
      console.info("[MuseTalk]", "llm_sentence_flush", speechChunks);
      for (const speech of speechChunks) enqueueMuseTalkChunk(speech);
    };
    const flushAvatarSpeakSentences = (force = false) => {
      if (!avatarProvider || avatarProvider === "musetalk") return;
      const result = takeCompletedMuseTalkSentences(avatarSpeakSentenceBuffer, force);
      avatarSpeakSentenceBuffer = result.rest;
      if (result.chunks.length === 0) return;

      const speechChunks: string[] = [];
      const displayCharacterCounts: number[] = [];
      for (const sentence of result.chunks) {
        if (avatarSpeakStreamedSentences >= AVATAR_SPEECH_MAX_SENTENCES) break;

        const speech = toAvatarSpeechText(sentence);
        if (!speech) continue;

        const nextLength = avatarSpeakStreamedChars + speech.length;
        if (nextLength > AVATAR_SPEECH_MAX_CHARS && avatarSpeakStreamedSentences > 0) break;

        avatarSpeakStartedFromStream = true;
        avatarSpeakStreamedSentences += 1;
        avatarSpeakStreamedChars = nextLength;
        speechChunks.push(speech);
        displayCharacterCounts.push(sentence.length);
      }

      if (speechChunks.length === 0) return;
      console.info("[Avatar]", "llm_sentence_flush", speechChunks);
      speechChunks.forEach((speech, index) => {
        enqueueAvatarSpeechText(speech, displayCharacterCounts[index]);
      });
    };

    try {
      await streamConsultationReply(
        consultationId,
        content,
        (chunk) => {
          const trace = perfTraceRef.current;
          if (trace && !trace.llm_first_token_at) {
            trace.llm_first_token_at = window.performance.now();
            console.info("[PERF]", "llm_first_token", {
              trace_id: trace.id,
              client_first_token_ms: Math.round(trace.llm_first_token_at - trace.sent_at),
            });
          }
          reply += chunk;
          synchronizedFullTextRef.current = reply;
          museTalkSentenceBuffer += chunk;
          avatarSpeakSentenceBuffer += chunk;
          flushMuseTalkSentences(false);
          flushAvatarSpeakSentences(false);
          if (!started) {
            started = true;
          }
          if (!avatarProvider || synchronizedSpeechFailedRef.current) {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      content:
                        message.phase === "pending"
                          ? chunk
                          : message.content + chunk,
                      phase: "streaming",
                    }
                  : message,
              ),
            );
          }
        },
        {
          onDone: (metrics) => {
            skipTts = Boolean(metrics.skip_tts);
            const trace = perfTraceRef.current;
            if (!trace) return;
            trace.llm_done_at = window.performance.now();
            trace.server = metrics;
            trace.llm_output_chars = metrics.server_output_chars;
            console.info("[PERF]", "llm_done", {
              trace_id: trace.id,
              client_llm_total_ms: Math.round(trace.llm_done_at - trace.sent_at),
              client_llm_chars_per_s: Number(
                ((metrics.server_output_chars ?? reply.length) /
                  Math.max((trace.llm_done_at - trace.sent_at) / 1000, 0.001)).toFixed(2),
              ),
              ...metrics,
            });
          },
        },
      );

      if (!started) {
        // 스트림은 에러 없이 끝났는데 토큰을 하나도 못 받은 경우 — 백엔드 핫리로드 등으로
        // 응답 생성·저장은 끝났지만 소켓만 끊겼을 수 있어, 실제로 저장됐는지 한 번 확인한다.
        const recovered = await recoverAssistantReply();
        synchronizedFullTextRef.current =
          recovered ?? "죄송해요, 응답을 만들지 못했어요. 다시 시도해주세요.";
        finishSynchronizedTextReveal();
        setAvatarStatus("idle");
        sendingRef.current = false;
        return;
      }

      flushMuseTalkSentences(true);
      flushAvatarSpeakSentences(true);
      synchronizedStreamDoneRef.current = true;
      if (!avatarProvider || synchronizedSpeechFailedRef.current) {
        finishSynchronizedTextReveal();
      }
    } catch (error) {
      const recovered = await recoverAssistantReply();
      synchronizedFullTextRef.current =
        recovered ??
        (error instanceof ApiError
          ? error.message
          : "응답을 받아오지 못했어요. 다시 시도해주세요.");
      finishSynchronizedTextReveal();
      resetAvatarSpeech();
      setAvatarStatus("idle");
      sendingRef.current = false;
      return;
    }

    if (skipTts) {
      // 상세요청 응답 — 긴 텍스트라 음성 합성 생략, 텍스트만 노출 (지연 방지).
      // 문장 flush로 첫 문장이 이미 발사됐을 수 있으니(skip_tts는 done에서야 알 수 있음) 중단시킨다.
      console.info("[Avatar]", "skip_tts", { reason: "detail_requested", source_chars: reply.length });
      resetAvatarSpeech();
      finishSynchronizedTextReveal();
      setAvatarStatus("idle");
    } else if (avatarProvider === "musetalk") {
        const avatarSpeech = toAvatarSpeechText(reply);
        if (perfTraceRef.current) {
          perfTraceRef.current.avatar_speech_chars = avatarSpeech.length;
        }
        console.info("[MuseTalk]", "avatar_speech_text", {
          source_chars: reply.length,
          speech_chars: avatarSpeech.length,
          text: avatarSpeech,
        });
        if (!avatarSpeech) {
          finishSynchronizedTextReveal();
        } else if (museTalkStartedFromStream) {
          // 문장 flush가 이미 이 답변의 청크를 다 보냈다. 세션을 닫아 다음 답변이
          // 같은 session_id를 이어받지 않게 한다(이어받으면 새 답변이 이전 답변의
          // end_frame에서 시작해 idle 위치와 어긋난다).
          speechSessionIdRef.current = "";
          speechSeqRef.current = 0;
        } else {
          enqueueMuseTalkSpeech(avatarSpeech);
        }
    } else if (avatarProvider && avatarSpeakStartedFromStream) {
      if (perfTraceRef.current) {
        perfTraceRef.current.avatar_speech_chars = avatarSpeakStreamedChars;
      }
    } else if (avatarProvider) {
      try {
        await streamAvatarSpeakChunks(
          reply,
          (chunk) =>
            enqueueAvatarSpeech({
              url: chunk.hls_url,
              displayCharacters: chunk.text.length,
            }),
          { avatarId: selectedCoachIdRef.current },
        );
      } catch {
        resetAvatarSpeech();
        finishSynchronizedTextReveal();
        setAvatarStatus("idle");
      }
    } else {
      finishSynchronizedTextReveal();
      setAvatarStatus("idle");
    }
    sendingRef.current = false;
  }, [
    avatarProvider,
    consultationId,
    enqueueAvatarSpeech,
    enqueueAvatarSpeechText,
    enqueueMuseTalkChunk,
    enqueueMuseTalkSpeech,
    finishSynchronizedTextReveal,
    inputValue,
    recoverAssistantReply,
    resetAvatarSpeech,
  ]);

  const handleSpeakingStart = useCallback(
    (durationMs: number | null) => {
      setAvatarStatus("speaking");
      const displayCharacters =
        museTalkRequest?.displayCharacters ??
        avatarSpeechMedia?.displayCharacters ??
        1;
      startSynchronizedTextReveal(displayCharacters, durationMs);
    },
    [
      avatarSpeechMedia?.displayCharacters,
      museTalkRequest?.displayCharacters,
      startSynchronizedTextReveal,
    ],
  );

  const handleSpeakingEnd = useCallback(() => {
    completeSynchronizedTextSegment();
    const hasOutstandingSpeech =
      avatarQueueRef.current.length > 0 ||
      museTalkPendingTextRef.current.length > 0 ||
      avatarSpeakPendingTextRef.current.length > 0 ||
      museTalkPrefetchRunningRef.current ||
      avatarSpeakRunningRef.current;

    if (museTalkRequest) {
      setMuseTalkRequest(null);
      playQueuedAvatarSpeech();
    } else {
      revokeMuseTalkBlobUrl(avatarHlsUrl);
      setAvatarSpeechMedia(null);
      playQueuedAvatarSpeech();
    }

    if (!hasOutstandingSpeech && synchronizedStreamDoneRef.current) {
      finishSynchronizedTextReveal();
    }
  }, [
    avatarHlsUrl,
    completeSynchronizedTextSegment,
    finishSynchronizedTextReveal,
    museTalkRequest,
    playQueuedAvatarSpeech,
    revokeMuseTalkBlobUrl,
  ]);

  const handleSpeakingError = useCallback(() => {
    fallbackToStreamingText();
    resetAvatarSpeech();
    setAvatarStatus("idle");
  }, [fallbackToStreamingText, resetAvatarSpeech]);

  const handleCoachConfirm = useCallback(
    (coachId: CoachAvatarId) => {
      resetAvatarSpeech();
      selectedCoachIdRef.current = coachId;
      setSelectedCoachId(coachId);
      saveCoachId(coachId);
      setAvatarStatus("idle");
      setIsCoachSelectionOpen(false);
    },
    [resetAvatarSpeech],
  );

  const handleMuseTalkMetrics = useCallback((metrics: Record<string, unknown>) => {
    const trace = perfTraceRef.current;
    if (!trace) {
      console.info("[PERF]", "avatar_done_without_trace", metrics);
      return;
    }

    const now = window.performance.now();
    const llmDoneAt = trace.llm_done_at ?? now;
    const avatarStartedAt = trace.avatar_started_at ?? llmDoneAt;
    const ttsSeconds = Number(metrics.tts_seconds ?? 0);
    const firstStreamByteSeconds = Number(metrics.first_stream_byte_seconds ?? 0);
    const firstBinaryAt = Number(metrics.first_binary_at ?? 0);
    const firstPlayAt = Number(metrics.first_play_at ?? 0);
    const browserTotalSeconds = Number(metrics.browser_total_s ?? 0);

    console.info("[PERF]", "summary", {
      trace_id: trace.id,
      user_chars: trace.user_chars,
      llm_output_chars: trace.llm_output_chars,
      avatar_speech_chars: trace.avatar_speech_chars,
      server_request_first_token_ms: trace.server?.server_first_token_ms,
      server_request_total_ms: trace.server?.server_total_ms,
      server_output_chars_per_s: trace.server?.server_output_chars_per_s,
      client_llm_first_token_ms: trace.llm_first_token_at
        ? Math.round(trace.llm_first_token_at - trace.sent_at)
        : null,
      client_llm_total_ms: trace.llm_done_at
        ? Math.round(trace.llm_done_at - trace.sent_at)
        : null,
      avatar_start_after_llm_ms: Math.round(avatarStartedAt - llmDoneAt),
      tts_first_byte_s: metrics.tts_first_byte_seconds,
      tts_total_s: metrics.tts_seconds,
      tts_model: metrics.tts_model,
      musetalk_first_stream_byte_s: metrics.first_stream_byte_seconds,
      browser_first_binary_s: metrics.first_binary_at,
      browser_first_play_s: metrics.first_play_at,
      avatar_browser_total_s: metrics.browser_total_s,
      avatar_server_total_s: metrics.total_seconds,
      tunnel_to_browser_first_binary_s:
        firstBinaryAt && firstStreamByteSeconds
          ? Number((firstBinaryAt - firstStreamByteSeconds).toFixed(3))
          : null,
      playback_buffer_wait_s:
        firstPlayAt && firstBinaryAt ? Number((firstPlayAt - firstBinaryAt).toFixed(3)) : null,
      end_to_end_first_play_ms: firstPlayAt
        ? Math.round(avatarStartedAt - trace.sent_at + firstPlayAt * 1000)
        : null,
      end_to_end_avatar_done_ms: browserTotalSeconds
        ? Math.round(avatarStartedAt - trace.sent_at + browserTotalSeconds * 1000)
        : Math.round(now - trace.sent_at),
      sent_bytes: metrics.sent_bytes,
      stream_chunks: metrics.stream_chunks,
      peak_vram_gb: metrics.peak_vram_gb,
      tts_share_of_avatar_server:
        ttsSeconds && Number(metrics.total_seconds)
          ? Number((ttsSeconds / Number(metrics.total_seconds)).toFixed(3))
          : null,
    });
  }, []);

  const handleVoiceInput = useCallback(async () => {
    if (recordingState === "recording") {
      finishVoiceSession();
      return;
    }

    if (recordingState !== "idle") return;

    setVoiceIssue(null);

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setVoiceIssue("음성 입력은 localhost 또는 HTTPS 주소에서 사용할 수 있어요.");
      return;
    }

    const SpeechRecognitionClass = (
      window as typeof window & {
        SpeechRecognition?: SpeechRecognitionConstructor;
        webkitSpeechRecognition?: SpeechRecognitionConstructor;
      }
    ).SpeechRecognition ??
      (
        window as typeof window & {
          webkitSpeechRecognition?: SpeechRecognitionConstructor;
        }
      ).webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      setVoiceIssue("이 브라우저는 실시간 음성 인식을 지원하지 않아요. Chrome 또는 Edge를 사용해주세요.");
      return;
    }

    setRecordingState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;
      voiceSessionActiveRef.current = true;
      voiceInputBaseRef.current = inputValue.trim();
      voiceFinalTranscriptRef.current = "";
      setRecordingState("recording");
      setAvatarStatus("listening");

      const recognition = new SpeechRecognitionClass();
      recognition.lang = "ko-KR";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let interimTranscript = "";

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result[0]?.transcript?.trim() ?? "";
          if (!transcript) continue;
          if (result.isFinal) {
            voiceFinalTranscriptRef.current = [voiceFinalTranscriptRef.current, transcript]
              .filter(Boolean)
              .join(" ");
          } else {
            interimTranscript = [interimTranscript, transcript].filter(Boolean).join(" ");
          }
        }

        setInputValue(
          [voiceInputBaseRef.current, voiceFinalTranscriptRef.current, interimTranscript]
            .filter(Boolean)
            .join(" "),
        );
      };
      recognition.onerror = (event) => {
        if (event.error === "aborted") return;

        const issue =
          event.error === "not-allowed" || event.error === "service-not-allowed"
            ? "브라우저 주소창의 마이크 권한을 허용해주세요."
            : event.error === "audio-capture"
              ? "사용 가능한 마이크를 찾지 못했어요."
              : event.error === "network"
                ? "음성 인식 서비스에 연결하지 못했어요. 잠시 후 다시 시도해주세요."
                : event.error === "no-speech"
                  ? "음성이 들리지 않아 녹음을 종료했어요."
                  : "음성 인식 중 오류가 발생했어요. 다시 시도해주세요.";

        setVoiceIssue(issue);
        finishVoiceSession(false);
      };
      recognition.onend = () => {
        if (voiceSessionActiveRef.current) finishVoiceSession();
      };
      speechRecognitionRef.current = recognition;
      recognition.start();

      const AudioContextClass =
        window.AudioContext ??
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;

      if (AudioContextClass) {
        const audioContext = new AudioContextClass();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        const startedAt = window.performance.now();
        let lastSoundAt = startedAt;

        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.78;
        const samples = new Uint8Array(analyser.fftSize);
        const frequencies = new Uint8Array(analyser.frequencyBinCount);
        const frequencyResolution = audioContext.sampleRate / analyser.fftSize;
        const minimumVoiceBin = Math.max(1, Math.floor(90 / frequencyResolution));
        const maximumVoiceBin = Math.min(
          analyser.frequencyBinCount - 1,
          Math.ceil(4_200 / frequencyResolution),
        );
        const frequencyBandEdges = Array.from(
          { length: VOICE_EQUALIZER_BAND_COUNT + 1 },
          (_, index) => {
            const ratio = index / VOICE_EQUALIZER_BAND_COUNT;
            return Math.round(
              minimumVoiceBin *
                Math.pow(maximumVoiceBin / minimumVoiceBin, ratio),
            );
          },
        );
        source.connect(analyser);
        voiceAudioContextRef.current = audioContext;
        voiceSourceRef.current = source;
        void audioContext.resume().catch(() => undefined);

        const measureVoiceLevel = () => {
          if (!voiceSessionActiveRef.current) return;

          analyser.getByteTimeDomainData(samples);
          let total = 0;
          for (const sample of samples) {
            const normalized = (sample - 128) / 128;
            total += normalized * normalized;
          }

          const rms = Math.sqrt(total / samples.length);
          const visibleLevel = Math.min(1, Math.max(0, (rms - 0.008) / 0.14));
          const now = window.performance.now();
          setVoiceLevel(visibleLevel);
          analyser.getByteFrequencyData(frequencies);
          setVoiceBands(
            Array.from({ length: VOICE_EQUALIZER_BAND_COUNT }, (_, index) => {
              const start = frequencyBandEdges[index];
              const end = Math.max(start + 1, frequencyBandEdges[index + 1]);
              let total = 0;
              let peak = 0;

              for (let bin = start; bin < end; bin += 1) {
                const value = frequencies[bin] ?? 0;
                total += value;
                peak = Math.max(peak, value);
              }

              const average = total / Math.max(1, end - start);
              const combined = (average * 0.62 + peak * 0.38) / 255;
              const normalized = Math.min(
                1,
                Math.max(0, (combined - 0.035) / 0.48),
              );
              return normalized < 0.035 ? 0 : Math.pow(normalized, 0.82);
            }),
          );

          if (rms >= VOICE_LEVEL_THRESHOLD) {
            lastSoundAt = now;
          } else if (
            now - startedAt >= VOICE_START_GRACE_MS &&
            now - lastSoundAt >= VOICE_SILENCE_TIMEOUT_MS
          ) {
            finishVoiceSession();
            return;
          }

          voiceAnimationFrameRef.current = window.requestAnimationFrame(measureVoiceLevel);
        };

        voiceAnimationFrameRef.current = window.requestAnimationFrame(measureVoiceLevel);
      }
    } catch (error) {
      voiceSessionActiveRef.current = false;
      cleanupVoiceResources();
      setVoiceLevel(0);
      setVoiceBands(Array.from({ length: VOICE_EQUALIZER_BAND_COUNT }, () => 0));
      setRecordingState("idle");
      setAvatarStatus("idle");
      const errorName = error instanceof DOMException ? error.name : "";
      setVoiceIssue(
        errorName === "NotAllowedError" || errorName === "SecurityError"
          ? "브라우저 주소창의 마이크 권한을 허용해주세요."
          : errorName === "NotFoundError"
            ? "사용 가능한 마이크를 찾지 못했어요."
            : errorName === "NotReadableError"
              ? "마이크를 다른 프로그램에서 사용 중인지 확인해주세요."
              : "마이크를 시작하지 못했어요. 잠시 후 다시 시도해주세요.",
      );
    }
  }, [cleanupVoiceResources, finishVoiceSession, inputValue, recordingState]);

  const openSurvey = useCallback(() => setActivePanel("survey"), []);

  const handleSurveyAnswerChange = useCallback((questionId: string, value: string) => {
    setSurveyAnswers((current) => ({ ...current, [questionId]: value }));
  }, []);

  const handleSurveySubmit = useCallback(async () => {
    if (!consultationId || surveySubmitting) return;
    if (Object.keys(surveyAnswers).length < surveyQuestions.length) {
      setSurveyError("모든 문항에 답해주세요.");
      return;
    }

    setSurveySubmitting(true);
    setSurveyError(null);
    try {
      const result = await submitConsultationSurvey(consultationId, surveyAnswers);
      window.dispatchEvent(
        new CustomEvent("jobiverse:submit-conversation-survey", {
          detail: surveyAnswers,
        }),
      );
      setMessages((current) => [
        ...current,
        ...result.avatar_lines.map((line, index) => ({
          id: `survey-line-${Date.now()}-${index}`,
          role: "assistant" as const,
          content: line,
        })),
      ]);
      setSurveyCompleted(true);
      setActivePanel("chat");
    } catch (error) {
      setSurveyError(
        error instanceof ApiError ? error.message : "설문 제출에 실패했어요. 다시 시도해주세요.",
      );
    } finally {
      setSurveySubmitting(false);
    }
  }, [consultationId, surveyAnswers, surveyQuestions.length, surveySubmitting]);

  // 리포트 로딩을 이미 시작한 상담 id. 아래 effect의 재실행 가드로 쓴다.
  // reportState.phase를 의존성으로 쓰면 안 된다 — effect가 첫 줄에서 phase를 바꾸므로
  // 곧바로 재실행되고, 그때 도는 cleanup이 방금 띄운 요청을 취소해 영원히 '로딩 중'이 된다.
  const reportLoadedForRef = useRef<number | null>(null);
  // '다시 시도'가 effect를 다시 태우는 유일한 신호. ref만 풀면 의존성이 그대로라
  // effect가 재실행되지 않아 '분석 중'에서 멈춘다.
  const [reportReloadToken, setReportReloadToken] = useState(0);

  const handleReportRetry = useCallback(() => {
    reportLoadedForRef.current = null; // 다시 시도하면 한 번 더 받아온다
    setReportState(INITIAL_REPORT_STATE);
    setReportReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    recommendationCacheRef.current = recommendation;
  }, [recommendation]);

  const ensureRecommendation = useCallback(
    async (targetConsultationId: number): Promise<Recommendation> => {
      const cachedRecommendation = recommendationCacheRef.current;
      if (cachedRecommendation?.consultation_id === targetConsultationId) {
        return cachedRecommendation;
      }

      const savedRecommendation = await fetchLatestRecommendation(targetConsultationId);
      if (savedRecommendation) {
        // 캐시는 recommendation state 변경 effect(다음 렌더)에서만 채워져, 같은 렌더에서
        // 이어지는 호출이 캐시를 놓치고 매번 네트워크를 다시 탔다. 여기서 즉시 반영한다.
        recommendationCacheRef.current = savedRecommendation;
        return savedRecommendation;
      }

      const pendingRequest = recommendationRequestRef.current;
      if (pendingRequest?.consultationId === targetConsultationId) {
        return pendingRequest.promise;
      }

      const promise = createRecommendation(targetConsultationId);
      recommendationRequestRef.current = { consultationId: targetConsultationId, promise };
      try {
        const created = await promise;
        recommendationCacheRef.current = created;
        return created;
      } finally {
        if (recommendationRequestRef.current?.promise === promise) {
          recommendationRequestRef.current = null;
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (activePanel !== "report" || !consultationId) return;
    if (reportLoadedForRef.current === consultationId) return; // 이 상담은 이미 받아왔다
    reportLoadedForRef.current = consultationId;

    let cancelled = false;
    setReportState((current) => ({ ...current, phase: "loading" }));

    (async () => {
      try {
        const recommendation = await ensureRecommendation(consultationId);
        if (cancelled) return;
        setRecommendation(recommendation);

        let currentReport = await createReport(consultationId);
        while (!cancelled && currentReport.status === "pending") {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
          if (cancelled) return;
          currentReport = await fetchReport(currentReport.id);
        }
        if (cancelled) return;

        setReportState({
          phase: currentReport.status === "done" ? "ready" : "error",
          recommendation,
          report: currentReport,
          message:
            currentReport.status === "done"
              ? null
              : "리포트 생성에 실패했어요. 잠시 후 다시 시도해주세요.",
          followupQuestions: [],
        });
      } catch (error) {
        if (cancelled) return;

        if (error instanceof ApiError && error.status === 409) {
          const detail = error.detail as
            | { message?: string; followup_questions?: string[] }
            | null;
          setReportState({
            phase: "needs-more-chat",
            recommendation: null,
            report: null,
            message: detail?.message ?? "적성 파악이 아직 부족해요. 대화를 조금 더 나눠주세요.",
            followupQuestions: detail?.followup_questions ?? [],
          });
        } else {
          setReportState({
            phase: "error",
            recommendation: null,
            report: null,
            message: error instanceof ApiError ? error.message : "리포트를 준비하지 못했어요.",
            followupQuestions: [],
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activePanel, consultationId, ensureRecommendation, reportReloadToken]);

  const loadConsultationHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setConsultationHistory(await fetchConsultations());
    } catch (error) {
      setHistoryError(
        error instanceof ApiError ? error.message : "대화 기록을 불러오지 못했어요.",
      );
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const handleConsultationRename = useCallback(async (id: number, title: string) => {
    const updated = await updateConsultationTitle(id, title);
    setConsultationHistory((current) =>
      current.map((item) => (item.id === id ? { ...item, title: updated.title } : item)),
    );
  }, []);

  const handleConsultationDelete = useCallback(async (id: number) => {
    await deleteConsultation(id);
    setConsultationHistory((current) => current.filter((item) => item.id !== id));

    if (id !== consultationId) return;

    finishVoiceSession(false);
    // 현재 상담을 지우면 진행 중이던 발화·대기 큐도 함께 정리한다. (2026-07-26 감사)
    resetAvatarSpeech();
    sessionStorage.removeItem(CONSULTATION_RESUME_KEY);
    setMessages(initialConversationMessages);
    setInputValue("");
    setAvatarStatus("idle");
    setActivePanel("chat");
    setVoiceIssue(null);
    setSurveyAnswers({});
    setSurveyError(null);
    setSurveyQuestions([]);
    setConsultationId(null);
    setReportState(INITIAL_REPORT_STATE);
    setRecommendation(null);
    recommendationCacheRef.current = null;
    setRecommendationError(null);
    setRecommendationNeedsMoreChat(false);
    setRecommendationFollowupQuestions([]);

    try {
      const consultation = await createConsultation();
      sessionStorage.setItem(CONSULTATION_RESUME_KEY, String(consultation.id));
      setConsultationId(consultation.id);
      void attachStoredResume(consultation.id).catch(() => undefined);
      const survey = await fetchSurveyItems(consultation.id);
      setSurveyQuestions(toSurveyQuestions(survey.items));
    } catch {
      // 삭제는 완료됐으므로 새 상담 생성 실패 시 기본 화면을 유지한다.
    }
  }, [consultationId, finishVoiceSession, resetAvatarSpeech]);

  const loadRecommendedJobs = useCallback(async () => {
    if (!consultationId) {
      setRecommendation(null);
      setRecommendationError("상담 세션을 연결한 뒤 다시 확인해주세요.");
      setRecommendationNeedsMoreChat(false);
      setRecommendationFollowupQuestions([]);
      return;
    }

    setRecommendationLoading(true);
    setRecommendationError(null);
    setRecommendationNeedsMoreChat(false);
    setRecommendationFollowupQuestions([]);
    const [recommendationResult, scenariosResult] = await Promise.allSettled([
      ensureRecommendation(consultationId),
      fetchScenarios(),
    ]);

    if (recommendationResult.status === "fulfilled") {
      setRecommendation(recommendationResult.value);
    } else {
      const error = recommendationResult.reason;
      if (error instanceof ApiError && error.status === 409) {
        const detail = error.detail as
          | { message?: string; followup_questions?: string[] }
          | null;
        setRecommendationError(
          detail?.message ?? "추천을 만들려면 상담을 조금 더 나눠주세요.",
        );
        setRecommendationNeedsMoreChat(true);
        setRecommendationFollowupQuestions(detail?.followup_questions ?? []);
      } else {
        setRecommendationError(
          error instanceof ApiError ? error.message : "추천 결과를 준비하지 못했어요.",
        );
      }
    }

    if (scenariosResult.status === "fulfilled") {
      setScenarioSummaries(scenariosResult.value);
    }
    setRecommendationLoading(false);
  }, [consultationId, ensureRecommendation]);

  const handleVirtualCompanyEntry = useCallback(async () => {
    if (!surveyCompleted || !consultationId) {
      setVirtualCompanyGateReason("survey");
      setActiveModal("virtualCompanyGate");
      return;
    }

    const enterScenario = (slug: string, targetConsultationId: number) => {
      const params = new URLSearchParams({
        slug,
        consultationId: String(targetConsultationId),
      });
      window.location.assign(`${FRONTEND_ENDPOINTS.scenario}?${params.toString()}`);
    };

    const openRecommendationOrScenarioGate = (current: Recommendation | null) => {
      if (!current) {
        setVirtualCompanyGateReason("recommendation");
        setActiveModal("virtualCompanyGate");
        return;
      }

      const topSlug = current.results[0]?.scenario_slug;
      if (!topSlug) {
        setVirtualCompanyGateReason("scenario");
        setActiveModal("virtualCompanyGate");
        return;
      }

      setActiveModal(null);
      enterScenario(topSlug, consultationId);
    };

    if (recommendation?.consultation_id === consultationId) {
      openRecommendationOrScenarioGate(recommendation);
      return;
    }

    setVirtualCompanyGateReason("checking");
    setActiveModal("virtualCompanyGate");

    try {
      const savedRecommendation = await fetchLatestRecommendation(consultationId);
      if (savedRecommendation) {
        recommendationCacheRef.current = savedRecommendation;
        setRecommendation(savedRecommendation);
      }
      openRecommendationOrScenarioGate(savedRecommendation);
    } catch {
      setVirtualCompanyGateReason("error");
      setActiveModal("virtualCompanyGate");
    }
  }, [consultationId, recommendation, surveyCompleted]);

  const handleConsultationSelect = useCallback(
    async (nextConsultationId: number) => {
      if (nextConsultationId === consultationId) {
        setActiveModal(null);
        setActivePanel("chat");
        return;
      }

      finishVoiceSession(false);
      // 발화 중 다른 상담으로 바꾸면 이전 답변의 음성·대기 큐가 새 상담 위에서 계속
      // 재생된다 — 큐·blob·세션(seq)까지 여기서 전부 닫는다. (2026-07-26 감사)
      resetAvatarSpeech();
      setActiveModal(null);
      setActivePanel("chat");
      setInputValue("");
      setVoiceIssue(null);
      setSurveyAnswers({});
      setSurveyError(null);
      setSurveyCompleted(false);
      setReportState(INITIAL_REPORT_STATE);
      setRecommendation(null);
      recommendationCacheRef.current = null;
      setRecommendationError(null);
      setRecommendationNeedsMoreChat(false);
      setRecommendationFollowupQuestions([]);
      setConsultationId(nextConsultationId);
      setAvatarStatus("thinking");
      sessionStorage.setItem(CONSULTATION_RESUME_KEY, String(nextConsultationId));
      void attachStoredResume(nextConsultationId).catch(() => undefined);

      try {
        const [history, survey] = await Promise.all([
          fetchConsultationMessages(nextConsultationId),
          fetchSurveyItems(nextConsultationId),
        ]);
        setMessages(
          history.length > 0
            ? history.map((message) => ({
                id: `message-${message.id}`,
                role: message.role,
                content: message.content,
                createdAt: message.created_at,
              }))
            : initialConversationMessages,
        );
        setSurveyQuestions(toSurveyQuestions(survey.items));
        setSurveyCompleted(survey.completed);
      } catch (error) {
        setMessages([
          {
            id: `consultation-load-error-${Date.now()}`,
            role: "assistant",
            content:
              error instanceof ApiError
                ? error.message
                : "선택한 상담을 불러오지 못했어요. 다시 시도해주세요.",
          },
        ]);
      } finally {
        setAvatarStatus("idle");
      }
    },
    [consultationId, finishVoiceSession, resetAvatarSpeech],
  );

  const handleNavigationSelect = useCallback((id: NavigationMenuId) => {
    setActiveMenuId(id);

    if (id === "conversation-list") {
      setActiveModal("history");
      void loadConsultationHistory();
      return;
    }

    if (id === "recommended-jobs") {
      if (!surveyCompleted) {
        setSurveyError("추천 직무를 보려면 사전 설문을 먼저 완료해주세요.");
        setActivePanel("survey");
        return;
      }
      setActiveModal("recommendations");
      void loadRecommendedJobs();
      return;
    }

    if (id === "virtual-company") {
      void handleVirtualCompanyEntry();
      return;
    }

    if (id === "new-consultation") {
      finishVoiceSession(false);
      sessionStorage.removeItem(CONSULTATION_RESUME_KEY);
      setMessages(initialConversationMessages);
      setInputValue("");
      setAvatarStatus("idle");
      resetAvatarSpeech();
      setActivePanel("chat");
      setVoiceIssue(null);
      setSurveyAnswers({});
      setSurveyError(null);
      setSurveyQuestions([]);
      setSurveyCompleted(false);
      setConsultationId(null);
      setReportState(INITIAL_REPORT_STATE);
      setRecommendation(null);
      recommendationCacheRef.current = null;
      setRecommendationError(null);
      setRecommendationNeedsMoreChat(false);
      setRecommendationFollowupQuestions([]);

      void (async () => {
        try {
          const consultation = await createConsultation();
          sessionStorage.setItem(CONSULTATION_RESUME_KEY, String(consultation.id));
          setConsultationId(consultation.id);
          const survey = await fetchSurveyItems(consultation.id);
          setSurveyQuestions(toSurveyQuestions(survey.items));
          setSurveyCompleted(survey.completed);
        } catch {
          // 백엔드 연결 실패 — 로컬 대화만 유지하는 오프라인 폴백
        }
      })();
      return;
    }

    if (id === "final-report") {
      if (!surveyCompleted) {
        setSurveyError("최종 리포트를 보려면 사전 설문을 먼저 완료해주세요.");
        setActivePanel("survey");
        return;
      }
      setActivePanel("report");
      return;
    }

    window.dispatchEvent(new CustomEvent(`jobiverse:${id}`));
  }, [
    finishVoiceSession,
    handleVirtualCompanyEntry,
    loadConsultationHistory,
    loadRecommendedJobs,
    resetAvatarSpeech,
    surveyCompleted,
  ]);

  const handlePanelChange = useCallback(
    (panel: ActiveConversationPanel) => {
      if (panel === "report" && !surveyCompleted) {
        setSurveyError("최종 리포트를 보려면 사전 설문을 먼저 완료해주세요.");
        setActivePanel("survey");
        return;
      }
      setActivePanel(panel);
      if (panel === "report") setActiveMenuId("final-report");
    },
    [surveyCompleted],
  );

  return (
    <main className={styles.screen} aria-label="AI 직무 마스터와의 1대1 대화 화면">
      <div className={styles.cosmicBackground} aria-hidden="true" />
      <div className={styles.starField} aria-hidden="true">
        {STAR_POINTS.map((star, index) => (
          <i
            key={index}
            style={{
              left: star.left,
              top: star.top,
              width: star.size,
              height: star.size,
              animationDelay: star.delay,
            }}
          />
        ))}
      </div>
      <div className={styles.mainBrightnessOverlay} aria-hidden="true" />

      <div
        className={styles.stage}
        style={{ "--conversation-scale": stageScale } as StageStyle}
      >
        <ConversationHeader onCoachSettingsOpen={() => setIsCoachSelectionOpen(true)} />
        <AvatarStatusBadge status={avatarStatus} />
        <FixedNavigationMenu
          activeMenuId={activeMenuId}
          onSelect={handleNavigationSelect}
        />

        <div className={styles.consultationLayout} data-active-panel={activePanel}>
          <AiAvatarStage
            key={activeCoachId}
            avatarId={activeCoachId}
            status={avatarStatus}
            hlsUrl={avatarHlsUrl}
            museTalkRequest={museTalkRequest}
            onSpeakingStart={handleSpeakingStart}
            onSpeakingEnd={handleSpeakingEnd}
            onSpeakingError={handleSpeakingError}
            onMuseTalkMetrics={handleMuseTalkMetrics}
          />

          {activePanel === "chat" ? (
            <YouthPolicyCard onLearnMore={() => setActiveModal("youthPolicy")} />
          ) : null}

          <ConversationPanel
            messages={messages}
            inputValue={inputValue}
            recordingState={recordingState}
            voiceIssue={voiceIssue}
            voiceLevel={voiceLevel}
            voiceBands={voiceBands}
            variant={activePanel === "chat" ? "large" : "compact"}
            onInputChange={setInputValue}
            onSend={handleSendMessage}
            onVoiceInput={handleVoiceInput}
            onOpenSurvey={openSurvey}
          />

          {activePanel === "survey" ? (
            <SurveyDrawer
              questions={surveyQuestions}
              answers={surveyAnswers}
              submitting={surveySubmitting}
              error={surveyError}
              onAnswerChange={handleSurveyAnswerChange}
              onSubmit={handleSurveySubmit}
            />
          ) : null}

          {activePanel === "report" ? (
            <FinalReportPanel reportState={reportState} onRetry={handleReportRetry} />
          ) : null}

          <PanelIndexTabs activePanel={activePanel} onChange={handlePanelChange} />
        </div>

        <AnimatePresence>
          {activeModal === "history" ? (
            <ConversationHistoryModal
              key="conversation-history"
              currentConsultationId={consultationId}
              items={consultationHistory}
              loading={historyLoading}
              error={historyError}
              onRetry={() => void loadConsultationHistory()}
              onSelect={(id) => void handleConsultationSelect(id)}
              onRename={handleConsultationRename}
              onDelete={handleConsultationDelete}
              onClose={() => setActiveModal(null)}
            />
          ) : null}
          {activeModal === "recommendations" ? (
            <RecommendedJobsModal
              key="recommended-jobs"
              recommendation={recommendation}
              scenarios={scenarioSummaries}
              loading={recommendationLoading}
              error={recommendationError}
              needsMoreChat={recommendationNeedsMoreChat}
              followupQuestions={recommendationFollowupQuestions}
              onRetry={() => void loadRecommendedJobs()}
              onContinueChat={() => {
                const nextQuestion = recommendationFollowupQuestions[0];
                if (nextQuestion) {
                  setMessages((current) => [
                    ...current,
                    {
                      id: `recommendation-followup-${Date.now()}`,
                      role: "assistant",
                      content: nextQuestion,
                    },
                  ]);
                }
                setActiveModal(null);
                setActivePanel("chat");
              }}
              onEnterScenario={(slug) => {
                const params = new URLSearchParams({ slug });
                // 체험 완료 시 이 상담의 리포트에 반영하려면 consultationId가 필요하다
                // (없으면 ScenarioGamePage가 리포트 생성을 건너뜀).
                if (consultationId) params.set("consultationId", String(consultationId));
                window.location.assign(`${FRONTEND_ENDPOINTS.scenario}?${params.toString()}`);
              }}
              onClose={() => setActiveModal(null)}
            />
          ) : null}
          {activeModal === "virtualCompanyGate" ? (
            <VirtualCompanyGateModal
              key="virtual-company-gate"
              reason={virtualCompanyGateReason}
              onAction={() => {
                if (virtualCompanyGateReason === "survey") {
                  setSurveyError(null);
                  setActiveModal(null);
                  setActivePanel("survey");
                  return;
                }

                if (virtualCompanyGateReason === "error") {
                  void handleVirtualCompanyEntry();
                  return;
                }

                setActiveModal("recommendations");
                void loadRecommendedJobs();
              }}
              onClose={() => setActiveModal(null)}
            />
          ) : null}
          {activeModal === "youthPolicy" ? (
            <YouthPolicyModal key="youth-policy" onClose={() => setActiveModal(null)} />
          ) : null}
        </AnimatePresence>
      </div>
      <CoachSelectionDialog
        open={isCoachSelectionOpen}
        selectedCoachId={selectedCoachId}
        required={selectedCoachId === null}
        onCancel={() => setIsCoachSelectionOpen(false)}
        onConfirm={handleCoachConfirm}
      />
    </main>
  );
}
