import {
  ChatCircleDots,
  Check,
  ClockCounterClockwise,
  PencilSimple,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
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
  onRename: (consultationId: number, title: string) => Promise<void>;
  onDelete: (consultationId: number) => Promise<void>;
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
  onRename,
  onDelete,
  onClose,
}: ConversationHistoryModalProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<{ id: number; message: string } | null>(null);
  const visibleItems = items.filter((item) => item.message_count > 0);

  const startEditing = (item: ConsultationSummary) => {
    setDeleteConfirmId(null);
    setActionError(null);
    setEditingId(item.id);
    setTitleDraft(item.title);
  };

  const submitTitle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editingId === null) return;
    const title = titleDraft.trim().replace(/\s+/g, " ");
    if (!title) {
      setActionError({ id: editingId, message: "상담 제목을 입력해주세요." });
      return;
    }

    setBusyId(editingId);
    setActionError(null);
    try {
      await onRename(editingId, title);
      setEditingId(null);
    } catch (renameError) {
      setActionError({
        id: editingId,
        message: renameError instanceof Error ? renameError.message : "제목을 수정하지 못했어요.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async (consultationId: number) => {
    setBusyId(consultationId);
    setActionError(null);
    try {
      await onDelete(consultationId);
      setDeleteConfirmId(null);
    } catch (deleteError) {
      setActionError({
        id: consultationId,
        message: deleteError instanceof Error ? deleteError.message : "상담을 삭제하지 못했어요.",
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ConversationModalShell
      title="대화 목록"
      description="이전에 나눈 상담을 선택하면 해당 대화부터 이어갈 수 있어요."
      icon={ClockCounterClockwise}
      onClose={onClose}
    >
      {loading ? (
        <div className={styles.conversationModalState} aria-live="polite">
          <ClockCounterClockwise weight="duotone" aria-hidden="true" />
          <strong>대화 목록을 불러오고 있어요.</strong>
          <p>잠시만 기다려주세요.</p>
        </div>
      ) : error ? (
        <div className={styles.conversationModalState} role="alert">
          <ChatCircleDots weight="duotone" aria-hidden="true" />
          <strong>대화 목록을 불러오지 못했어요.</strong>
          <p>{error}</p>
          <button type="button" onClick={onRetry}>다시 불러오기</button>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className={styles.conversationModalState}>
          <ChatCircleDots weight="duotone" aria-hidden="true" />
          <strong>아직 저장된 상담이 없어요.</strong>
          <p>새로운 상담을 시작하면 이곳에 자동으로 기록됩니다.</p>
        </div>
      ) : (
        <div className={styles.conversationHistoryList}>
          {visibleItems.map((item) => {
            const isCurrent = item.id === currentConsultationId;
            const isEditing = editingId === item.id;
            const isConfirmingDelete = deleteConfirmId === item.id;
            const isBusy = busyId === item.id;
            return (
              <div
                key={item.id}
                className={`${styles.conversationHistoryItem} ${isConfirmingDelete ? styles.conversationHistoryItemConfirming : ""}`}
                aria-current={isCurrent ? "true" : undefined}
              >
                {isEditing ? (
                  <form className={styles.conversationHistoryEditForm} onSubmit={submitTitle}>
                    <span className={styles.conversationHistoryItemIcon} aria-hidden="true">
                      <PencilSimple weight="duotone" />
                    </span>
                    <label className={styles.conversationHistoryEditField}>
                      <span className={styles.srOnly}>상담 제목</span>
                      <input
                        autoFocus
                        maxLength={80}
                        value={titleDraft}
                        onChange={(event) => setTitleDraft(event.target.value)}
                        disabled={isBusy}
                      />
                    </label>
                    <span className={styles.conversationHistoryEditActions}>
                      <button type="submit" disabled={isBusy} aria-label="상담 제목 저장">
                        <Check aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setEditingId(null)}
                        aria-label="제목 수정 취소"
                      >
                        <X aria-hidden="true" />
                      </button>
                    </span>
                  </form>
                ) : (
                  <>
                    <button
                      className={styles.conversationHistorySelect}
                      type="button"
                      onClick={() => onSelect(item.id)}
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
                    <span
                      className={`${styles.conversationHistoryActions} ${isConfirmingDelete ? styles.conversationHistoryActionsConfirm : ""}`}
                    >
                      {isConfirmingDelete ? (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setDeleteConfirmId(null)}
                          >
                            취소
                          </button>
                          <button
                            className={styles.conversationHistoryDeleteConfirm}
                            type="button"
                            disabled={isBusy}
                            onClick={() => void confirmDelete(item.id)}
                          >
                            삭제
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => startEditing(item)}
                            aria-label={`${item.title} 제목 수정`}
                            title="제목 수정"
                          >
                            <PencilSimple aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                              setActionError(null);
                              setDeleteConfirmId(item.id);
                            }}
                            aria-label={`${item.title} 삭제`}
                            title="상담 삭제"
                          >
                            <Trash aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </span>
                  </>
                )}
                {actionError?.id === item.id ? (
                  <small className={styles.conversationHistoryActionError} role="alert">
                    {actionError.message}
                  </small>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </ConversationModalShell>
  );
}
