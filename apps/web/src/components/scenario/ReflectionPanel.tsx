import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { ScenarioTheme } from "./DashboardHeader";
import styles from "../../styles/scenarioGame.module.css";

/**
 * 5단계 — 체험 소감문.
 *
 * 업무 미션과 달리 **채점하지 않는다**. 잘 썼는지 평가하는 자리가 아니라, 오늘 해본 일이
 * 자기한테 어땠는지 체험자 본인이 적는 자리다. 이 글은 상담 결과·수행 데이터와 함께
 * 최종 진로 리포트의 재료가 된다.
 */
type ReflectionPanelProps = {
  scenarioTitle: string;
  theme: ScenarioTheme;
  submitting: boolean;
  onSubmit: (content: string) => void;
};

const PROMPTS = [
  "어떤 일이 가장 재미있었나요? 반대로 답답했던 순간은요?",
  "오늘 해본 일이 내가 생각하던 이 직무의 이미지와 같았나요?",
  "이 일을 계속한다면 어떤 점이 좋고, 어떤 점이 걱정되나요?",
];

const REFLECTION_MAX_LENGTH = 1000;

export function ReflectionPanel({ scenarioTitle, theme, submitting, onSubmit }: ReflectionPanelProps) {
  const [text, setText] = useState("");
  const reduceMotion = useReducedMotion();
  const canSubmit = text.trim().length >= 10 && !submitting;

  return (
    <motion.div
      className={`${styles.missionOverlay} ${styles.reflectionOverlay}`}
      data-scenario-theme={theme}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reflection-title"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.16, ease: "linear" }}
    >
      <motion.div
        className={`${styles.missionModal} ${styles.reflectionModal}`}
        initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.975 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.985 }}
        transition={{
          duration: reduceMotion ? 0 : 0.24,
          ease: [0.23, 1, 0.32, 1],
        }}
      >
        <div className={styles.missionHeader}>
          <div className={styles.missionHeadingText}>
            <span className={styles.missionKindBadge}>체험 소감문</span>
            <h2 id="reflection-title">{scenarioTitle || "오늘의 체험"}</h2>
          </div>
        </div>

        <p className={styles.missionPrompt}>
          오늘 하루 어땠는지 자유롭게 적어주세요. <strong>정답도 채점도 없습니다.</strong> 느낀
          그대로 쓰시면 됩니다. 이 글은 상담 결과·체험 기록과 함께 최종 진로 리포트에
          반영됩니다.
        </p>

        <ul className={styles.reflectionPrompts}>
          {PROMPTS.map((prompt) => (
            <li key={prompt}>{prompt}</li>
          ))}
        </ul>

        <div className={styles.missionBody}>
          <textarea
            className={styles.missionTextarea}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="예) 자료를 하나씩 대조하는 건 꼼꼼해서 재미있었는데, 여러 사람 요청이 겹칠 때는 우선순위 정하기가 어려웠어요."
            maxLength={REFLECTION_MAX_LENGTH}
            autoFocus
          />
        </div>

        <div className={styles.missionFooter}>
          <div className={styles.reflectionMeta}>
            <span className={styles.reflectionHint}>
              {text.trim().length < 10
                ? "10자 이상 작성해주세요."
                : "작성한 내용이 리포트에 저장돼요."}
            </span>
            <span className={styles.reflectionCounter} aria-live="polite">
              {text.length.toLocaleString()} / {REFLECTION_MAX_LENGTH.toLocaleString()}자
            </span>
          </div>
          <button
            className={styles.missionSubmit}
            type="button"
            onClick={() => onSubmit(text.trim())}
            disabled={!canSubmit}
          >
            {submitting ? "보내는 중…" : "리포트에 담기 →"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
