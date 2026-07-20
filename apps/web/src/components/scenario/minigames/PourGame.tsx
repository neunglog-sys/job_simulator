import { useCallback, useEffect, useRef, useState } from "react";
import styles from "../../../styles/minigame.module.css";
import type { MinigameResult, PourData, Vessel } from "./types";

/**
 * pour 엔진 — 구유·계량컵의 표시선까지 정확히 붓는다.
 *
 * 숫자를 띄우지 않는다(_SCHEMA.md 규칙 1). 목표는 통에 그어진 선으로만 읽히고,
 * 채점은 선에서 벗어난 정도로 한다. 넘친 쪽 감점이 모자란 쪽보다 큰 이유는
 * ms-06 원문에서 사료가 흩어지는 것이 낭비·오염 문제이기 때문.
 */
type PourGameProps = {
  data: PourData;
  timeLimit: number | null;
  onComplete: (result: MinigameResult) => void;
};

const FILL_RATE = 0.55; // 초당 채워지는 비율 — 정밀 조작이 가능한 속도

export function PourGame({ data, timeLimit, onComplete }: PourGameProps) {
  const vessels = data.vessels ?? [];
  const [index, setIndex] = useState(0);
  const [level, setLevel] = useState(0);
  const [pouring, setPouring] = useState(false);
  const [results, setResults] = useState<Array<{ id: string; off: number; ok: boolean }>>([]);
  const [remaining, setRemaining] = useState(timeLimit);
  const [done, setDone] = useState(false);
  const startedAt = useRef(Date.now());
  const raf = useRef<number | null>(null);
  const pourStartedAt = useRef(0);

  const current: Vessel | undefined = vessels[index];

  const finish = useCallback(
    (final: Array<{ id: string; off: number; ok: boolean }>) => {
      if (done) return;
      setDone(true);
      const over = Number(data.overPenalty ?? 12);
      const under = Number(data.underPenalty ?? 8);
      // 통마다 100점에서 벗어난 만큼 깎고 평균낸다. 미완료 통은 0점 처리.
      const scores = vessels.map((v) => {
        const hit = final.find((r) => r.id === v.id);
        if (!hit) return 0;
        if (hit.ok) return 100;
        const penalty = hit.off > 0 ? over : under;
        return Math.max(0, 100 - Math.abs(hit.off) * 100 * (penalty / 10));
      });
      const accuracy = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      onComplete({
        accuracy: Math.max(0, Math.min(100, Math.round(accuracy))),
        time_seconds: Math.round((Date.now() - startedAt.current) / 1000),
        mistakes: final.filter((r) => !r.ok).length,
      });
    },
    [done, data.overPenalty, data.underPenalty, vessels, onComplete],
  );

  // 채워진 양은 '누르기 시작한 시각'에서 계산한다 — 프레임에 누적하지 않는다.
  // rAF는 화면 갱신에만 쓴다. 탭이 백그라운드로 가면 브라우저가 rAF를 멈추는데,
  // 프레임에 누적하는 방식이면 그동안 부은 양이 통째로 사라진다.
  const levelAt = useCallback(
    (now: number) => Math.min(1.2, (now - pourStartedAt.current) / 1000 * FILL_RATE),
    [],
  );

  useEffect(() => {
    if (!pouring || done) return;
    const step = () => {
      setLevel(levelAt(Date.now()));
      raf.current = window.requestAnimationFrame(step);
    };
    raf.current = window.requestAnimationFrame(step);
    return () => {
      if (raf.current) window.cancelAnimationFrame(raf.current);
    };
  }, [pouring, done, levelAt]);

  useEffect(() => {
    if (done || remaining === null) return;
    if (remaining <= 0) {
      finish(results);
      return;
    }
    const timer = window.setTimeout(() => setRemaining((left) => (left === null ? null : left - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [remaining, done, finish, results]);

  const start = () => {
    if (pouring || done) return;
    pourStartedAt.current = Date.now();
    setPouring(true);
  };

  const stop = () => {
    if (!pouring || !current || done) return;
    setPouring(false);
    // 확정값은 화면 상태(level)가 아니라 누른 시간으로 계산한다 — rAF가 멈춰
    // 화면이 안 따라왔더라도 실제로 부은 양은 정확하다.
    const poured = levelAt(Date.now());
    setLevel(poured);
    const off = poured - current.target; // + 넘침 / − 모자람
    const ok = Math.abs(off) <= current.tolerance;
    const next = [...results, { id: current.id, off, ok }];
    setResults(next);
    setLevel(0);
    if (index + 1 >= vessels.length) finish(next);
    else setIndex(index + 1);
  };

  const timerPct = timeLimit && remaining !== null ? Math.max(0, (remaining / timeLimit) * 100) : 100;
  const okCount = results.filter((r) => r.ok).length;

  return (
    <div className={styles.shell}>
      <div className={styles.hud}>
        <span className={styles.hudLabel}>정량 급이</span>
        <span className={styles.hudCount}>
          {results.length} / {vessels.length}
        </span>
        {timeLimit ? (
          <>
            <span className={styles.timerTrack}>
              <span
                className={styles.timerValue}
                style={{ width: `${timerPct}%` }}
                data-low={remaining !== null && remaining <= 10}
              />
            </span>
            <span className={styles.hudCount}>{remaining ?? 0}초</span>
          </>
        ) : null}
      </div>

      <div className={styles.pourStage}>
        {vessels.map((vessel, i) => {
          const finished = results.find((r) => r.id === vessel.id);
          const active = i === index && !done;
          const shown = active ? level : finished ? vessel.target + finished.off : 0;
          return (
            <div key={vessel.id} className={styles.vessel} data-active={active} data-done={Boolean(finished)}>
              <div className={styles.vesselBody}>
                {/* 목표 표시선 — 숫자 없이 이 선만 보고 맞춘다 */}
                <span className={styles.targetLine} style={{ bottom: `${vessel.target * 100}%` }} />
                <span
                  className={styles.toleranceBand}
                  style={{
                    bottom: `${(vessel.target - vessel.tolerance) * 100}%`,
                    height: `${vessel.tolerance * 2 * 100}%`,
                  }}
                />
                <span
                  className={styles.fill}
                  style={{ height: `${Math.min(100, shown * 100)}%` }}
                  data-verdict={finished ? (finished.ok ? "ok" : finished.off > 0 ? "over" : "under") : undefined}
                />
              </div>
              <span className={styles.vesselLabel}>{vessel.label ?? vessel.id}</span>
              {finished ? (
                <span className={styles.vesselVerdict} data-ok={finished.ok}>
                  {finished.ok ? "적정" : finished.off > 0 ? "과다" : "부족"}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {!done && current ? (
        <div className={styles.missionFooterRow}>
          <button
            className={styles.pourButton}
            type="button"
            onMouseDown={start}
            onMouseUp={stop}
            onMouseLeave={() => pouring && stop()}
            onTouchStart={(event) => {
              event.preventDefault();
              start();
            }}
            onTouchEnd={(event) => {
              event.preventDefault();
              stop();
            }}
          >
            {pouring ? "붓는 중… 떼면 확정" : "누르고 있으면 부어집니다"}
          </button>
        </div>
      ) : null}

      {done ? (
        <div className={styles.result} role="status">
          <span className={styles.resultScore}>
            {okCount} / {vessels.length}
          </span>
          <span className={styles.resultBreakdown}>
            적정량 <b>{okCount}칸</b>
            {results.filter((r) => !r.ok).length > 0 ? (
              <>
                {" · "}과다 <b>{results.filter((r) => !r.ok && r.off > 0).length}</b>
                {" · "}부족 <b>{results.filter((r) => !r.ok && r.off < 0).length}</b>
              </>
            ) : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}
