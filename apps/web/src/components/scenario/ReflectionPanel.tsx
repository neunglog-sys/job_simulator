import { useState } from "react";
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
  submitting: boolean;
  onSubmit: (content: string) => void;
};

const PROMPTS = [
  "어떤 일이 가장 해볼 만했나요? 반대로 답답했던 순간은요?",
  "오늘 해본 일이 내가 생각하던 이 직무의 이미지와 같았나요?",
  "이 일을 계속한다면 어떤 점이 좋고, 어떤 점이 걱정되나요?",
];

export function ReflectionPanel({ scenarioTitle, submitting, onSubmit }: ReflectionPanelProps) {
  const [text, setText] = useState("");
  const canSubmit = text.trim().length >= 10 && !submitting;

  return (
    <div className={styles.missionOverlay} role="dialog" aria-modal="true" aria-label="체험 소감문">
      <div className={styles.missionModal}>
        <div className={styles.missionHeader}>
          <div className={styles.missionHeadingText}>
            <span className={styles.missionKindBadge}>체험 소감문</span>
            <h2>{scenarioTitle || "오늘의 체험"}</h2>
          </div>
        </div>

        <p className={styles.missionPrompt}>
          오늘 하루 어땠는지 자유롭게 적어주세요. <strong>정답도 채점도 없습니다</strong> — 느낀
          그대로 쓰시면 됩니다. 이 글은 상담 결과·체험 기록과 함께 최종 진로 리포트에 반영됩니다.
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
            autoFocus
          />
        </div>

        <div className={styles.missionFooter}>
          <span className={styles.reflectionHint}>
            {text.trim().length < 10 ? "열 글자 이상 적어주세요." : `${text.trim().length}자`}
          </span>
          <button
            className={styles.missionSubmit}
            type="button"
            onClick={() => onSubmit(text.trim())}
            disabled={!canSubmit}
          >
            {submitting ? "보내는 중…" : "리포트에 담기 →"}
          </button>
        </div>
      </div>
    </div>
  );
}
