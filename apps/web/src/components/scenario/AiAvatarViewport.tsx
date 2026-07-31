import { Robot } from "@phosphor-icons/react";
import type { PropsWithChildren } from "react";
import styles from "../../styles/scenarioGame.module.css";

export function AiAvatarViewport({ children }: PropsWithChildren) {
  return (
    <div className={styles.avatarViewport} aria-label="실시간 AI 아바타 영역">
      {children ?? (
        <div className={styles.avatarPlaceholder} aria-hidden="true">
          <span className={styles.avatarHalo} />
          <span className={styles.avatarFace}>
            <Robot weight="duotone" />
          </span>
          <span className={styles.avatarBody} />
        </div>
      )}
      <span className={styles.liveBadge}>
        <i aria-hidden="true" /> LIVE
      </span>
    </div>
  );
}
