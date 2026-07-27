import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "../../../styles/minigame.module.css";
import type { MinigameDef, MinigameResult } from "./types";

/**
 * 엔진 공용 부품 — 타이머·HUD·결과 표시.
 *
 * 모든 엔진 컴포넌트는 동일한 계약을 따른다:
 *   ({ game, onComplete }: EngineProps) → 게임 종료 시 onComplete({accuracy, time_seconds, mistakes})
 * 타이머는 setTimeout 누적이 아니라 시작 시각 기준 역산 — 백그라운드 탭에서
 * 브라우저가 타이머를 조여도 남은 시간이 틀어지지 않는다(PourGame에서 확립한 규약).
 */
export type EngineProps = {
  game: MinigameDef;
  onComplete: (result: MinigameResult) => void;
};

/** 남은 초 — 시작 시각 기준 역산. done이 되면 멈춘다. 만료 시 onExpire 1회 호출. */
export function useCountdown(timeLimit: number | null, done: boolean, onExpire: () => void) {
  const startedAt = useRef(Date.now());
  const expired = useRef(false);
  const [remaining, setRemaining] = useState<number | null>(timeLimit);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    if (done || timeLimit === null) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil(timeLimit - (Date.now() - startedAt.current) / 1000));
      setRemaining(left);
      if (left <= 0 && !expired.current) {
        expired.current = true;
        expireRef.current();
      }
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [timeLimit, done]);

  return { remaining, startedAt };
}

/** 경과 초 — 결과 payload의 time_seconds 용. */
export function elapsedSeconds(startedAt: { current: number }): number {
  return Math.round((Date.now() - startedAt.current) / 1000);
}

/** 0~100 클램프 + 반올림. */
export function clampScore(raw: number): number {
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** 상단 HUD — 진행 카운트 + 남은 시간 바. */
export function GameHud({
  label,
  count,
  total,
  remaining,
  timeLimit,
  showCount = true,
}: {
  label: string;
  count: number;
  total: number;
  remaining: number | null;
  timeLimit: number | null;
  /** 진행 카운트(n/N) 노출 여부. kts-03처럼 라벨이 이미 진행도를 말해주는 게임은 끈다. */
  showCount?: boolean;
}) {
  const pct = timeLimit && remaining !== null ? Math.max(0, (remaining / timeLimit) * 100) : 100;
  return (
    <div className={styles.hud}>
      <span className={styles.hudLabel}>{label}</span>
      {showCount ? (
        <span className={styles.hudCount}>
          {count} / {total}
        </span>
      ) : null}
      {timeLimit ? (
        <>
          <span className={styles.timerTrack}>
            <span
              className={styles.timerValue}
              style={{ width: `${pct}%` }}
              data-low={remaining !== null && remaining <= 10}
            />
          </span>
          <span className={styles.hudCount}>{remaining ?? 0}초</span>
        </>
      ) : null}
    </div>
  );
}

/** 하단 결과 바 — 점수 + 상세 서술. fail이면 실패 사유를 강조한다. */
export function ResultBar({
  score,
  failReason,
  children,
}: {
  score: number;
  failReason?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className={styles.result} role="status">
      <span className={styles.resultScore} data-fail={Boolean(failReason)}>
        {failReason ? "실패" : `${score}점`}
      </span>
      <span className={styles.resultBreakdown}>
        {failReason ? <b>{failReason}</b> : children}
      </span>
    </div>
  );
}

/** scoring 값 읽기 — 없으면 기본값. YAML scoring 블록은 엔진의 채점 파라미터다. */
export function scoringOf(game: MinigameDef, key: string, fallback: number): number {
  const value = game.scoring?.[key];
  return typeof value === "number" ? value : fallback;
}

/** 즉시 실패 결과 — 안전 절차 위반 등. accuracy 0 + mistakes 기록. */
export function failResult(startedAt: { current: number }, mistakes: number): MinigameResult {
  return { accuracy: 0, time_seconds: elapsedSeconds(startedAt), mistakes };
}
