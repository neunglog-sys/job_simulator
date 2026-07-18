import type { Icon } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import styles from "../../styles/oneToOneConversation.module.css";
import type { NavigationMenuId } from "../../types/conversation";

type NavigationMenuItemProps = {
  id: NavigationMenuId;
  label: string;
  icon: Icon;
  top: number;
  active: boolean;
  onSelect: (id: NavigationMenuId) => void;
};

export function NavigationMenuItem({
  id,
  label,
  icon: IconComponent,
  top,
  active,
  onSelect,
}: NavigationMenuItemProps) {
  return (
    <button
      className={styles.navigationMenuItem}
      style={{ top } as CSSProperties}
      type="button"
      onClick={() => onSelect(id)}
      aria-current={active ? "page" : undefined}
    >
      <span className={styles.navigationMenuIcon} aria-hidden="true">
        <IconComponent weight="duotone" />
      </span>
      <span className={styles.navigationMenuLabel}>{label}</span>
    </button>
  );
}
