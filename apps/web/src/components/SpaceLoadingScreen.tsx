import type { CSSProperties } from "react";
import styles from "../styles/spaceLoadingScreen.module.css";

type SpaceLoadingScreenProps = {
  message: string;
  detail?: string;
};

type StarStyle = CSSProperties & {
  "--star-y": string;
  "--star-width": string;
  "--star-size": string;
  "--star-delay": string;
  "--star-duration": string;
  "--star-opacity": number;
};

type WakeStyle = CSSProperties & {
  "--wake-y": string;
  "--wake-size": string;
  "--wake-delay": string;
  "--wake-duration": string;
};

const STAR_COUNT = 28;

const WAKE_STARS: WakeStyle[] = Array.from({ length: 8 }, (_, index) => ({
  "--wake-y": `${((index * 19) % 37) - 18}px`,
  "--wake-size": `${3 + (index % 3) * 1.5}px`,
  "--wake-delay": `${-(index * 0.19)}s`,
  "--wake-duration": `${1.05 + (index % 4) * 0.16}s`,
}));

function getStarStyle(index: number): StarStyle {
  return {
    "--star-y": `${(index * 37 + 7) % 96}%`,
    "--star-width": `${42 + (index % 6) * 17}px`,
    "--star-size": `${1 + (index % 3)}px`,
    "--star-delay": `${-((index * 0.41) % 4.8)}s`,
    "--star-duration": `${2.7 + (index % 7) * 0.36}s`,
    "--star-opacity": 0.32 + (index % 5) * 0.13,
  };
}

export function SpaceLoadingScreen({ message, detail }: SpaceLoadingScreenProps) {
  return (
    <main className={styles.screen} aria-label={message} aria-busy="true">
      <div className={styles.spaceBackdrop} aria-hidden="true" />
      <div className={styles.nebula} aria-hidden="true" />
      <div className={styles.starField} aria-hidden="true">
        {Array.from({ length: STAR_COUNT }, (_, index) => (
          <i className={styles.star} style={getStarStyle(index)} key={index} />
        ))}
      </div>

      <section className={styles.content} role="status" aria-live="polite">
        <div className={styles.rocketStage} aria-hidden="true">
          <div className={styles.rocketFloat}>
            <span className={styles.rocketWake}>
              <span className={styles.wakeStars}>
                {WAKE_STARS.map((style, index) => <i style={style} key={index} />)}
              </span>
            </span>
            <span className={styles.rocketBody}>
              <img src="/assets/rocket.webp" alt="" />
            </span>
          </div>
        </div>

        <div className={styles.loadingCopy}>
          <p>{message}</p>
          <div className={styles.loadingTrack} aria-hidden="true">
            <span />
          </div>
          {detail ? <small>{detail}</small> : null}
        </div>
      </section>
    </main>
  );
}
