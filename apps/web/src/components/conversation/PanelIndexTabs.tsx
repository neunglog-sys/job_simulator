import { ChatCircleDots, ClipboardText, FileText } from "@phosphor-icons/react";
import styles from "../../styles/oneToOneConversation.module.css";
import type { ActiveConversationPanel } from "../../types/conversation";

const PANEL_TABS = [
  { id: "chat", label: "채팅", icon: ChatCircleDots },
  { id: "survey", label: "설문", icon: ClipboardText },
  { id: "report", label: "최종 리포트", icon: FileText },
] as const;

type PanelIndexTabsProps = {
  activePanel: ActiveConversationPanel;
  onChange: (panel: ActiveConversationPanel) => void;
};

export function PanelIndexTabs({ activePanel, onChange }: PanelIndexTabsProps) {
  return (
    <nav className={styles.panelIndexTabs} aria-label="상담 패널 선택">
      {PANEL_TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={`${styles.panelIndexTab} ${
            activePanel === id ? styles.panelIndexTabActive : ""
          }`}
          data-panel={id}
          type="button"
          onClick={() => onChange(id)}
          aria-label={`${label} 패널 열기`}
          aria-pressed={activePanel === id}
        >
          <Icon aria-hidden="true" weight={activePanel === id ? "fill" : "duotone"} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
