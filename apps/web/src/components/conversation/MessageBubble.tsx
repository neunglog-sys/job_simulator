import styles from "../../styles/oneToOneConversation.module.css";
import type { ConversationMessage } from "../../types/conversation";

type MessageBubbleProps = {
  message: ConversationMessage;
};

export function MessageBubble({ message }: MessageBubbleProps) {
  const isMultiline = message.content.includes("\n") || message.content.length > 42;
  const className = [
    styles.messageBubble,
    message.role === "assistant" ? styles.assistantBubble : styles.userBubble,
    isMultiline ? styles.multilineBubble : "",
  ]
    .filter(Boolean)
    .join(" ");

  return <div className={className}>{message.content}</div>;
}
