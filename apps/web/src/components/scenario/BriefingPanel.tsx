import { UserCircle } from "@phosphor-icons/react";
import styles from "../../styles/scenarioGame.module.css";

/**
 * 1·3단계 — 업무를 받기 전에 사수가 업무 절차를 알려주는 브리핑.
 *
 * 여기서 들은 절차가 곧 이번 업무를 하는 방법이다. 정답 키는 서버가 내려주지 않으므로
 * (state_machine.public_task), 들은 절차를 섞여 있는 보기와 맞춰보는 건 사용자 몫이다.
 * 브리핑 내용은 닫은 뒤에도 업무 노트(힌트 패널)에서 다시 볼 수 있다.
 */
type BriefingPanelProps = {
  npcName: string;
  npcRole?: string;
  missionTitle: string;
  mission: string;
  steps: string[];
  onClose: () => void;
};

export function BriefingPanel({
  npcName,
  npcRole,
  missionTitle,
  mission,
  steps,
  onClose,
}: BriefingPanelProps) {
  return (
    <div className={styles.missionOverlay} role="dialog" aria-modal="true" aria-label="업무 브리핑">
      <div className={styles.missionModal}>
        <div className={styles.missionHeader}>
          <div className={styles.missionHeadingText}>
            <span className={styles.missionKindBadge}>업무 브리핑</span>
            <h2>{missionTitle}</h2>
          </div>
        </div>

        <div className={styles.briefingSpeaker}>
          <span className={styles.encounterAvatar} aria-hidden="true">
            <UserCircle weight="duotone" />
          </span>
          <div>
            <strong>{npcName}</strong>
            {npcRole ? <small> · {npcRole}</small> : null}
          </div>
        </div>

        <p className={styles.missionPrompt}>{mission}</p>

        {steps.length > 0 ? (
          <>
            <p className={styles.briefingLead}>이 순서로 하면 됩니다.</p>
            <ol className={styles.briefingSteps}>
              {steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className={styles.briefingNote}>
              잘 기억해두세요. 업무 노트(💡)에서 다시 볼 수 있고, 모르는 건 동료들에게 물어봐도 됩니다.
            </p>
          </>
        ) : null}

        <div className={styles.missionFooter}>
          <button className={styles.missionSubmit} type="button" onClick={onClose}>
            알겠습니다 →
          </button>
        </div>
      </div>
    </div>
  );
}
