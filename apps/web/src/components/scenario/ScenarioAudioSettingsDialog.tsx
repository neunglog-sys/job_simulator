import { CheckCircle, FloppyDisk, Robot, SpeakerHigh, X } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  COACH_PROFILES,
  type CoachAvatarId,
} from "../../lib/coachPreference";
import type { ScenarioTheme } from "./DashboardHeader";
import styles from "../../styles/scenarioAudioSettingsDialog.module.css";

type AudioSettings = {
  bgmVolume: number;
  coachVolume: number;
  coachId: CoachAvatarId;
};

type ScenarioAudioSettingsDialogProps = AudioSettings & {
  open: boolean;
  theme: ScenarioTheme;
  onCancel: () => void;
  onPreview: (settings: AudioSettings) => void;
  onSave: (settings: AudioSettings) => void;
};

type SliderStyle = CSSProperties & {
  "--audio-slider-fill": string;
};

function toPercent(volume: number): number {
  return Math.round(volume * 100);
}

export function ScenarioAudioSettingsDialog({
  open,
  theme,
  bgmVolume,
  coachVolume,
  coachId,
  onCancel,
  onPreview,
  onSave,
}: ScenarioAudioSettingsDialogProps) {
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  const descriptionId = useId();
  const bgmId = useId();
  const coachVolumeId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCancel();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onCancel, open]);

  const bgmPercent = toPercent(bgmVolume);
  const coachPercent = toPercent(coachVolume);

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className={styles.backdrop}
          data-scenario-theme={theme}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.18 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onCancel();
          }}
        >
          <motion.form
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            initial={reduceMotion ? false : { opacity: 0, scale: 0.965, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 7 }}
            transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
            onSubmit={(event) => {
              event.preventDefault();
              onSave({ bgmVolume, coachVolume, coachId });
            }}
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const controls = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>(
                  "button:not(:disabled), input:not(:disabled)",
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
            <button
              ref={closeButtonRef}
              className={styles.closeButton}
              type="button"
              onClick={onCancel}
              aria-label="환경 설정 닫기"
            >
              <X weight="bold" aria-hidden="true" />
            </button>

            <header className={styles.header}>
              <span className={styles.headerIcon} aria-hidden="true">
                <SpeakerHigh weight="duotone" />
              </span>
              <div>
                <span>SCENARIO SETTINGS</span>
                <h2 id={titleId}>환경 설정</h2>
                <p id={descriptionId}>사운드와 함께할 진로 코치를 내게 맞게 설정해보세요.</p>
              </div>
            </header>

            <div className={styles.controlList}>
              <section className={styles.volumeControl}>
                <div className={styles.controlHeading}>
                  <span className={styles.controlIcon} aria-hidden="true">
                    <SpeakerHigh weight="fill" />
                  </span>
                  <div>
                    <label htmlFor={bgmId}>BGM 음량</label>
                    <small>시나리오 배경 음악</small>
                  </div>
                  <output htmlFor={bgmId}>{bgmPercent}%</output>
                </div>
                <input
                  id={bgmId}
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={bgmPercent}
                  style={{ "--audio-slider-fill": `${bgmPercent}%` } as SliderStyle}
                  onChange={(event) => {
                    onPreview({
                      bgmVolume: Number(event.target.value) / 100,
                      coachVolume,
                      coachId,
                    });
                  }}
                />
              </section>

              <section className={styles.volumeControl}>
                <div className={styles.controlHeading}>
                  <span className={styles.controlIcon} aria-hidden="true">
                    <Robot weight="fill" />
                  </span>
                  <div>
                    <label htmlFor={coachVolumeId}>진로 코치 음량</label>
                    <small>안내와 피드백 음성</small>
                  </div>
                  <output htmlFor={coachVolumeId}>{coachPercent}%</output>
                </div>
                <input
                  id={coachVolumeId}
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={coachPercent}
                  style={{ "--audio-slider-fill": `${coachPercent}%` } as SliderStyle}
                  onChange={(event) => {
                    onPreview({
                      bgmVolume,
                      coachVolume: Number(event.target.value) / 100,
                      coachId,
                    });
                  }}
                />
              </section>

              <section className={styles.coachControl}>
                <div className={styles.coachControlHeading}>
                  <div>
                    <strong>함께할 진로 코치</strong>
                    <small>저장하면 1:1 상담과 시나리오에 함께 적용돼요.</small>
                  </div>
                </div>
                <div className={styles.coachChoices} role="radiogroup" aria-label="진로 코치 선택">
                  {(["male", "female"] as const).map((candidateId) => {
                    const coach = COACH_PROFILES[candidateId];
                    const selected = coachId === candidateId;
                    return (
                      <button
                        key={coach.id}
                        className={`${styles.coachChoice} ${selected ? styles.coachChoiceSelected : ""}`}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() =>
                          onPreview({
                            bgmVolume,
                            coachVolume,
                            coachId: candidateId,
                          })
                        }
                      >
                        <img src={coach.portraitSrc} alt="" />
                        <span>
                          <small>{coach.role}</small>
                          <strong>{coach.name}</strong>
                        </span>
                        {selected ? <CheckCircle weight="fill" aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>

            <p className={styles.helperText}>
              음량과 코치는 즉시 미리 적용돼요. 취소하면 저장 전 설정으로 돌아갑니다.
            </p>

            <div className={styles.actions}>
              <button className={styles.cancelButton} type="button" onClick={onCancel}>
                취소
              </button>
              <button className={styles.saveButton} type="submit">
                <FloppyDisk weight="bold" aria-hidden="true" />
                설정 저장
              </button>
            </div>
          </motion.form>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
