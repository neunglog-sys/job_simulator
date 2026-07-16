import { CheckCircle, X } from "@phosphor-icons/react";
import { useState } from "react";
import type { GameTask } from "../../lib/api";
import type { TaskResultFrame } from "../../lib/simulationSocket";
import styles from "../../styles/scenarioGame.module.css";

// 임시 스탠드인 — 본격 미니게임 전, 미션을 '간단히 풀어보고 제출→통과'하는 최소 패널.
// step(본편 미션)과 sudden quest(돌발) 둘 다 이 형태로 렌더한다.
export type MissionView = { title: string; task: GameTask; banner?: string };

type MissionPanelProps = {
  mission: MissionView;
  submitting: boolean;
  result: TaskResultFrame | null;
  onSubmit: (content: string | string[]) => void;
  onSkip: () => void;
  onClose: () => void;
  onClearResult: () => void;
};

const KIND_LABEL: Record<string, string> = {
  checklist: "필요한 행동 모두 고르기",
  choice: "하나만 고르기",
  order: "순서대로 배열하기 (누른 순서 = 순번)",
  write: "서술형으로 작성하기",
};

export function MissionPanel({
  mission,
  submitting,
  result,
  onSubmit,
  onSkip,
  onClose,
  onClearResult,
}: MissionPanelProps) {
  const task = mission.task;
  const kind = task.kind ?? "write";
  const [selected, setSelected] = useState<string[]>([]); // checklist/choice/order 공용 (order는 누른 순서)
  const [text, setText] = useState("");

  const onOptionClick = (key: string) => {
    onClearResult();
    if (kind === "choice") {
      setSelected([key]);
    } else {
      // checklist·order: 토글 (order는 배열 순서가 곧 순번)
      setSelected((current) =>
        current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
      );
    }
  };

  const canSubmit =
    kind === "write"
      ? text.trim().length > 0
      : kind === "order"
        ? selected.length === task.options.length
        : selected.length > 0;

  const submit = () => {
    onClearResult();
    onSubmit(kind === "write" ? text.trim() : selected);
  };

  return (
    <div className={styles.missionOverlay} role="dialog" aria-modal="true" aria-label="미션 도전">
      <div className={styles.missionModal}>
        <div className={styles.missionHeader}>
          <div className={styles.missionHeadingText}>
            <span className={styles.missionKindBadge}>{KIND_LABEL[kind] ?? "미션"}</span>
            <h2>{mission.title}</h2>
          </div>
          <button className={styles.missionClose} type="button" onClick={onClose} aria-label="미션 닫기">
            <X weight="bold" />
          </button>
        </div>

        {mission.banner ? <p className={styles.missionBanner}>{mission.banner}</p> : null}
        <p className={styles.missionPrompt}>{task.prompt}</p>

        <div className={styles.missionBody}>
          {kind === "write" ? (
            <textarea
              className={styles.missionTextarea}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                onClearResult();
              }}
              placeholder="여기에 답변을 작성하세요. (대화에서 확인한 내용을 근거로)"
            />
          ) : (
            task.options.map((option) => {
              const isSelected = selected.includes(option.key);
              const orderNo = kind === "order" ? selected.indexOf(option.key) + 1 : 0;
              return (
                <button
                  key={option.key}
                  type="button"
                  className={`${styles.missionOption} ${isSelected ? styles.missionOptionSelected : ""}`}
                  onClick={() => onOptionClick(option.key)}
                >
                  {kind === "order" ? (
                    <span className={styles.missionOrderIndex}>{orderNo > 0 ? orderNo : "·"}</span>
                  ) : (
                    <span
                      className={`${styles.missionOptionMark} ${
                        kind === "choice" ? styles.missionOptionMarkRound : ""
                      }`}
                    >
                      {isSelected ? <CheckCircle weight="fill" /> : null}
                    </span>
                  )}
                  <span>{option.label}</span>
                </button>
              );
            })
          )}
        </div>

        <div className={styles.missionFooter}>
          <button className={styles.missionSkip} type="button" onClick={onSkip} disabled={submitting}>
            다음 문제로 스킵 →
          </button>
          {result ? (
            <p
              className={`${styles.missionResult} ${
                result.passed ? styles.missionResultPass : styles.missionResultFail
              }`}
            >
              {result.passed ? "통과! " : `아직 미달 (${result.total}점) — `}
              {result.feedback}
            </p>
          ) : null}
          <button
            className={styles.missionSubmit}
            type="button"
            onClick={submit}
            disabled={!canSubmit || submitting}
          >
            {submitting ? "채점 중…" : result && !result.passed ? "다시 제출" : "제출"}
          </button>
        </div>
      </div>
    </div>
  );
}
