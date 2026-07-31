import { CheckCircle, ListChecks, LockSimple, NotePencil, X } from "@phosphor-icons/react";
import { useEffect, useRef, type MouseEvent } from "react";
import styles from "../../styles/scenarioGame.module.css";

type WorkflowModalProps = {
  isOpen: boolean;
  missionTitle: string;
  missionDescription: string;
  steps: string[];
  isUnlocked: boolean;
  isCompanion?: boolean;
  onMemoOpen?: () => void;
  onClose: () => void;
};

export function WorkflowModal({
  isOpen,
  missionTitle,
  missionDescription,
  steps,
  isUnlocked,
  isCompanion = false,
  onMemoOpen,
  onClose,
}: WorkflowModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  const hasSteps = isUnlocked && steps.length > 0;

  return (
    <div
      className={`${styles.workflowOverlay} ${isCompanion ? styles.workflowOverlayCompanion : ""} ${isOpen ? styles.workflowOverlayOpen : ""}`}
      aria-hidden={!isOpen}
      onMouseDown={handleBackdropClick}
    >
      <section
        className={styles.workflowModal}
        role="dialog"
        aria-modal={isCompanion ? undefined : true}
        aria-labelledby="workflow-title"
      >
        <header className={styles.workflowHeader}>
          <span className={styles.workflowHeaderIcon} aria-hidden="true">
            <ListChecks weight="bold" />
          </span>
          <div>
            <small>WORKFLOW GUIDE</small>
            <h2 id="workflow-title">업무 프로세스</h2>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="업무 프로세스 닫기">
            <X weight="bold" />
          </button>
        </header>

        <div className={styles.workflowBody}>
          <div className={styles.workflowMissionSummary}>
            <span>현재 업무</span>
            <strong>{missionTitle || "진행 중인 업무가 없어요"}</strong>
            {missionDescription ? <p>{missionDescription}</p> : null}
          </div>

          {hasSteps ? (
            <ol className={styles.workflowSteps}>
              {steps.map((step, index) => (
                <li key={`${index}-${step}`}>
                  <span className={styles.workflowStepNumber}>{index + 1}</span>
                  <p>{step}</p>
                  <CheckCircle weight="fill" aria-hidden="true" />
                </li>
              ))}
            </ol>
          ) : (
            <div className={styles.workflowEmpty}>
              <span aria-hidden="true">
                <LockSimple weight="duotone" />
              </span>
              <strong>아직 정리된 업무 프로세스가 없어요</strong>
              <p>사수에게 업무 브리핑을 들으면 처리 순서가 이곳에 정리됩니다.</p>
            </div>
          )}
        </div>

        <footer className={styles.workflowFooter}>
          <p>현재 미션에서 사수에게 들은 절차를 보여줍니다.</p>
          <div className={styles.workflowFooterActions}>
            {!isCompanion && onMemoOpen ? (
              <button className={styles.workflowMemoButton} type="button" onClick={onMemoOpen}>
                <NotePencil weight="bold" aria-hidden="true" />
                메모 함께 보기
              </button>
            ) : null}
            <button type="button" onClick={onClose}>확인</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
