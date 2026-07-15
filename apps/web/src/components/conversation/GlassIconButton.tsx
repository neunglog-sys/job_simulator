import type { Icon } from "@phosphor-icons/react";
import styles from "../../styles/oneToOneConversation.module.css";

type GlassIconButtonProps = {
  icon: Icon;
  label: string;
  onClick: () => void;
};

export function GlassIconButton({ icon: IconComponent, label, onClick }: GlassIconButtonProps) {
  return (
    <button className={styles.glassIconButton} type="button" onClick={onClick} aria-label={label}>
      <IconComponent aria-hidden="true" weight="regular" />
    </button>
  );
}
