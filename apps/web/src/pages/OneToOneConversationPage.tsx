import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AiAvatarStage } from "../components/conversation/AiAvatarStage";
import { AvatarStatusBadge } from "../components/conversation/AvatarStatusBadge";
import { CoachIdentity } from "../components/conversation/CoachIdentity";
import { ConversationHeader } from "../components/conversation/ConversationHeader";
import { ConversationPanel } from "../components/conversation/ConversationPanel";
import { FixedNavigationMenu } from "../components/conversation/FixedNavigationMenu";
import { SurveyDrawer } from "../components/conversation/SurveyDrawer";
import { SurveyTestToggleButton } from "../components/conversation/SurveyTestToggleButton";
import { FRONTEND_ENDPOINTS } from "../config/endpoints";
import { initialConversationMessages } from "../data/conversationMockData";
import styles from "../styles/oneToOneConversation.module.css";
import type {
  AvatarStatus,
  ConversationMessage,
  NavigationMenuId,
  RecordingState,
} from "../types/conversation";
import type { SurveyAnswers } from "../types/survey";

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

const showSurveyTestButton =
  import.meta.env.DEV || import.meta.env.VITE_SHOW_SURVEY_TEST_BUTTON === "true";

const STAR_POINTS = Array.from({ length: 54 }, (_, index) => ({
  left: `${(index * 37 + 7) % 98}%`,
  top: `${(index * 61 + 5) % 92}%`,
  size: index % 13 === 0 ? 3 : index % 5 === 0 ? 2 : 1,
  delay: `${-(index % 9) * 0.38}s`,
}));

async function requestJobMasterResponse(_messages: ConversationMessage[]) {
  // AI API 연결 지점: 응답을 받은 뒤 assistant 메시지를 messages에 추가한다.
  return Promise.resolve();
}

export function OneToOneConversationPage() {
  const [stageScale, setStageScale] = useState(1);
  const [messages, setMessages] = useState<ConversationMessage[]>(initialConversationMessages);
  const [inputValue, setInputValue] = useState("");
  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus>("thinking");
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [isChatExpanded, setIsChatExpanded] = useState(false);
  const [isSurveyOpen, setIsSurveyOpen] = useState(false);
  const [surveyAnswers, setSurveyAnswers] = useState<SurveyAnswers>({});
  const [activeMenuId, setActiveMenuId] =
    useState<NavigationMenuId>("new-consultation");
  const [voiceLevel, setVoiceLevel] = useState(0);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceAudioContextRef = useRef<AudioContext | null>(null);
  const voiceSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const voiceAnimationFrameRef = useRef<number | null>(null);
  const voiceProcessingTimerRef = useRef<number | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceSessionActiveRef = useRef(false);
  const voiceInputBaseRef = useRef("");

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

  const handleSendMessage = useCallback(async () => {
    const content = inputValue.trim();
    if (!content) return;

    const userMessage: ConversationMessage = {
      id: `message-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    setInputValue("");
    setAvatarStatus("thinking");

    await requestJobMasterResponse(nextMessages);
    setAvatarStatus("idle");
  }, [inputValue, messages]);

  const handleVoiceInput = useCallback(async () => {
    if (recordingState === "recording") {
      finishVoiceSession();
      return;
    }

    if (recordingState !== "idle") return;

    setRecordingState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;
      voiceSessionActiveRef.current = true;
      voiceInputBaseRef.current = inputValue.trim();
      setRecordingState("recording");
      setAvatarStatus("listening");

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

      if (SpeechRecognitionClass) {
        const recognition = new SpeechRecognitionClass();
        recognition.lang = "ko-KR";
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (event) => {
          let finalTranscript = "";
          let interimTranscript = "";

          for (let index = 0; index < event.results.length; index += 1) {
            const result = event.results[index];
            const transcript = result[0]?.transcript ?? "";
            if (result.isFinal) finalTranscript += `${transcript} `;
            else interimTranscript += transcript;
          }

          setInputValue(
            [voiceInputBaseRef.current, finalTranscript.trim(), interimTranscript.trim()]
              .filter(Boolean)
              .join(" "),
          );
        };
        recognition.onerror = (event) => {
          if (event.error !== "aborted") finishVoiceSession();
        };
        recognition.onend = () => {
          if (voiceSessionActiveRef.current) finishVoiceSession();
        };
        speechRecognitionRef.current = recognition;
        recognition.start();
      }

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
    } catch {
      voiceSessionActiveRef.current = false;
      cleanupVoiceResources();
      setVoiceLevel(0);
      setRecordingState("idle");
      setAvatarStatus("idle");
    }
  }, [cleanupVoiceResources, finishVoiceSession, inputValue, recordingState]);

  const openSurvey = useCallback(() => setIsSurveyOpen(true), []);
  const closeSurvey = useCallback(() => setIsSurveyOpen(false), []);

  const handleSurveyAnswerChange = useCallback((questionId: string, value: string) => {
    setSurveyAnswers((current) => ({ ...current, [questionId]: value }));
  }, []);

  const handleSurveySubmit = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("jobiverse:submit-conversation-survey", {
        detail: surveyAnswers,
      }),
    );
    setIsSurveyOpen(false);
    setAvatarStatus("thinking");
  }, [surveyAnswers]);

  const handleNavigationSelect = useCallback((id: NavigationMenuId) => {
    setActiveMenuId(id);

    if (id === "virtual-company") {
      window.location.assign(FRONTEND_ENDPOINTS.scenario);
      return;
    }

    if (id === "new-consultation") {
      finishVoiceSession(false);
      setMessages(initialConversationMessages);
      setInputValue("");
      setAvatarStatus("thinking");
      setIsChatExpanded(false);
      setIsSurveyOpen(false);
      setSurveyAnswers({});
      return;
    }

    window.dispatchEvent(new CustomEvent(`jobiverse:${id}`));
  }, [finishVoiceSession]);

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
        <CoachIdentity />
        <AvatarStatusBadge status={avatarStatus} />
        <FixedNavigationMenu
          activeMenuId={activeMenuId}
          onSelect={handleNavigationSelect}
        />

        <SurveyDrawer
          open={isSurveyOpen}
          answers={surveyAnswers}
          onAnswerChange={handleSurveyAnswerChange}
          onClose={closeSurvey}
          onSubmit={handleSurveySubmit}
        />

        <AiAvatarStage status={avatarStatus}>
          <img
            className={styles.avatarMedia}
            src="/assets/ai-job-master.png"
            alt="AI 직무 마스터 아바타"
          />
        </AiAvatarStage>

        <ConversationPanel
          messages={messages}
          inputValue={inputValue}
          recordingState={recordingState}
          voiceLevel={voiceLevel}
          expanded={isChatExpanded}
          onInputChange={setInputValue}
          onSend={handleSendMessage}
          onVoiceInput={handleVoiceInput}
          onToggleExpanded={() => setIsChatExpanded((current) => !current)}
          onOpenSurvey={openSurvey}
        />

        {showSurveyTestButton ? (
          <SurveyTestToggleButton
            open={isSurveyOpen}
            onToggle={() => setIsSurveyOpen((current) => !current)}
          />
        ) : null}
      </div>
    </main>
  );
}
