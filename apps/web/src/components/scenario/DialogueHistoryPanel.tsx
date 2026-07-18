import { CaretUp, ChatCenteredDots, UserCircle, X } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import styles from "../../styles/scenarioGame.module.css";

export type DialogueHistoryEntry = {
  id: number;
  speaker: string;
  role: "npc" | "user";
  text: string;
};

type DialogueHistoryPanelProps = {
  isOpen: boolean;
  entries: DialogueHistoryEntry[];
  onClose: () => void;
};

export function DialogueHistoryPanel({ isOpen, entries, onClose }: DialogueHistoryPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [entries, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <aside
      className={`${styles.historyPanel} ${isOpen ? styles.historyPanelOpen : ""}`}
      aria-label="이전 대화 기록"
      aria-hidden={!isOpen}
    >
      <div className={styles.historyPanelHeader}>
        <span className={styles.historyTitleIcon} aria-hidden="true">
          <ChatCenteredDots weight="duotone" />
        </span>
        <span>
          <small>DIALOGUE FLOW</small>
          <strong>이전 대화</strong>
        </span>
        <span className={styles.historyCount}>{entries.length}</span>
        <button type="button" onClick={onClose} aria-label="이전 대화 닫기">
          <X weight="bold" />
        </button>
      </div>

      <div className={styles.historyList} ref={listRef}>
        {entries.length ? (
          entries.map((entry) => (
            <article
              className={`${styles.historyEntry} ${entry.role === "user" ? styles.historyEntryUser : ""}`}
              key={entry.id}
            >
              <span className={styles.historyAvatar} aria-hidden="true">
                <UserCircle weight={entry.role === "user" ? "fill" : "duotone"} />
              </span>
              <div>
                <strong>{entry.speaker}</strong>
                <p>{entry.text}</p>
              </div>
            </article>
          ))
        ) : (
          <div className={styles.historyEmpty}>
            <ChatCenteredDots weight="duotone" aria-hidden="true" />
            <strong>아직 나눈 대화가 없어요</strong>
            <p>NPC에게 말을 걸면 이곳에 대화 흐름이 차곡차곡 기록됩니다.</p>
          </div>
        )}
      </div>

      <button className={styles.historyCollapseButton} type="button" onClick={onClose}>
        <CaretUp weight="bold" aria-hidden="true" />
        <span>대화창으로 돌아가기</span>
      </button>
    </aside>
  );
}
