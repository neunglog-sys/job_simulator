import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import shared from "../../../styles/minigame.module.css";
import styles from "../../../styles/pourGame.module.css";
import { PixelSprite } from "./PixelSprite";
import {
  GameHud,
  ResultBar,
  clampScore,
  elapsedSeconds,
  scoringOf,
  useCountdown,
  type EngineProps,
} from "./shared";

/**
 * pour 엔진 — 구유의 표시선까지 정확히 붓는다. ms-06(개체별 정량 급이) 단독 엔진.
 *
 * 숫자를 띄우지 않는다(_SCHEMA.md 규칙 1). 목표는 구유에 그어진 선으로만 읽히고,
 * 채점은 선에서 벗어난 정도로 한다. 넘친 쪽 감점이 모자란 쪽보다 큰 이유는
 * ms-06 원문에서 사료가 흩어지는 것이 낭비·오염 문제이기 때문.
 *
 * 표시층(채점과 무관 — YAML presentation 필드):
 * - 축사 장면: 나무 벽 판자 + 짚 바닥은 CSS로 그린다(pourGame.module.css).
 * - vessel.sprite: 구유 위 개체 도트 아이콘(성체/어린 무리/임신/회복 — 축종 중립).
 *   파일이 없으면 PixelSprite 규약대로 라벨 칩 폴백.
 * - vessel.scale: 스프라이트 표시 배율(기본 1) — SortGame item.scale 과 같은 규약.
 * - data.trough_sprite: 구유 프레임 도트(내부 개구부가 투명해 사료 채움이 비친다).
 *   로드 실패 시 기존 사각 게이지로 폴백(data-art="false") — 폴백 규약 유지.
 * - data.pour_sprite: 프레스-홀드 급이 버튼의 사료 포대 아이콘.
 *
 * 물리 규약(기존 유지): 부은 양은 '누르기 시작한 시각' 기준 wall-clock 역산,
 * rAF는 화면 갱신 전용 — 백그라운드 탭에서 rAF가 멈춰도 실제 양은 정확하다.
 */

type PourVessel = {
  id: string;
  label?: string;
  /** 목표 높이 0~1. 화면엔 숫자가 아니라 표시선으로만 그린다. */
  target: number;
  /** 이 폭 안이면 만점 */
  tolerance: number;
  /** 표시 전용 — 구유 위 개체 도트 스프라이트 id */
  sprite?: string;
  /** 표시 전용 — 스프라이트 표시 배율(기본 1) */
  scale?: number;
};

type PourGameData = {
  vessels?: PourVessel[];
  /** 표시 전용 — 구유 프레임 도트 스프라이트 id */
  trough_sprite?: string;
  /** 표시 전용 — 급이 버튼 아이콘 스프라이트 id */
  pour_sprite?: string;
};

type PourOutcome = { id: string; off: number; ok: boolean };

type Summary = { accuracy: number; ok: number; over: number; under: number };

const FILL_RATE = 0.55; // 초당 채워지는 비율 — 정밀 조작이 가능한 속도

/** YAML이 생략해도 아트가 붙도록 두는 기본 스프라이트 id (파일 없으면 자동 폴백). */
const DEFAULT_TROUGH_SPRITE = "구유_나무";
const DEFAULT_POUR_SPRITE = "사료포대_삽";

/** vessel.scale(기본 1)을 곱한 스프라이트 표시 폭 — 0 이하·비숫자는 1로 취급. */
function spriteSize(base: number, vessel: PourVessel): number {
  const scale = typeof vessel.scale === "number" && vessel.scale > 0 ? vessel.scale : 1;
  return Math.round(base * scale);
}

export function PourGame({ game, onComplete }: EngineProps) {
  const data = useMemo<PourGameData>(() => (game.data ?? {}) as PourGameData, [game.data]);
  const vessels = useMemo<PourVessel[]>(
    () => (Array.isArray(data.vessels) ? data.vessels : []),
    [data.vessels],
  );
  const troughSprite = data.trough_sprite ?? DEFAULT_TROUGH_SPRITE;
  const pourSprite = data.pour_sprite ?? DEFAULT_POUR_SPRITE;

  const [index, setIndex] = useState(0);
  const [level, setLevel] = useState(0);
  const [pouring, setPouring] = useState(false);
  const [results, setResults] = useState<PourOutcome[]>([]);
  const [done, setDone] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  // 구유 프레임 아트 — 파일이 없으면 전 칸 공통으로 사각 게이지 폴백(현행 규약 유지)
  const [troughArt, setTroughArt] = useState(true);
  const finished = useRef(false);
  const raf = useRef<number | null>(null);
  const pourStartedAt = useRef(0);

  const current: PourVessel | undefined = vessels[index];

  const finish = useCallback(
    (final: PourOutcome[]) => {
      if (finished.current) return;
      finished.current = true;
      setDone(true);
      setPouring(false);
      const over = scoringOf(game, "over_penalty", 12);
      const under = scoringOf(game, "under_penalty", 8);
      // 구유마다 100점에서 벗어난 만큼 깎고 평균낸다. 미완료 구유는 0점 처리.
      const scores = vessels.map((v) => {
        const hit = final.find((r) => r.id === v.id);
        if (!hit) return 0;
        if (hit.ok) return 100;
        const penalty = hit.off > 0 ? over : under;
        return Math.max(0, 100 - Math.abs(hit.off) * 100 * (penalty / 10));
      });
      const accuracy = clampScore(
        scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
      );
      setSummary({
        accuracy,
        ok: final.filter((r) => r.ok).length,
        over: final.filter((r) => !r.ok && r.off > 0).length,
        under: final.filter((r) => !r.ok && r.off < 0).length,
      });
      onComplete({
        accuracy,
        time_seconds: elapsedSeconds(startedAt),
        mistakes: final.filter((r) => !r.ok).length,
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps -- startedAt 은 아래 useCountdown 의 안정 ref
    }, [game, vessels, onComplete]);

  const { remaining, startedAt } = useCountdown(game.time_limit, done, () => finish(results));

  // 채워진 양은 '누르기 시작한 시각'에서 계산한다 — 프레임에 누적하지 않는다.
  // rAF는 화면 갱신에만 쓴다. 탭이 백그라운드로 가면 브라우저가 rAF를 멈추는데,
  // 프레임에 누적하는 방식이면 그동안 부은 양이 통째로 사라진다.
  const levelAt = useCallback(
    (now: number) => Math.min(1.2, ((now - pourStartedAt.current) / 1000) * FILL_RATE),
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
    const off = poured - current.target; // + 넘침 / − 모자람
    const ok = Math.abs(off) <= current.tolerance;
    const next = [...results, { id: current.id, off, ok }];
    setResults(next);
    setLevel(0);
    if (index + 1 >= vessels.length) finish(next);
    else setIndex(index + 1);
  };

  return (
    <div className={shared.shell}>
      <GameHud
        label="정량 급이"
        count={results.length}
        total={vessels.length}
        remaining={remaining}
        timeLimit={game.time_limit}
      />

      {/* 축사 장면 — 나무 벽 + 짚 바닥 위에 칸(스톨)별 개체·구유가 선다 */}
      <div className={styles.barn} role="group" aria-label="축사 급이 현장">
        <div className={styles.stalls}>
          {vessels.map((vessel, i) => {
            const hit = results.find((r) => r.id === vessel.id);
            const active = i === index && !done;
            const shown = active ? level : hit ? vessel.target + hit.off : 0;
            const title = vessel.label ?? vessel.id;
            return (
              <div
                key={vessel.id}
                className={styles.stall}
                data-active={active}
                data-done={Boolean(hit)}
                role="group"
                aria-label={title}
              >
                {/* 개체 아이콘 — 급이 대상이 누구인지 아트 상태 차이로만 읽힌다 */}
                <div className={styles.pen}>
                  <PixelSprite
                    id={vessel.sprite ?? ""}
                    label={title}
                    size={spriteSize(56, vessel)}
                    fallbackClassName={styles.penFallback}
                  />
                </div>

                <div className={styles.trough} data-art={troughArt}>
                  <div className={styles.cavity}>
                    {/* 허용 밴드·목표선 — 숫자 없이 이 선만 보고 맞춘다 */}
                    <span
                      className={styles.toleranceBand}
                      style={{
                        bottom: `${(vessel.target - vessel.tolerance) * 100}%`,
                        height: `${vessel.tolerance * 2 * 100}%`,
                      }}
                    />
                    <span className={styles.targetLine} style={{ bottom: `${vessel.target * 100}%` }} />
                    <span
                      className={styles.fill}
                      style={{ height: `${Math.min(100, shown * 100)}%` }}
                      data-verdict={hit ? (hit.ok ? "ok" : hit.off > 0 ? "over" : "under") : undefined}
                    />
                    {active && pouring ? <span className={styles.pourStream} aria-hidden="true" /> : null}
                  </div>
                  {troughArt ? (
                    // 구유 프레임 도트 — 내부 개구부가 투명해 뒤의 사료 채움이 비친다.
                    // 파일이 없으면 onError 로 사각 게이지 폴백(PixelSprite 폴백 규약과 일관).
                    <img
                      className={styles.troughFrame}
                      src={`${import.meta.env.BASE_URL}assets/minigames/${encodeURIComponent(troughSprite)}.svg`}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                      onError={() => setTroughArt(false)}
                    />
                  ) : null}
                </div>

                <span className={styles.stallLabel}>{title}</span>
                {hit ? (
                  <span className={styles.stallVerdict} data-ok={hit.ok}>
                    {hit.ok ? "적정" : hit.off > 0 ? "과다" : "부족"}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {!done && current ? (
        <div className={styles.footer}>
          <button
            className={styles.pourButton}
            type="button"
            data-pouring={pouring}
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
            <PixelSprite
              id={pourSprite}
              label="사료 포대"
              size={30}
              fallbackClassName={styles.pourButtonFallback}
            />
            <span>{pouring ? "붓는 중… 떼면 확정" : "누르고 있으면 부어집니다"}</span>
          </button>
        </div>
      ) : null}

      {done && summary ? (
        <ResultBar score={summary.accuracy}>
          적정량 <b>
            {summary.ok}/{vessels.length}
          </b>
          {summary.over + summary.under > 0 ? (
            <>
              {" · "}과다 <b>{summary.over}</b>
              {" · "}부족 <b>{summary.under}</b>
            </>
          ) : null}
        </ResultBar>
      ) : null}
    </div>
  );
}
