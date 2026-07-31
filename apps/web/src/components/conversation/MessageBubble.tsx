import styles from "../../styles/oneToOneConversation.module.css";
import type { ConversationMessage } from "../../types/conversation";
import { RichText } from "./RichText";
import { SurveyStartMessageButton } from "./SurveyStartMessageButton";

type MessageBubbleProps = {
  message: ConversationMessage;
  onOpenSurvey: () => void;
};

export function MessageBubble({ message, onOpenSurvey }: MessageBubbleProps) {
  const assistant = message.role === "assistant";
  const rowClassName = `${styles.messageRow} ${
    assistant ? styles.messageRowAssistant : styles.messageRowUser
  }`;
  const bubbleClassName = `${styles.messageBubble} ${
    assistant ? styles.assistantBubble : styles.userBubble
  } ${message.phase === "pending" ? styles.messageBubblePending : ""} ${
    message.phase === "streaming" ? styles.messageBubbleStreaming : ""
  }`;

  return (
    <div className={rowClassName}>
      <div className={bubbleClassName}>
        <span>
          {/* 굵은 라벨·목록은 프롬프트가 의도한 형식이라 원문 노출 대신 렌더한다(RichText) */}
          <RichText text={message.content} />
          {message.phase === "pending" ? (
            <span className={styles.messageTypingDots} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          ) : null}
          {message.phase === "streaming" ? (
            <span className={styles.messageStreamingCursor} aria-hidden="true" />
          ) : null}
        </span>
        {message.action === "open-survey" ? (
          <SurveyStartMessageButton onClick={onOpenSurvey} />
        ) : null}
      </div>
    </div>
  );
}
