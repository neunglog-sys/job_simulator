import { useEffect, useRef } from "react";
import styles from "../../styles/oneToOneConversation.module.css";
import type { ConversationMessage } from "../../types/conversation";
import { MessageBubble } from "./MessageBubble";

type MessageListProps = {
  messages: ConversationMessage[];
};

export function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div
      className={styles.messagesViewport}
      role="log"
      aria-label="AI 직무 마스터와의 대화 내역"
      aria-live="polite"
    >
      <div className={styles.messageList}>
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        <div ref={bottomRef} aria-hidden="true" />
      </div>
    </div>
  );
}
