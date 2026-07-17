import { GameController } from "@phosphor-icons/react";
import styles from "../../styles/scenarioGame.module.css";

/**
 * 4단계 — 앞 단계에서 NPC 대화로 익힌 '신입의 주 업무'를 실제로 해보는 미니게임 자리.
 *
 * 지금은 E2E 플로우를 먼저 뚫기 위한 빈 창(바로 완료 처리)이다. 여기 들어갈 게임은
 * 이미 시나리오 콘텐츠에 자료 형태로 명세돼 있다 — 예: jm-01의 '차량 상태 카드(타이어
 * 트레드 1.2mm·소화기 압력 저하 숨김)', '배송리스트 84건 vs 송장 82건 대조'.
 * 즉 자료를 뒤져 숨은 결함을 찾아내는 포인트앤클릭이 이 창을 채우게 된다.
 */
type MiniGamePanelProps = {
  missionTitle: string;
  onClear: () => void;
};

export function MiniGamePanel({ missionTitle, onClear }: MiniGamePanelProps) {
  return (
    <div className={styles.missionOverlay} role="dialog" aria-modal="true" aria-label="실무 미니게임">
      <div className={styles.missionModal}>
        <div className={styles.missionHeader}>
          <div className={styles.missionHeadingText}>
            <span className={styles.missionKindBadge}>실무 미니게임</span>
            <h2>{missionTitle}</h2>
          </div>
        </div>

        <div className={styles.miniGameStage}>
          <GameController weight="duotone" aria-hidden="true" />
          <p className={styles.miniGameTitle}>준비 중인 단계예요</p>
          <p className={styles.miniGameBody}>
            앞에서 동료들에게 배운 <strong>신입의 주 업무</strong>를 직접 해보는 자리입니다.
            <br />
            자료를 살펴보고 숨은 문제를 찾아내는 실습이 이곳에 들어갈 예정이에요.
          </p>
        </div>

        <div className={styles.missionFooter}>
          <button className={styles.missionSubmit} type="button" onClick={onClear}>
            완료하고 계속 →
          </button>
        </div>
      </div>
    </div>
  );
}
