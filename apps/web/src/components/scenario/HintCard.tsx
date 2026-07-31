import { CheckCircle } from "@phosphor-icons/react";
import type { HintCardData } from "./types";
import styles from "../../styles/scenarioGame.module.css";

type HintCardProps = {
  hint: HintCardData;
  index: number;
};

export function HintCard({ hint, index }: HintCardProps) {
  return (
    <article className={styles.hintCard}>
      <div className={styles.hintCardTop}>
        <span className={styles.hintIndex}>{String(index + 1).padStart(2, "0")}</span>
        <span className={styles.hintCategory}>{hint.category}</span>
        <CheckCircle weight="fill" aria-hidden="true" />
      </div>
      <h3>{hint.title}</h3>
      <p style={{ whiteSpace: "pre-line" }}>{hint.description}</p>
    </article>
  );
}
