import { ChatCircleDots, ClockCounterClockwise } from "@phosphor-icons/react";
import type { ConsultationSummary } from "../../lib/api";
import styles from "../../styles/oneToOneConversation.module.css";
import { ConversationModalShell } from "./ConversationModalShell";

type ConversationHistoryModalProps = {
  currentConsultationId: number | null;
  items: ConsultationSummary[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelect: (consultationId: number) => void;
  onClose: () => void;
};

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function ConversationHistoryModal({
  currentConsultationId,
  items,
  loading,
  error,
  onRetry,
  onSelect,
  onClose,
}: ConversationHistoryModalProps) {
  return (
    <ConversationModalShell
      title="대화 목록"
      description="이전에 나눈 상담을 선택하면 해당 대화부터 이어갈 수 있어요."
      icon={ClockCounterClockwise}
      onClose={onClose}
    >
      {loading ? (
        <div className={styles.conversationHistorySkeleton} aria-label="대화 목록 불러오는 중">
          {Array.from({ length: 4 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
      ) : error ? (
        <div className={styles.conversationModalState} role="alert">
          <ChatCircleDots weight="duotone" aria-hidden="true" />
          <strong>대화 목록을 불러오지 못했어요.</strong>
          <p>{error}</p>
          <button type="button" onClick={onRetry}>다시 불러오기</button>
        </div>
      ) : items.length === 0 ? (
        <div className={styles.conversationModalState}>
          <ChatCircleDots weight="duotone" aria-hidden="true" />
          <strong>아직 저장된 상담이 없어요.</strong>
          <p>새로운 상담을 시작하면 이곳에 자동으로 기록됩니다.</p>
        </div>
      ) : (
        <div className={styles.conversationHistoryList}>
          {items.map((item) => {
            const isCurrent = item.id === currentConsultationId;
            return (
              <button
                key={item.id}
                className={styles.conversationHistoryItem}
                type="button"
                onClick={() => onSelect(item.id)}
                aria-current={isCurrent ? "true" : undefined}
              >
                <span className={styles.conversationHistoryItemIcon} aria-hidden="true">
                  <ChatCircleDots weight="duotone" />
                </span>
                <span className={styles.conversationHistoryCopy}>
                  <span className={styles.conversationHistoryTitleRow}>
                    <strong>{item.title}</strong>
                    {isCurrent ? <small>현재 상담</small> : null}
                  </span>
                  <span>{item.preview}</span>
                </span>
                <span className={styles.conversationHistoryMeta}>
                  <time dateTime={item.updated_at}>
                    {dateFormatter.format(new Date(item.updated_at))}
                  </time>
                  <small>메시지 {item.message_count}개</small>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </ConversationModalShell>
  );
}
