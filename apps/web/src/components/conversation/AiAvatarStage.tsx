import type { ReactNode } from "react";
import styles from "../../styles/oneToOneConversation.module.css";
import type { AvatarStatus } from "../../types/conversation";

type AiAvatarStageProps = {
  children?: ReactNode;
  status?: AvatarStatus;
};

export function AiAvatarStage({ children, status = "idle" }: AiAvatarStageProps) {
  return (
    <section className={styles.avatarStage} data-avatar-status={status} aria-label="AI 직무 마스터 화면">
      <div className={styles.avatarAmbientLight} aria-hidden="true" />
      {children ? <div className={styles.avatarContent}>{children}</div> : null}
    </section>
  );
}
