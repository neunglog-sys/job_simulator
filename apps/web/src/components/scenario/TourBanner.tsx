import { UserCircle } from "@phosphor-icons/react";
import styles from "../../styles/scenarioGame.module.css";

/**
 * 1단계 온보딩 투어(컷신) 자막 — 사수가 신입을 데리고 다니며 팀원을 소개하는 동안 뜬다.
 *
 * 이동은 자동(사수가 앞장서고 신입이 따라붙는다). 각 동료 앞에서는 신입이 **직접 인사를
 * 입력**해야 다음으로 넘어간다 — 그래야 사회생활 화법(호감도)이 실제로 평가된다.
 * 사수가 이미 소개했으므로 동료는 자기소개를 반복하지 않고 짧게 인사만 받아준다.
 */
type TourBannerProps = {
  speakerName: string; // 지금 말하는 사람 (소개 중이면 사수, 응답 중이면 그 동료)
  line: string;
  stepLabel: string; // "1/5" 또는 "마무리"
  /** intro=사수 소개 / greet=신입이 인사할 차례(버튼 잠김) / reply=동료 응답 / closing=마무리 */
  mode: "intro" | "greet" | "reply" | "closing";
  onNext: () => void;
};

const NEXT_LABEL: Record<TourBannerProps["mode"], string> = {
  intro: "인사하기 →",
  greet: "채팅으로 인사해보세요",
  reply: "다음 →",
  closing: "일 시작하기 →",
};

export function TourBanner({ speakerName, line, stepLabel, mode, onNext }: TourBannerProps) {
  const waiting = mode === "greet";
  return (
    <div className={styles.tourBanner} role="status" aria-live="polite">
      <span className={styles.encounterAvatar} aria-hidden="true">
        <UserCircle weight="duotone" />
      </span>
      <div className={styles.tourBody}>
        <strong>
          {speakerName}
          <span className={styles.tourProgress}>{stepLabel}</span>
        </strong>
        <p>{line}</p>
      </div>
      <button
        className={styles.encounterButton}
        type="button"
        onClick={onNext}
        disabled={waiting}
        title={waiting ? "아래 채팅창에 인사를 입력하면 넘어갈 수 있어요." : undefined}
      >
        {NEXT_LABEL[mode]}
      </button>
    </div>
  );
}
