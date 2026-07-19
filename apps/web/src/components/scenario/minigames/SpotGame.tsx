import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../../../styles/minigame.module.css";
import type { MinigameResult, SpotData } from "./types";
import { SCENE } from "./types";

/**
 * spot 엔진 — 화면에서 결함·이상을 찾아 표시한다. 46개 중 가장 많이 쓰이는 엔진.
 *
 * 채점: 찾은 targets 비율에서 decoy(정상인데 누른 것) 페널티를 뺀다. decoy가 없으면
 * 전부 눌러서 만점이 나오므로 데이터 쪽에서 반드시 넣게 되어 있다(_SCHEMA.md 규칙 5).
 *
 * 스프라이트 아트가 아직 없어 좌표 자리에 라벨 마커를 그린다 — 파이프라인이 끝까지
 * 도는지 먼저 확인하려는 것이고, 아트가 들어오면 마커를 <img>로 바꾸면 된다.
 */
type SpotGameProps = {
  data: SpotData;
  timeLimit: number | null;
  onComplete: (result: MinigameResult) => void;
};

type Picked = { id: string; kind: "hit" | "miss" };

export function SpotGame({ data, timeLimit, onComplete }: SpotGameProps) {
  const targets = useMemo(() => data.targets ?? [], [data.targets]);
  const decoys = useMemo(() => data.decoys ?? [], [data.decoys]);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [flash, setFlash] = useState(false);
  const [remaining, setRemaining] = useState(timeLimit);
  const [done, setDone] = useState(false);
  const startedAt = useRef(Date.now());
  const flashTimer = useRef<number | null>(null);

  const hits = picked.filter((p) => p.kind === "hit").length;
  const misses = picked.filter((p) => p.kind === "miss").length;
  const total = targets.length;

  const finish = useCallback(() => {
    setDone((already) => {
      if (already) return true;
      const penalty = Number(data.decoyPenalty ?? 10);
      const raw = total > 0 ? (hits / total) * 100 - misses * penalty : 0;
      onComplete({
        accuracy: Math.max(0, Math.min(100, Math.round(raw))),
        time_seconds: Math.round((Date.now() - startedAt.current) / 1000),
        mistakes: misses,
      });
      return true;
    });
  }, [data.decoyPenalty, hits, misses, total, onComplete]);

  // 제한시간 — 다 찾으면 타이머가 멈춘다
  useEffect(() => {
    if (done || remaining === null) return;
    if (remaining <= 0) {
      finish();
      return;
    }
    const timer = window.setTimeout(() => setRemaining((left) => (left === null ? null : left - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [remaining, done, finish]);

  // 전부 찾으면 즉시 종료 — 남은 시간을 멍하니 기다리게 하지 않는다
  useEffect(() => {
    if (!done && total > 0 && hits === total) finish();
  }, [hits, total, done, finish]);

  useEffect(() => () => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
  }, []);

  const pick = (id: string, kind: "hit" | "miss") => {
    if (done || picked.some((p) => p.id === id)) return;
    setPicked((current) => [...current, { id, kind }]);
    // 원문의 "사진 찍어 표시해 와라" — 표시할 때마다 셔터
    setFlash(true);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(false), 200);
  };

  const stateOf = (id: string) => picked.find((p) => p.id === id)?.kind ?? null;
  const timerPct = timeLimit && remaining !== null ? Math.max(0, (remaining / timeLimit) * 100) : 100;

  return (
    <div className={styles.shell}>
      <div className={styles.hud}>
        <span className={styles.hudLabel}>찾은 위험요소</span>
        <span className={styles.hudCount}>
          {hits} / {total}
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

      <div className={styles.scene} role="group" aria-label="현장 점검 화면">
        {targets.map((target) => (
          <button
            key={target.id}
            type="button"
            className={styles.hotspot}
            style={{ left: `${(target.at[0] / SCENE.w) * 100}%`, top: `${(target.at[1] / SCENE.h) * 100}%` }}
            data-state={stateOf(target.id)}
            disabled={done || stateOf(target.id) !== null}
            onClick={() => pick(target.id, "hit")}
          >
            {stateOf(target.id) ? target.label : target.sprite}
            {stateOf(target.id) ? (
              <span className={styles.mark} data-kind="hit" aria-hidden="true">
                ✓
              </span>
            ) : null}
          </button>
        ))}

        {decoys.map((decoy) => (
          <button
            key={decoy.id}
            type="button"
            className={styles.hotspot}
            style={{ left: `${(decoy.at[0] / SCENE.w) * 100}%`, top: `${(decoy.at[1] / SCENE.h) * 100}%` }}
            data-state={stateOf(decoy.id)}
            disabled={done || stateOf(decoy.id) !== null}
            onClick={() => pick(decoy.id, "miss")}
          >
            {decoy.sprite}
            {stateOf(decoy.id) ? (
              <span className={styles.mark} aria-hidden="true">
                ✕
              </span>
            ) : null}
          </button>
        ))}

        <span className={styles.shutter} data-flash={flash} aria-hidden="true" />
      </div>

      {done ? (
        <div className={styles.result} role="status">
          <span className={styles.resultScore}>
            {Math.max(0, Math.min(100, Math.round((total > 0 ? (hits / total) * 100 : 0) - misses * Number(data.decoyPenalty ?? 10))))}점
          </span>
          <span className={styles.resultBreakdown}>
            위험요소 <b>{hits}/{total}</b> 발견
            {misses > 0 ? (
              <>
                {" · "}정상인 곳을 <b>{misses}번</b> 표시 (감점)
              </>
            ) : (
              <>
                {" · "}오표시 <b>없음</b>
              </>
            )}
          </span>
        </div>
      ) : null}
    </div>
  );
}
