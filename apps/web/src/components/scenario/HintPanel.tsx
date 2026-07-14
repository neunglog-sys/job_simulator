import { HintCard } from "./HintCard";
import type { HintCardData } from "./types";
import styles from "../../styles/scenarioGame.module.css";

type HintPanelProps = {
  isOpen: boolean;
  hints: HintCardData[];
};

export function HintPanel({ isOpen, hints }: HintPanelProps) {
  return (
    <aside
      className={`${styles.hintPanel} ${isOpen ? styles.hintPanelOpen : ""}`}
      aria-label="직무 시뮬레이션 힌트"
      aria-hidden={!isOpen}
    >
      <div className={styles.hintList}>
        {hints.map((hint, index) => (
          <HintCard hint={hint} index={index} key={hint.id} />
        ))}
      </div>
    </aside>
  );
}
