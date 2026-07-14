import { Sparkle } from "@phosphor-icons/react";
import styles from "../../styles/scenarioGame.module.css";

type CoachSpeechBubbleProps = {
  message: string;
};

export function CoachSpeechBubble({ message }: CoachSpeechBubbleProps) {
  return (
    <div className={styles.speechBubble} aria-live="polite">
      <span className={styles.coachLabel}>
        <Sparkle weight="fill" aria-hidden="true" /> AI CAREER COACH
      </span>
      <p>{message}</p>
      <span className={styles.coachStatus}>지금 미션을 함께 보고 있어요</span>
    </div>
  );
}
