import styles from "../../styles/oneToOneConversation.module.css";
import type { AvatarStatus } from "../../types/conversation";

const STATUS_LABELS: Record<AvatarStatus, string> = {
  idle: "직무 마스터와 대화를 시작해보세요.",
  listening: "직무 마스터가 이야기를 듣고 있어요•••",
  thinking: "직무 마스터가 딱 맞는 직업을 찾아보는 중•••",
  speaking: "직무 마스터가 답변하고 있어요•••",
};

type AvatarStatusBadgeProps = {
  status: AvatarStatus;
};

export function AvatarStatusBadge({ status }: AvatarStatusBadgeProps) {
  return (
    <div className={styles.avatarStatusBadge} role="status" aria-live="polite">
      {STATUS_LABELS[status]}
    </div>
  );
}
