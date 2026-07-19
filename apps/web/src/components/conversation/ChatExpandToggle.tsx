import styles from "../../styles/oneToOneConversation.module.css";

type ChatExpandToggleProps = {
  expanded: boolean;
  onToggle: () => void;
};

export function ChatExpandToggle({ expanded, onToggle }: ChatExpandToggleProps) {
  return (
    <button
      className={styles.chatExpandToggle}
      type="button"
      onClick={onToggle}
      aria-label={expanded ? "채팅창 접기" : "채팅창 펼치기"}
      aria-expanded={expanded}
    >
      <span aria-hidden="true" />
    </button>
  );
}
