import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AiAvatarStage } from "../components/conversation/AiAvatarStage";
import { AvatarStatusBadge } from "../components/conversation/AvatarStatusBadge";
import { ConversationHeader } from "../components/conversation/ConversationHeader";
import { ConversationPanel } from "../components/conversation/ConversationPanel";
import { FinalReportPanel } from "../components/conversation/FinalReportPanel";
import { FixedNavigationMenu } from "../components/conversation/FixedNavigationMenu";
import { PanelIndexTabs } from "../components/conversation/PanelIndexTabs";
import { SurveyDrawer } from "../components/conversation/SurveyDrawer";
import { YouthPolicyCard } from "../components/conversation/YouthPolicyCard";
import { FRONTEND_ENDPOINTS } from "../config/endpoints";
import { initialConversationMessages } from "../data/conversationMockData";
import { createConsultation, speakAvatar, streamConsultationReply } from "../lib/api";
import styles from "../styles/oneToOneConversation.module.css";
import type {
  AvatarStatus,
  ActiveConversationPanel,
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
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [voiceIssue, setVoiceIssue] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<ActiveConversationPanel>("chat");
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
  const consultationIdRef = useRef<number | null>(null);
  const voiceFinalTranscriptRef = useRef("");

  // 상담 세션은 화면 진입 시 한 번만 만든다 (메시지 전송 때 이 id로 SSE 스트리밍).
  useEffect(() => {
    let alive = true;
    createConsultation()
      .then((c) => {
        if (alive) consultationIdRef.current = c.id;
      })
      .catch(() => {
        // 로그인 안 됨/백엔드 다운 — 전송 시점에 사용자에게 알린다
      });
    return () => {
      alive = false;
    };
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
    // 아바타 첫 프레임까지 약 7초 걸린다(Gradio 큐 오버헤드 — 실측). 그동안 계속 thinking 유지.
    // 인위적 타임아웃을 두면 안 된다 — 응답이 오기 전에 idle로 돌아가버린다.
    setAvatarStatus("thinking");
    setAvatarHlsUrl(null);

    const consultationId = consultationIdRef.current;
    if (consultationId == null) {
      setMessages((prev) => [
        ...prev,
        {
          id: `message-${Date.now()}-err`,
          role: "assistant",
          content: "상담 세션을 시작하지 못했어요. 로그인 상태와 서버를 확인해주세요.",
          createdAt: new Date().toISOString(),
        },
      ]);
      setAvatarStatus("idle");
      return;
    }

    // LLM 응답을 토큰 단위로 받아 말풍선에 바로 흘린다.
    // 아바타 영상보다 텍스트가 훨씬 먼저 나오므로, 7초 기다리는 동안 읽을 거리가 생긴다.
    const aiId = `message-${Date.now()}-ai`;
    setMessages((prev) => [
      ...prev,
      { id: aiId, role: "assistant", content: "", createdAt: new Date().toISOString() },
    ]);

    let reply = "";
    try {
      for await (const token of streamConsultationReply(consultationId, content)) {
        reply += token;
        setMessages((prev) => prev.map((m) => (m.id === aiId ? { ...m, content: reply } : m)));
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "응답을 받지 못했어요.";
      setMessages((prev) => prev.map((m) => (m.id === aiId ? { ...m, content: detail } : m)));
      setAvatarStatus("idle");
      return;
    }

    if (!reply.trim()) {
      setAvatarStatus("idle");
      return;
    }

    // 전체 응답(reply)을 한 번에 발화 생성한다. 백엔드가 연속 타임라인 HLS로 재봉합해 주므로
    // 프론트는 하나의 연속 스트림만 재생하면 된다(조각 이어붙이기 없음 → 이음매 없음).
    try {
      const { hls_url } = await speakAvatar(reply);
      setAvatarHlsUrl(hls_url);
      setAvatarStatus("speaking"); // 재생 종료 → AiAvatarStage onEnded → handleSpeakingEnd
    } catch {
      // 아바타 미설정(Colab 세션 없음)·장애 → 텍스트만 보여주고 idle 유지
      setAvatarHlsUrl(null);
      setAvatarStatus("idle");
    }
  }, [inputValue, messages]);

  const handleSpeakingEnd = useCallback(() => {
    // 발화 영상이 끝나면 idle로. hlsUrl은 지우지 않는다(지우면 <video>가 비워져 깜빡임).
    setAvatarStatus("idle");
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

  const handleSurveySubmit = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("jobiverse:submit-conversation-survey", {
        detail: surveyAnswers,
      }),
    );
    setActivePanel("report");
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
      setActivePanel("chat");
      setVoiceIssue(null);
      setSurveyAnswers({});
      return;
    }

    if (id === "final-report") {
      setActivePanel("report");
      return;
    }

    window.dispatchEvent(new CustomEvent(`jobiverse:${id}`));
  }, [finishVoiceSession]);

  const handlePanelChange = useCallback((panel: ActiveConversationPanel) => {
    setActivePanel(panel);
    if (panel === "report") setActiveMenuId("final-report");
  }, []);

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
            onSpeakingEnd={handleSpeakingEnd}
          />

          {activePanel === "chat" ? <YouthPolicyCard /> : null}

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
              answers={surveyAnswers}
              onAnswerChange={handleSurveyAnswerChange}
              onSubmit={handleSurveySubmit}
            />
          ) : null}

          {activePanel === "report" ? <FinalReportPanel /> : null}

          <PanelIndexTabs activePanel={activePanel} onChange={handlePanelChange} />
        </div>
      </div>
    </main>
  );
}
