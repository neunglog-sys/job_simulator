import type { ReactNode } from "react";
import { AiAvatarViewport } from "./AiAvatarViewport";
import { CoachSpeechBubble } from "./CoachSpeechBubble";
import styles from "../../styles/scenarioGame.module.css";

type AiCoachPanelProps = {
  message: string;
  coachName?: string;
  children?: ReactNode;
};

export function AiCoachPanel({ message, coachName, children }: AiCoachPanelProps) {
  return (
    <section className={`${styles.glassPanel} ${styles.coachPanel}`} aria-label="AI 코치">
      <AiAvatarViewport>{children}</AiAvatarViewport>
      <CoachSpeechBubble message={message} coachName={coachName} />
    </section>
  );
}
