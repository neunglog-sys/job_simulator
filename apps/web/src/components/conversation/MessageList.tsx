import { useLayoutEffect, useRef } from "react";
import styles from "../../styles/oneToOneConversation.module.css";
import type { ConversationMessage } from "../../types/conversation";
import { GlassScrollbar } from "./GlassScrollbar";
import { MessageBubble } from "./MessageBubble";

type MessageListProps = {
  messages: ConversationMessage[];
  onOpenSurvey: () => void;
};

export function MessageList({ messages, onOpenSurvey }: MessageListProps) {
  const viewportRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [messages]);

  return (
    <>
      <div
        ref={viewportRef}
        className={styles.messagesViewport}
        role="log"
        aria-label="AI 직무 마스터와의 대화 내역"
        aria-live="polite"
      >
        <div className={styles.messageList}>
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} onOpenSurvey={onOpenSurvey} />
          ))}
        </div>
      </div>
      <GlassScrollbar
        viewportRef={viewportRef}
        className={styles.messageScrollbar}
        refreshKey={messages.length}
      />
    </>
  );
}
