import { AiAvatarViewport } from "./AiAvatarViewport";
import { CoachSpeechBubble } from "./CoachSpeechBubble";
import styles from "../../styles/scenarioGame.module.css";

type AiCoachPanelProps = {
  message: string;
};

export function AiCoachPanel({ message }: AiCoachPanelProps) {
  return (
    <section className={`${styles.glassPanel} ${styles.coachPanel}`} aria-label="AI 코치">
      <AiAvatarViewport />
      <CoachSpeechBubble message={message} />
    </section>
  );
}
