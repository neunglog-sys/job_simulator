import styles from "../../styles/oneToOneConversation.module.css";
import type { ConversationMessage } from "../../types/conversation";
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
  }`;

  return (
    <div className={rowClassName}>
      <div className={bubbleClassName}>
        <span>{message.content}</span>
        {message.action === "open-survey" ? (
          <SurveyStartMessageButton onClick={onOpenSurvey} />
        ) : null}
      </div>
    </div>
  );
}
