import { ArrowUpRight, CheckCircle } from "@phosphor-icons/react";
import { useState } from "react";
import type { HintCardData } from "./types";
import styles from "../../styles/scenarioGame.module.css";

type HintCardProps = {
  hint: HintCardData;
  index: number;
};

export function HintCard({ hint, index }: HintCardProps) {
  const [revealed, setRevealed] = useState(false);
  const hasAnswer = Boolean(hint.answer);

  return (
    <article className={styles.hintCard}>
      <div className={styles.hintCardTop}>
        <span className={styles.hintIndex}>{String(index + 1).padStart(2, "0")}</span>
        <span className={styles.hintCategory}>{hint.category}</span>
        <CheckCircle weight="fill" aria-hidden="true" />
      </div>
      <h3>{hint.title}</h3>
      <p>{hint.description}</p>
      {revealed && hasAnswer ? (
        <p style={{ margin: "8px 0 0", color: "#ffffff", fontWeight: 800, lineHeight: 1.5 }}>
          정답 · {hint.answer}
        </p>
      ) : null}
      {hasAnswer ? (
        <button
          type="button"
          aria-pressed={revealed}
          aria-label={revealed ? `${hint.title} 정답 숨기기` : `${hint.title} 정답 확인하기`}
          onClick={() => setRevealed((current) => !current)}
        >
          {revealed ? "정답 숨기기" : "확인하기"}
          <ArrowUpRight weight="bold" aria-hidden="true" />
        </button>
      ) : null}
    </article>
  );
}
