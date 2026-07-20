import {
  CheckCircle,
  CloudArrowUp,
  FloppyDisk,
  NotePencil,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import styles from "../../styles/scenarioGame.module.css";

export type MemoSaveStatus = "idle" | "saving" | "saved" | "error";

type MemoPanelProps = {
  isOpen: boolean;
  memo: string;
  saveStatus: MemoSaveStatus;
  canSave: boolean;
  isEscapeBlocked?: boolean;
  onSave: (content: string) => void;
  onClose: () => void;
};

const MEMO_MAX_LENGTH = 4000;

export function MemoPanel({
  isOpen,
  memo,
  saveStatus,
  canSave,
  isEscapeBlocked = false,
  onSave,
  onClose,
}: MemoPanelProps) {
  const [draft, setDraft] = useState(memo);
  const previousMemoRef = useRef(memo);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft((current) => (current === previousMemoRef.current ? memo : current));
    previousMemoRef.current = memo;
  }, [memo]);

  useEffect(() => {
    if (!isOpen) return;
    const focusTimer = window.setTimeout(() => textareaRef.current?.focus(), 0);
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !isEscapeBlocked) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isEscapeBlocked, isOpen, onClose]);

  const isDirty = draft !== memo;
  const isSaving = saveStatus === "saving";
  const canSubmit = canSave && isDirty && !isSaving;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canSubmit) onSave(draft);
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
    event.preventDefault();
    if (canSubmit) onSave(draft);
  };

  const status = !canSave
    ? { icon: WarningCircle, text: "서버 연결 후 저장할 수 있어요", tone: "error" }
    : isSaving
      ? { icon: CloudArrowUp, text: "저장 중이에요", tone: "saving" }
      : saveStatus === "error"
        ? { icon: WarningCircle, text: "저장하지 못했어요. 다시 시도해주세요", tone: "error" }
        : isDirty
          ? { icon: NotePencil, text: "저장하지 않은 변경사항이 있어요", tone: "dirty" }
          : { icon: CheckCircle, text: memo ? "저장됐어요" : "새 메모를 작성해보세요", tone: "saved" };
  const StatusIcon = status.icon;

  return (
    <aside
      className={`${styles.memoPanel} ${isOpen ? styles.memoPanelOpen : ""}`}
      aria-label="개인 메모장"
      aria-hidden={!isOpen}
    >
      <div className={styles.memoPanelHeader}>
        <span className={styles.memoPanelIcon} aria-hidden="true">
          <NotePencil weight="bold" />
        </span>
        <span>
          <small>PERSONAL NOTE</small>
          <strong>메모하기</strong>
        </span>
        <button type="button" onClick={onClose} aria-label="메모장 닫기">
          <X weight="bold" />
        </button>
      </div>

      <div className={styles.memoPanelIntro}>
        <strong>나만의 업무 노트</strong>
        <p>사수에게 배운 내용과 꼭 기억할 점을 자유롭게 적어보세요.</p>
      </div>

      <form className={styles.memoForm} onSubmit={handleSubmit}>
        <div className={styles.memoPaper}>
          <textarea
            ref={textareaRef}
            value={draft}
            maxLength={MEMO_MAX_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleTextareaKeyDown}
            placeholder="예: 업무 시작 전 확인할 것, 사수가 알려준 팁, 다음에 물어볼 내용"
            aria-label="개인 메모 내용"
          />
          <span className={styles.memoCharacterCount}>
            {draft.length.toLocaleString("ko-KR")} / {MEMO_MAX_LENGTH.toLocaleString("ko-KR")}
          </span>
        </div>

        <div className={styles.memoPanelFooter}>
          <span className={styles.memoSaveStatus} data-tone={status.tone} role="status">
            <StatusIcon weight="fill" aria-hidden="true" />
            {status.text}
          </span>
          <button className={styles.memoSaveButton} type="submit" disabled={!canSubmit}>
            <FloppyDisk weight="bold" aria-hidden="true" />
            {isSaving ? "저장 중" : "저장"}
          </button>
        </div>
      </form>
    </aside>
  );
}
