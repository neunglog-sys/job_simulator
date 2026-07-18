import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AiAvatarStage } from "../components/conversation/AiAvatarStage";
import { AvatarStatusBadge } from "../components/conversation/AvatarStatusBadge";
import { ConversationHeader } from "../components/conversation/ConversationHeader";
import { ConversationPanel } from "../components/conversation/ConversationPanel";
import { initialConversationMessages } from "../data/conversationMockData";
import { createConsultation, speakAvatar, streamConsultationReply } from "../lib/api";
import styles from "../styles/oneToOneConversation.module.css";
import type {
  AvatarStatus,
  ConversationMessage,
  RecordingState,
} from "../types/conversation";

type StageStyle = CSSProperties & {
  "--conversation-scale": number;
};

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 900;

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
  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus>("idle");
  const [avatarHlsUrl, setAvatarHlsUrl] = useState<string | null>(null);
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const consultationIdRef = useRef<number | null>(null);

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

  useEffect(() => {
    const updateScale = () => {
      setStageScale(Math.min(1, window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT));
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  useEffect(
    () => () => {
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

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

    try {
      const { hls_url } = await speakAvatar(reply);
      setAvatarHlsUrl(hls_url);
      setAvatarStatus("speaking"); // 재생 종료는 AiAvatarStage의 onEnded → handleSpeakingEnd
    } catch {
      // 아바타 미설정(Colab 세션 없음)·장애 → 텍스트만 보여주고 idle 루프 유지
      setAvatarHlsUrl(null);
      setAvatarStatus("idle");
    }
  }, [inputValue, messages]);

  const handleSpeakingEnd = useCallback(() => {
    // hlsUrl은 여기서 지우지 않는다 — 지우면 <video>가 즉시 비워져 페이드 도중에 깜빡인다.
    // 다음 발화를 보낼 때 어차피 교체되므로 마지막 프레임을 남겨둔 채 idle로 페이드하면 된다.
    setAvatarStatus("idle");
  }, []);

  const handleVoiceInput = useCallback(async () => {
    if (recordingState === "recording") {
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      voiceStreamRef.current = null;
      setRecordingState("processing");
      setAvatarStatus("thinking");

      // 음성 인식 API 연결 전에는 녹음 종료 상태만 정리한다.
      window.setTimeout(() => {
        setRecordingState("idle");
        setAvatarStatus("idle");
      }, 450);
      return;
    }

    if (recordingState !== "idle") return;

    setRecordingState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;
      setRecordingState("recording");
      setAvatarStatus("listening");
    } catch {
      setRecordingState("idle");
      setAvatarStatus("idle");
    }
  }, [recordingState]);

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

      <div
        className={styles.stage}
        style={{ "--conversation-scale": stageScale } as StageStyle}
      >
        <ConversationHeader />
        <div className={styles.conversationMain}>
          <div className={styles.avatarColumn}>
            <AiAvatarStage
              status={avatarStatus}
              hlsUrl={avatarHlsUrl}
              onSpeakingEnd={handleSpeakingEnd}
            />
            <AvatarStatusBadge status={avatarStatus} />
          </div>
          <ConversationPanel
            messages={messages}
            inputValue={inputValue}
            recordingState={recordingState}
            onInputChange={setInputValue}
            onSend={handleSendMessage}
            onVoiceInput={handleVoiceInput}
          />
        </div>
      </div>
    </main>
  );
}
