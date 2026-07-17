import { UserCircle } from "@phosphor-icons/react";
import styles from "../../styles/scenarioGame.module.css";

/**
 * 1단계 온보딩 투어(컷신) 자막 — 사수가 신입을 데리고 다니며 팀원을 소개하는 동안 뜬다.
 *
 * 플레이어는 '다음 →'만 누르면 되고, 이동은 자동이다(사수가 앞장서고 신입이 따라붙는다).
 */
type TourBannerProps = {
  guideName: string;
  line: string;
  stepLabel: string; // 예: "1/6" 또는 "마무리"
  isLast: boolean;
  onNext: () => void;
};

export function TourBanner({ guideName, line, stepLabel, isLast, onNext }: TourBannerProps) {
  return (
    <div className={styles.tourBanner} role="status" aria-live="polite">
      <span className={styles.encounterAvatar} aria-hidden="true">
        <UserCircle weight="duotone" />
      </span>
      <div className={styles.tourBody}>
        <strong>
          {guideName}
          <span className={styles.tourProgress}>{stepLabel}</span>
        </strong>
        <p>{line}</p>
      </div>
      <button className={styles.encounterButton} type="button" onClick={onNext} autoFocus>
        {isLast ? "일 시작하기 →" : "다음 →"}
      </button>
    </div>
  );
}
