import { LightbulbFilament, X } from "@phosphor-icons/react";
import { HintCard } from "./HintCard";
import type { HintCardData } from "./types";
import styles from "../../styles/scenarioGame.module.css";

type HintPanelProps = {
  isOpen: boolean;
  hints: HintCardData[];
  onClose: () => void;
};

export function HintPanel({ isOpen, hints, onClose }: HintPanelProps) {
  return (
    <aside
      className={`${styles.hintPanel} ${isOpen ? styles.hintPanelOpen : ""}`}
      aria-label="직무 시뮬레이션 힌트"
      aria-hidden={!isOpen}
    >
      <div className={styles.hintPanelHeader}>
        <span className={styles.hintTitleIcon} aria-hidden="true">
          <LightbulbFilament weight="fill" />
        </span>
        <span>
          <small>MISSION GUIDE</small>
          <strong>업무 힌트</strong>
        </span>
        <button type="button" onClick={onClose} aria-label="힌트 닫기">
          <X weight="bold" />
        </button>
      </div>
      <div className={styles.hintList}>
        {hints.map((hint, index) => (
          <HintCard hint={hint} index={index} key={hint.id} />
        ))}
      </div>
    </aside>
  );
}
