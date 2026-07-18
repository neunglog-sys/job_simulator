import styles from "../../styles/oneToOneConversation.module.css";

type VoiceLevelMeterProps = {
  active: boolean;
  level: number;
};

const SEGMENT_COUNT = 12;

export function VoiceLevelMeter({ active, level }: VoiceLevelMeterProps) {
  const activeSegments = Math.ceil(Math.min(1, Math.max(0, level)) * SEGMENT_COUNT);

  return (
    <div
      className={`${styles.voiceLevelMeter} ${active ? styles.voiceLevelMeterActive : ""}`}
      role="meter"
      aria-label="마이크 입력 음량"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
      aria-hidden={!active}
    >
      {Array.from({ length: SEGMENT_COUNT }, (_, index) => (
        <span
          key={index}
          className={index < activeSegments ? styles.voiceLevelSegmentActive : undefined}
        />
      ))}
    </div>
  );
}
