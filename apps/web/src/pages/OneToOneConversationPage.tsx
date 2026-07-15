import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AiAvatarStage } from "../components/conversation/AiAvatarStage";
import { AvatarStatusBadge } from "../components/conversation/AvatarStatusBadge";
import { ConversationHeader } from "../components/conversation/ConversationHeader";
import { ConversationPanel } from "../components/conversation/ConversationPanel";
import { initialConversationMessages } from "../data/conversationMockData";
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
  const voiceStreamRef = useRef<MediaStream | null>(null);

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
    setAvatarStatus("thinking");

    await requestJobMasterResponse(nextMessages);
    setAvatarStatus("idle");
  }, [inputValue, messages]);

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
            <AiAvatarStage status={avatarStatus} />
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
