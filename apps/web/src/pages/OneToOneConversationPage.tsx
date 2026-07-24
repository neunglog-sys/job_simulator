import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence } from "motion/react";
import { AiAvatarStage } from "../components/conversation/AiAvatarStage";
import { AvatarStatusBadge } from "../components/conversation/AvatarStatusBadge";
import { ConversationHistoryModal } from "../components/conversation/ConversationHistoryModal";
import { ConversationHeader } from "../components/conversation/ConversationHeader";
import { ConversationPanel } from "../components/conversation/ConversationPanel";
import { FinalReportPanel } from "../components/conversation/FinalReportPanel";
import { FixedNavigationMenu } from "../components/conversation/FixedNavigationMenu";
import { PanelIndexTabs } from "../components/conversation/PanelIndexTabs";
import { RecommendedJobsModal } from "../components/conversation/RecommendedJobsModal";
import { SurveyDrawer } from "../components/conversation/SurveyDrawer";
import { YouthPolicyCard } from "../components/conversation/YouthPolicyCard";
import { YouthPolicyModal } from "../components/conversation/YouthPolicyModal";
import { FRONTEND_ENDPOINTS } from "../config/endpoints";
import { initialConversationMessages } from "../data/conversationMockData";
import {
  ApiError,
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

type ActiveConversationModal = "history" | "recommendations" | "youthPolicy" | null;

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
    : `${limited.replace(/[,\s]+$/g, "")}.`;
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
const MUSE_TALK_CHUNK_MAX_CHARS = 420;
const MUSE_TALK_STREAM_SENTENCE_FLUSH = false;
const AVATAR_SPEECH_MAX_SENTENCES = 5;
const AVATAR_SPEECH_MAX_CHARS = 420;

const STAR_POINTS = Array.from({ length: 54 }, (_, index) => ({
  left: `${(index * 37 + 7) % 98}%`,
  top: `${(index * 61 + 5) % 92}%`,
  size: index % 13 === 0 ? 3 : index % 5 === 0 ? 2 : 1,
  delay: `${-(index % 9) * 0.38}s`,
}));

export function OneToOneConversationPage() {
  const [stageScale, setStageScale] = useState(1);
  const [messages, setMessages] = useState<ConversationMessage[]>(initialConversationMessages);
  const [inputValue, setInputValue] = useState("");
  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus>("thinking");
  const [avatarHlsUrl, setAvatarHlsUrl] = useState<string | null>(null);
  const [avatarProvider, setAvatarProvider] = useState<AvatarProvider | null>(null);
  // AiAvatarStage의 MuseTalkStageRequest와 같은 모양이어야 한다
  // (session_id·seq를 실어 보내야 서버가 청크 순서를 강제할 수 있다).
  const [museTalkRequest, setMuseTalkRequest] =
    useState<(MuseTalkSpeakRequest & { id: number }) | null>(null);
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [voiceIssue, setVoiceIssue] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<ActiveConversationPanel>("chat");
  const [surveyAnswers, setSurveyAnswers] = useState<SurveyAnswers>({});
  const [surveyCompleted, setSurveyCompleted] = useState(false);
  const [activeMenuId, setActiveMenuId] =
    useState<NavigationMenuId>("new-consultation");
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [consultationId, setConsultationId] = useState<number | null>(null);
  const [surveyQuestions, setSurveyQuestions] = useState<SurveyQuestionData[]>([]);
  const [surveySubmitting, setSurveySubmitting] = useState(false);
  const [surveyError, setSurveyError] = useState<string | null>(null);
  const [reportState, setReportState] = useState<ReportState>(INITIAL_REPORT_STATE);
  const [activeModal, setActiveModal] = useState<ActiveConversationModal>(null);
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
  const avatarQueueRef = useRef<string[]>([]);
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

  const revokeMuseTalkBlobUrl = useCallback((url: string | null) => {
    if (!url?.startsWith("blob:")) return;
    URL.revokeObjectURL(url);
    museTalkBlobUrlsRef.current = museTalkBlobUrlsRef.current.filter((item) => item !== url);
  }, []);

  const revokeMuseTalkBlobUrls = useCallback(() => {
    for (const url of museTalkBlobUrlsRef.current) URL.revokeObjectURL(url);
    museTalkBlobUrlsRef.current = [];
  }, []);

  const resetAvatarSpeech = useCallback(() => {
    museTalkPrefetchGenerationRef.current += 1;
    avatarQueueRef.current = [];
    museTalkPendingTextRef.current = [];
    museTalkPrefetchRunningRef.current = false;
    revokeMuseTalkBlobUrls();
    avatarPlayingRef.current = false;
    setAvatarHlsUrl(null);
    setMuseTalkRequest(null);
  }, [revokeMuseTalkBlobUrls]);

  const enqueueAvatarSpeech = useCallback((hlsUrl: string) => {
    if (!avatarPlayingRef.current) {
      avatarPlayingRef.current = true;
      setAvatarHlsUrl(hlsUrl);
      setAvatarStatus("speaking");
      return;
    }
    avatarQueueRef.current.push(hlsUrl);
  }, []);

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
          enqueueAvatarSpeech(url);
        } catch (error) {
          if (generation === museTalkPrefetchGenerationRef.current) {
            console.error("[MuseTalk]", "prefetch_failed", error);
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
    [enqueueAvatarSpeech],
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
          session_id: sessionId,
          seq,
        });
        setAvatarStatus("speaking");
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
      // 새 답변 = 새 세션. 순번도 0부터 다시 센다.
      speechSessionIdRef.current =
        `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
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
    const nextUrl = avatarQueueRef.current.shift();
    if (!nextUrl) {
      avatarPlayingRef.current = false;
      setAvatarStatus("idle");
      return;
    }

    avatarPlayingRef.current = true;
    setAvatarHlsUrl(nextUrl);
    setAvatarStatus("speaking");
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
    };
  }, [cleanupVoiceResources]);

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
    // 백엔드(#131) 상세요청 응답 → skip_tts=true. 긴 텍스트를 아바타가 읽으면 지연만 커지므로 발화 생략.
    let skipTts = false;
    const flushMuseTalkSentences = (force = false) => {
      if (avatarProvider !== "musetalk" || !MUSE_TALK_STREAM_SENTENCE_FLUSH) return;
      const result = takeCompletedMuseTalkSentences(museTalkSentenceBuffer, force);
      museTalkSentenceBuffer = result.rest;
      if (result.chunks.length === 0) return;
      museTalkStartedFromStream = true;
      console.info("[MuseTalk]", "llm_sentence_flush", result.chunks);
      for (const sentence of result.chunks) enqueueMuseTalkChunk(sentence);
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
          museTalkSentenceBuffer += chunk;
          flushMuseTalkSentences(false);
          if (!started) {
            started = true;
            setMessages((current) => [
              ...current,
              { id: assistantMessageId, role: "assistant", content: chunk },
            ]);
          } else {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, content: message.content + chunk }
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
        setMessages((current) => [
          ...current,
          {
            id: assistantMessageId,
            role: "assistant",
            content: recovered ?? "죄송해요, 응답을 만들지 못했어요. 다시 시도해주세요.",
          },
        ]);
        setAvatarStatus("idle");
        sendingRef.current = false;
        return;
      }

      flushMuseTalkSentences(true);
    } catch (error) {
      const recovered = await recoverAssistantReply();
      setMessages((current) => [
        ...current,
        {
          id: `${assistantMessageId}-error`,
          role: "assistant",
          content:
            recovered ??
            (error instanceof ApiError ? error.message : "응답을 받아오지 못했어요. 다시 시도해주세요."),
        },
      ]);
      resetAvatarSpeech();
      setAvatarStatus("idle");
      sendingRef.current = false;
      return;
    }

    if (avatarProvider === "musetalk") {
      if (skipTts) {
        // 상세요청 응답 — 긴 텍스트라 음성 합성 생략, 텍스트만 노출 (지연 방지).
        // 문장 flush로 첫 문장이 이미 발사됐을 수 있으니(skip_tts는 done에서야 알 수 있음) 중단시킨다.
        console.info("[MuseTalk]", "skip_tts", { reason: "detail_requested", source_chars: reply.length });
        resetAvatarSpeech();
        setAvatarStatus("idle");
      } else {
        const avatarSpeech = toAvatarSpeechText(reply);
        if (perfTraceRef.current) {
          perfTraceRef.current.avatar_speech_chars = avatarSpeech.length;
        }
        console.info("[MuseTalk]", "avatar_speech_text", {
          source_chars: reply.length,
          speech_chars: avatarSpeech.length,
          text: avatarSpeech,
        });
        if (!museTalkStartedFromStream) enqueueMuseTalkSpeech(avatarSpeech);
      }
    } else if (avatarProvider) {
      try {
        await streamAvatarSpeakChunks(reply, (chunk) => enqueueAvatarSpeech(chunk.hls_url));
      } catch {
        resetAvatarSpeech();
        setAvatarStatus("idle");
      }
    } else {
      setAvatarStatus("idle");
    }
    sendingRef.current = false;
  }, [
    avatarProvider,
    consultationId,
    enqueueAvatarSpeech,
    enqueueMuseTalkChunk,
    enqueueMuseTalkSpeech,
    inputValue,
    recoverAssistantReply,
    resetAvatarSpeech,
  ]);

  const handleSpeakingEnd = useCallback(() => {
    if (museTalkRequest) {
      setMuseTalkRequest(null);
      playQueuedAvatarSpeech();
      return;
    }

    revokeMuseTalkBlobUrl(avatarHlsUrl);
    playQueuedAvatarSpeech();
  }, [avatarHlsUrl, museTalkRequest, playQueuedAvatarSpeech, revokeMuseTalkBlobUrl]);

  const handleSpeakingError = useCallback(() => {
    resetAvatarSpeech();
    setAvatarStatus("idle");
  }, [resetAvatarSpeech]);

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

  const handleReportRetry = useCallback(() => {
    reportLoadedForRef.current = null; // 다시 시도하면 한 번 더 받아온다
    setReportState(INITIAL_REPORT_STATE);
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
      if (savedRecommendation) return savedRecommendation;

      const pendingRequest = recommendationRequestRef.current;
      if (pendingRequest?.consultationId === targetConsultationId) {
        return pendingRequest.promise;
      }

      const promise = createRecommendation(targetConsultationId);
      recommendationRequestRef.current = { consultationId: targetConsultationId, promise };
      try {
        return await promise;
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
  }, [activePanel, consultationId, ensureRecommendation]);

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
      const survey = await fetchSurveyItems(consultation.id);
      setSurveyQuestions(toSurveyQuestions(survey.items));
    } catch {
      // 삭제는 완료됐으므로 새 상담 생성 실패 시 기본 화면을 유지한다.
    }
  }, [consultationId, finishVoiceSession]);

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

  const handleConsultationSelect = useCallback(
    async (nextConsultationId: number) => {
      if (nextConsultationId === consultationId) {
        setActiveModal(null);
        setActivePanel("chat");
        return;
      }

      finishVoiceSession(false);
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
    [consultationId, finishVoiceSession],
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
      const topSlug = recommendation?.results[0]?.scenario_slug;
      const params = new URLSearchParams();
      if (topSlug) params.set("slug", topSlug);
      // 추천 목록 팝업의 "체험하기"와 동일하게 consultationId를 실어야 완주 시 이 상담의
      // 최종 리포트에 반영된다 (없으면 ScenarioGamePage가 리포트 생성을 건너뜀).
      if (consultationId) params.set("consultationId", String(consultationId));
      const query = params.toString();
      window.location.assign(query ? `${FRONTEND_ENDPOINTS.scenario}?${query}` : FRONTEND_ENDPOINTS.scenario);
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
    consultationId,
    finishVoiceSession,
    loadConsultationHistory,
    loadRecommendedJobs,
    recommendation,
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
        <ConversationHeader />
        <AvatarStatusBadge status={avatarStatus} />
        <FixedNavigationMenu
          activeMenuId={activeMenuId}
          onSelect={handleNavigationSelect}
        />

        <div className={styles.consultationLayout} data-active-panel={activePanel}>
          <AiAvatarStage
            status={avatarStatus}
            hlsUrl={avatarHlsUrl}
            museTalkRequest={museTalkRequest}
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
          {activeModal === "youthPolicy" ? (
            <YouthPolicyModal key="youth-policy" onClose={() => setActiveModal(null)} />
          ) : null}
        </AnimatePresence>
      </div>
    </main>
  );
}
