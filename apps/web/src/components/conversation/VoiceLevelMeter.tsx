import { motion, useReducedMotion } from "motion/react";
import type { CSSProperties } from "react";
import styles from "../../styles/oneToOneConversation.module.css";

type VoiceLevelMeterProps = {
  level: number;
  bands: number[];
};

type VoiceBandStyle = CSSProperties & {
  "--voice-band-scale": number;
  "--voice-band-index": number;
};

const BAND_COUNT = 9;

export function VoiceLevelMeter({ level, bands }: VoiceLevelMeterProps) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={styles.voiceEqualizer}
      initial={reduceMotion ? false : { opacity: 0, x: 8, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0, x: 6, scale: 0.92 }}
      transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.23, 1, 0.32, 1] }}
      role="meter"
      aria-label="마이크 입력 음량"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
    >
      {Array.from({ length: BAND_COUNT }, (_, index) => (
        <span
          key={index}
          style={
            {
              "--voice-band-scale":
                0.14 + Math.min(1, Math.max(0, bands[index] ?? 0)) * 0.86,
              "--voice-band-index": index,
            } as VoiceBandStyle
          }
        />
      ))}
    </motion.div>
  );
}
