import { CheckCircle, Sparkle, X } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  COACH_PROFILES,
  type CoachAvatarId,
} from "../../lib/coachPreference";
import styles from "../../styles/coachSelectionDialog.module.css";

type CoachSelectionDialogProps = {
  open: boolean;
  selectedCoachId: CoachAvatarId | null;
  required?: boolean;
  onCancel?: () => void;
  onConfirm: (coachId: CoachAvatarId) => void;
};

const COACH_IDS: CoachAvatarId[] = ["male", "female"];

export function CoachSelectionDialog({
  open,
  selectedCoachId,
  required = false,
  onCancel,
  onConfirm,
}: CoachSelectionDialogProps) {
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  const descriptionId = useId();
  const firstCardRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [draftCoachId, setDraftCoachId] = useState<CoachAvatarId | null>(selectedCoachId);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    setDraftCoachId(selectedCoachId);
    const focusTimer = window.setTimeout(() => firstCardRef.current?.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || required) return;
      event.preventDefault();
      onCancel?.();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onCancel, open, required, selectedCoachId]);

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className={styles.backdrop}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.18 }}
          onMouseDown={(event) => {
            if (!required && event.target === event.currentTarget) onCancel?.();
          }}
        >
          <motion.form
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            initial={reduceMotion ? false : { opacity: 0, scale: 0.965, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
            onSubmit={(event) => {
              event.preventDefault();
              if (draftCoachId) onConfirm(draftCoachId);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const controls = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>(
                  "button:not(:disabled)",
                ),
              );
              const first = controls[0];
              const last = controls.at(-1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <div className={styles.glow} aria-hidden="true" />
            {!required ? (
              <button
                className={styles.closeButton}
                type="button"
                onClick={onCancel}
                aria-label="진로 코치 선택 닫기"
              >
                <X weight="bold" aria-hidden="true" />
              </button>
            ) : null}

            <header className={styles.header}>
              <span className={styles.eyebrow}>
                <Sparkle weight="fill" aria-hidden="true" />
                YOUR CAREER PARTNER
              </span>
              <h2 id={titleId}>
                {required ? "함께할 진로 코치를 선택해주세요" : "진로 코치 변경"}
              </h2>
              <p id={descriptionId}>
                {required
                  ? "선택한 코치는 1:1 상담부터 직무체험까지 계속 함께해요."
                  : "코치를 바꿔도 지금까지의 대화와 시나리오 진행 내용은 그대로 유지돼요."}
              </p>
            </header>

            <div className={styles.coachGrid} role="radiogroup" aria-label="진로 코치">
              {COACH_IDS.map((coachId, index) => {
                const coach = COACH_PROFILES[coachId];
                const selected = draftCoachId === coachId;
                return (
                  <button
                    ref={index === 0 ? firstCardRef : undefined}
                    key={coach.id}
                    className={`${styles.coachCard} ${selected ? styles.coachCardSelected : ""}`}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setDraftCoachId(coach.id)}
                  >
                    <span className={styles.portraitWrap}>
                      <img src={coach.portraitSrc} alt="" />
                      {selected ? (
                        <span className={styles.selectedBadge} aria-hidden="true">
                          <CheckCircle weight="fill" />
                        </span>
                      ) : null}
                    </span>
                    <span className={styles.coachCopy}>
                      <span className={styles.coachRole}>{coach.role}</span>
                      <strong>{coach.name}</strong>
                      <small>{coach.description}</small>
                    </span>
                  </button>
                );
              })}
            </div>

            <p className={styles.helperText}>
              선택한 코치는 나중에 설정에서 언제든 바꿀 수 있어요.
            </p>

            <div className={`${styles.actions} ${required ? styles.actionsRequired : ""}`}>
              {!required ? (
                <button className={styles.cancelButton} type="button" onClick={onCancel}>
                  취소
                </button>
              ) : null}
              {/* 첫 카드에 자동 포커스가 걸려 '이미 골라진' 것처럼 보이는데, 실제로는
                  아무것도 선택되지 않아 버튼이 죽어 있다. 왜 안 눌리는지 문구로 말해준다. */}
              <button className={styles.confirmButton} type="submit" disabled={!draftCoachId}>
                {!draftCoachId
                  ? "코치를 선택해주세요"
                  : required
                    ? "이 코치와 시작하기"
                    : "진로 코치 저장"}
              </button>
            </div>
          </motion.form>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
