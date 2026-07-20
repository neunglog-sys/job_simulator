import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import shared from "../../../styles/minigame.module.css";
import styles from "../../../styles/physicsGame.module.css";
import { PixelSprite } from "./PixelSprite";
import {
  GameHud,
  ResultBar,
  clampScore,
  elapsedSeconds,
  failResult,
  scoringOf,
  useCountdown,
  type EngineProps,
} from "./shared";

/**
 * physics 엔진 — mode=rhythm(jm-02·ms-07) | balance(jm-05·ys-09).
 *
 * PourGame에서 확립한 규약을 따른다: rAF는 그리기만, 판정·상태는 시작 시각 기준
 * 역산(Date.now)으로 계산한다. 탭이 백그라운드로 가서 rAF가 멈춰도 노트 타이밍·
 * 유지 시간 판정이 틀어지지 않는다.
 *
 * 채점은 파일의 scoring 블록이 명세다(scoringOf로 읽고, 한 사건에는 가장 무거운
 * 감점 하나만 적용 — 중첩 금지). fails/fail 항목은 즉시 실패(failResult).
 */
export function PhysicsGame({ game, onComplete }: EngineProps) {
  const mode = String((game.data as { mode?: unknown }).mode ?? "rhythm");
  if (mode === "balance") return <BalanceGame game={game} onComplete={onComplete} />;
  return <RhythmGame game={game} onComplete={onComplete} />;
}

/* ══════════════════════ rhythm 모드 ══════════════════════ */

type Beat = {
  at: number;
  key?: string;
  window?: number;
  type?: string; // ms-07: wash | cut | swap | avoid
  zone?: string;
  signal?: string;
  cue?: string;
  action?: string;
  lane?: string;
  from?: string;
  to?: string;
  sprite?: string;
  label?: string;
};

type RhythmData = {
  hit_window?: number;
  /** 판정선 위에 얹는 도트 마커(ms-07 칼날) — 없으면 선만 그린다 */
  judge_marker?: string;
  /** lane.sprite = 그 레인의 정상 아이템 도트 — sprite 없는 cut 노트가 이걸 쓴다 */
  lanes?: Array<{ id: string; label?: string; sprite?: string }>;
  beats?: Beat[];
  decoy_beats?: Beat[];
  fails?: Array<{ when?: string; reason?: string }>;
};

type FailEntry = { when: string; reason: string };

/** 노트가 판정선까지 떨어지는 시간(초) — 화면 위치는 이 값 기준으로 시각 역산 */
const FALL_SECONDS = 2.4;
const DEFAULT_WINDOW = 0.35;
const DECOY_WINDOW = 0.35;

/** 판정 히트 밴드 확대(px) — 디자이너 확정(2026-07-20): 위아래 2px씩.
 *  시각 밴드(physicsGame.module.css 의 judgeLine[data-wide])와 타이밍 창을 함께 넓힌다.
 *  physicsGame.module.css 와 맞물린 값: 스테이지 높이 300px, 판정선까지 낙하 구간 86%.
 *  낙하 속도 = (0.86 × 300px) / FALL_SECONDS ≈ 107.5px/s → 2px ≈ 0.0186s.
 *  data.hit_window 를 쓰는 게임(ms-07)에만 적용 — beat별 window(jm-02)는 불변. */
const HIT_BAND_EXTRA_PX = 2;
const STAGE_HEIGHT_PX = 300;
const JUDGE_PROGRESS = 0.86;
const HIT_BAND_EXTRA_SECONDS = HIT_BAND_EXTRA_PX / ((JUDGE_PROGRESS * STAGE_HEIGHT_PX) / FALL_SECONDS);

/** 파일의 key 값 → 실제 키보드 입력 매핑. 화면 버튼도 같은 경로를 탄다. */
const KEY_HINT: Record<string, string> = {
  space: "SPACE",
  shift: "SHIFT",
  brake: "↓",
  accel: "↑",
  report: "R",
};

const KEY_LABEL: Record<string, string> = {
  space: "손질 (스페이스)",
  shift: "칼·도마 교체 (Shift)",
  brake: "제동 (↓ 또는 S)",
  accel: "가속 (↑ 또는 W)",
  report: "방호·보고 (R)",
};

function bindOf(event: KeyboardEvent): string | null {
  if (event.key === " " || event.code === "Space") return "space";
  if (event.key === "Shift") return "shift";
  if (event.key === "ArrowDown" || event.key === "s" || event.key === "S") return "brake";
  if (event.key === "ArrowUp" || event.key === "w" || event.key === "W") return "accel";
  if (event.key === "r" || event.key === "R" || event.key === "Enter") return "report";
  if (event.key.length === 1) return event.key.toLowerCase();
  return null;
}

/** fails 항목을 beat의 zone/signal 토큰과 겹치는 개수로 매칭한다(가장 많이 겹친 것). */
function failReasonFor(fails: FailEntry[], ...names: Array<string | undefined>): string | null {
  const tokens = names
    .filter((n): n is string => Boolean(n))
    .flatMap((n) => n.split("_"))
    .filter((t) => t.length > 0);
  let best: { score: number; reason: string } | null = null;
  for (const fail of fails) {
    const score = tokens.filter((t) => fail.when.includes(t)).length;
    if (score > 0 && (!best || score > best.score)) best = { score, reason: fail.reason };
  }
  return best?.reason ?? null;
}

type Judged = "hit" | "miss" | "spoiled";

export function RhythmGame({ game, onComplete }: EngineProps) {
  const data = game.data as RhythmData;
  const beats = useMemo(() => (data.beats ?? []).filter((b) => typeof b.at === "number"), [data.beats]);
  const decoys = useMemo(() => data.decoy_beats ?? [], [data.decoy_beats]);
  const lanes = useMemo(
    () => (data.lanes && data.lanes.length > 0 ? data.lanes : [{ id: "_main", label: "" }]),
    [data.lanes],
  );
  const fails = useMemo<FailEntry[]>(() => {
    const fromData = (data.fails ?? []).map((f) => ({ when: String(f.when ?? ""), reason: String(f.reason ?? "") }));
    const scoringFail = game.scoring?.fail;
    const fromScoring = Array.isArray(scoringFail)
      ? (scoringFail as Array<{ when?: unknown; reason?: unknown }>).map((f) => ({
          when: String(f.when ?? ""),
          reason: String(f.reason ?? ""),
        }))
      : [];
    return [...fromData, ...fromScoring].filter((f) => f.when);
  }, [data.fails, game.scoring]);

  /** 쳐야 하는 노트(avoid 제외). 채점 분모는 scoring.beat_count/hit_count 우선. */
  const hittable = useMemo(() => beats.filter((b) => b.type !== "avoid"), [beats]);
  const total = scoringOf(game, "beat_count", scoringOf(game, "hit_count", hittable.length));

  // 판정 상태 — 판정은 refs(시각 기준), 렌더는 nowSec state 로만 다시 그린다.
  const judgedRef = useRef(new Map<number, Judged>()); // beats index → 판정
  const decoyHitRef = useRef(new Set<number>());
  const countsRef = useRef({ hits: 0, misses: 0, swapMisses: 0, spoiled: 0, decoyHits: 0, strays: 0 });
  const washMissedRef = useRef(false);
  const doneRef = useRef(false);
  const [done, setDone] = useState(false);
  const [failReason, setFailReason] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [nowSec, setNowSec] = useState(0);
  const [flash, setFlash] = useState<"hit" | "bad" | null>(null);
  const flashTimer = useRef<number | null>(null);
  const reduced = useMemo(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    [],
  );

  const windowOf = useCallback(
    (beat: Beat) => {
      if (typeof beat.window === "number") return beat.window; // beat별 명시 창(jm-02) — 그대로
      // 파일 공통 hit_window(ms-07) — 히트 밴드 ±2px 확대분을 초로 환산해 더한다
      if (typeof data.hit_window === "number") return data.hit_window + HIT_BAND_EXTRA_SECONDS;
      return DEFAULT_WINDOW;
    },
    [data.hit_window],
  );

  // 관제 승인 시퀀스(jm-02): report beat 다음의 accel beat 가 '승인 후 재개'다.
  // (직전 beat 시각 ~ 승인 beat 창 열리기 전) 사이의 accel 입력은 즉시 실패.
  const approvalGate = useMemo(() => {
    const reportIdx = beats.findIndex((b) => b.key === "report");
    if (reportIdx < 0) return null;
    const approvalIdx = beats.findIndex((b, i) => i > reportIdx && b.key === "accel");
    if (approvalIdx < 0) return null;
    const prev = beats[reportIdx - 1];
    const approval = beats[approvalIdx];
    return {
      from: prev ? prev.at : beats[reportIdx].at - 2,
      until: approval.at - windowOf(approval),
      reason:
        failReasonFor(fails, approval.signal, "승인") ?? "승인 전에 운행을 재개했습니다",
    };
  }, [beats, fails, windowOf]);

  const finish = useCallback(
    (startedAtRef: { current: number }) => {
      if (doneRef.current) return;
      doneRef.current = true;
      const c = countsRef.current;
      const missPenalty = scoringOf(game, "miss_penalty", 0);
      const decoyPenalty = scoringOf(game, "decoy_penalty", 20);
      const spoiledPenalty = scoringOf(game, "spoiled_hit_penalty", 12);
      const swapPenalty = scoringOf(game, "swap_miss_penalty", 15);
      const strayPenalty = scoringOf(game, "stray_input_penalty", scoringOf(game, "overcut_penalty", 8));
      const base = total > 0 ? (c.hits / total) * 100 : 0;
      const accuracy = clampScore(
        base -
          c.misses * missPenalty -
          c.swapMisses * swapPenalty -
          c.spoiled * spoiledPenalty -
          c.decoyHits * decoyPenalty -
          c.strays * strayPenalty,
      );
      setScore(accuracy);
      setDone(true);
      onComplete({
        accuracy,
        time_seconds: elapsedSeconds(startedAtRef),
        mistakes: c.misses + c.swapMisses + c.spoiled + c.decoyHits + c.strays,
      });
    },
    [game, total, onComplete],
  );

  const { remaining, startedAt } = useCountdown(game.time_limit, done, () => finish(startedAt));

  const fail = useCallback(
    (reason: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      const c = countsRef.current;
      setFailReason(reason);
      setDone(true);
      onComplete(failResult(startedAt, c.misses + c.swapMisses + c.spoiled + c.decoyHits + c.strays + 1));
    },
    [onComplete, startedAt],
  );

  const now = useCallback(() => (Date.now() - startedAt.current) / 1000, [startedAt]);

  const pulse = useCallback((kind: "hit" | "bad") => {
    setFlash(kind);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 160);
  }, []);

  /** 창이 지나간 노트를 miss 처리한다 — rAF·interval 양쪽에서 시각 기준으로 호출. */
  const sweep = useCallback(
    (t: number) => {
      if (doneRef.current) return;
      beats.forEach((beat, i) => {
        if (judgedRef.current.has(i)) return;
        if (t <= beat.at + windowOf(beat)) return;
        if (beat.type === "avoid") {
          judgedRef.current.set(i, "hit"); // 안 친 것이 정답 — 감점 없음
          return;
        }
        judgedRef.current.set(i, "miss");
        // 안전 필수 beat(brake·report) 누락 = 즉시 실패(jm-02 fails)
        if (beat.key === "brake" || beat.key === "report") {
          const reason = failReasonFor(fails, beat.zone, beat.signal);
          if (reason) {
            fail(reason);
            return;
          }
        }
        if (beat.type === "wash") washMissedRef.current = true; // 다음 칼질에서 실패 확정
        if (beat.type === "swap") countsRef.current.swapMisses += 1;
        else countsRef.current.misses += 1;
      });
      const last = beats[beats.length - 1];
      if (!doneRef.current && last && t > last.at + windowOf(last) + 0.8) finish(startedAt);
    },
    [beats, windowOf, fails, fail, finish, startedAt],
  );

  /** 입력 1회 판정 — beat(정타) → avoid → decoy → stray 순서로 한 갈래만 태운다. */
  const handleInput = useCallback(
    (bind: string) => {
      if (doneRef.current) return;
      const t = now();
      sweep(t);
      if (doneRef.current) return;

      // 승인 전 가속(jm-02 금지행동) — 즉시 실패
      if (approvalGate && bind === "accel" && t > approvalGate.from && t < approvalGate.until) {
        fail(approvalGate.reason);
        return;
      }

      // 손위생 생략(ms-07) — wash 를 놓친 채 칼을 잡으면 즉시 실패
      if (washMissedRef.current && bind === "space") {
        fail(failReasonFor(fails, "손위생", "생략") ?? "손 위생을 생략하고 칼을 잡았습니다");
        return;
      }

      // 1) 정타 — 같은 key 의 미판정 노트 중 가장 가까운 것
      let bestIdx = -1;
      let bestDist = Number.POSITIVE_INFINITY;
      beats.forEach((beat, i) => {
        if (judgedRef.current.has(i) || beat.type === "avoid") return;
        if ((beat.key ?? "space") !== bind) return;
        const dist = Math.abs(t - beat.at);
        if (dist <= windowOf(beat) && dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      });
      if (bestIdx >= 0) {
        judgedRef.current.set(bestIdx, "hit");
        countsRef.current.hits += 1;
        pulse("hit");
        if (beats.every((_, i) => judgedRef.current.has(i))) finish(startedAt);
        return;
      }

      // 2) 상한 재료(avoid) — 치면 spoiled, 3회면 실패(ms-07 scoring.fail)
      const avoidIdx = beats.findIndex(
        (beat, i) => beat.type === "avoid" && !judgedRef.current.has(i) && Math.abs(t - beat.at) <= Math.max(windowOf(beat), DECOY_WINDOW),
      );
      if (avoidIdx >= 0) {
        judgedRef.current.set(avoidIdx, "spoiled");
        countsRef.current.spoiled += 1;
        pulse("bad");
        if (countsRef.current.spoiled >= 3) {
          const reason = failReasonFor(fails, "상한재료", "3회");
          if (reason) fail(reason);
        }
        return;
      }

      // 3) 함정 박자(decoy_beats) — 개당 decoy_penalty, 같은 함정은 1회만
      const decoyIdx = decoys.findIndex(
        (d, i) => !decoyHitRef.current.has(i) && Math.abs(t - d.at) <= DECOY_WINDOW,
      );
      if (decoyIdx >= 0) {
        decoyHitRef.current.add(decoyIdx);
        countsRef.current.decoyHits += 1;
        pulse("bad");
        return;
      }

      // 4) 창 밖 연타 — stray_input_penalty(jm-02) / overcut_penalty(ms-07)
      countsRef.current.strays += 1;
      pulse("bad");
    },
    [now, sweep, approvalGate, fails, beats, decoys, windowOf, pulse, fail, finish, startedAt],
  );

  // 키보드 입력
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (doneRef.current || event.repeat) return;
      const bind = bindOf(event);
      if (!bind) return;
      event.preventDefault();
      handleInput(bind);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleInput]);

  // rAF 는 그리기(+ 지나간 노트 정리)만. 백그라운드 보험으로 500ms interval 병행.
  useEffect(() => {
    if (done) return;
    let raf = 0;
    const step = () => {
      const t = now();
      setNowSec(t);
      sweep(t);
      raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    const timer = window.setInterval(() => sweep(now()), 500);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearInterval(timer);
    };
  }, [done, now, sweep]);

  useEffect(() => () => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
  }, []);

  const usedKeys = useMemo(
    () => [...new Set(hittable.map((b) => b.key ?? "space"))],
    [hittable],
  );
  const laneIndexOf = (beat: Beat) => {
    if (!beat.lane) return -1; // 레인 없는 노트(wash·swap·jm-02 전체)는 전폭 중앙
    const idx = lanes.findIndex((l) => l.id === beat.lane);
    return idx >= 0 ? idx : -1;
  };
  const hitCount = countsRef.current.hits;

  /** 노트 도트 — 노트 자체 sprite 우선, 없으면 레인의 정상 재료 sprite(ms-07 cut) */
  const spriteOf = (beat: Beat) => {
    if (beat.sprite) return beat.sprite;
    if (!beat.lane) return undefined;
    return lanes.find((l) => l.id === beat.lane)?.sprite;
  };

  const noteBody = (beat: Beat, kind: string, judged: Judged | undefined) => {
    const sprite = spriteOf(beat);
    const text = beat.label ?? beat.sprite ?? beat.action ?? beat.cue ?? "";
    return (
      <>
        {sprite ? (
          // 도트 스프라이트 — 파일이 없으면 PixelSprite가 지금까지의 라벨 칩으로 폴백한다
          <PixelSprite id={sprite} label={text || sprite} size={40} />
        ) : (
          <span>{text}</span>
        )}
        {beat.key && kind !== "decoy" ? <span className={styles.noteKey}>{KEY_HINT[beat.key] ?? beat.key.toUpperCase()}</span> : null}
        {judged === "hit" && kind !== "avoid" ? <span aria-hidden="true">✓</span> : null}
        {judged === "miss" || judged === "spoiled" ? <span aria-hidden="true">✕</span> : null}
      </>
    );
  };

  return (
    <div className={shared.shell}>
      <GameHud label="정확히 맞춘 박자" count={hitCount} total={total} remaining={remaining} timeLimit={game.time_limit} />

      {reduced ? (
        /* 접근성 폴백 — 노트 낙하 대신 순차 프롬프트(판정 로직은 동일) */
        <div className={styles.promptList} role="group" aria-label="순차 조작 안내">
          {beats
            .map((beat, i) => ({ beat, i }))
            .filter(({ i }) => !judgedRef.current.has(i))
            .slice(0, 4)
            .map(({ beat, i }) => {
              const left = Math.max(0, beat.at - nowSec);
              const active = Math.abs(nowSec - beat.at) <= windowOf(beat);
              return (
                <div key={i} className={styles.promptCard} data-active={active} data-kind={beat.type}>
                  <span>
                    {beat.type === "avoid" ? "치지 마세요 — " : "지금 준비 — "}
                    {beat.label ?? beat.sprite ?? beat.action ?? beat.cue ?? ""}
                  </span>
                  {beat.key ? <span className={styles.noteKey}>{KEY_HINT[beat.key] ?? beat.key}</span> : null}
                  <span className={styles.promptBarTrack} aria-hidden="true">
                    <span className={styles.promptBarValue} style={{ width: `${Math.max(0, 100 - (left / FALL_SECONDS) * 100)}%` }} />
                  </span>
                </div>
              );
            })}
        </div>
      ) : (
        <div className={styles.rhythmStage} role="group" aria-label="리듬 판정 화면">
          {lanes.map((lane) => (
            <div key={lane.id} className={styles.lane}>
              {lane.label ? <span className={styles.laneLabel}>{lane.label}</span> : null}
            </div>
          ))}
          {[
            ...beats.map((beat, i) => ({ beat, i, kind: beat.type ?? "beat", judged: judgedRef.current.get(i) })),
            ...decoys.map((beat, i) => ({ beat, i: beats.length + i, kind: "decoy", judged: decoyHitRef.current.has(i) ? ("spoiled" as Judged) : undefined })),
          ].map(({ beat, i, kind, judged }) => {
            const progress = (nowSec - (beat.at - FALL_SECONDS)) / FALL_SECONDS;
            if (progress < -0.05 || progress > 1.18) return null;
            const laneIdx = laneIndexOf(beat);
            const left = laneIdx >= 0 ? `${((laneIdx + 0.5) / lanes.length) * 100}%` : "50%";
            return (
              <span
                key={`${kind}-${i}`}
                className={styles.note}
                data-kind={kind}
                data-judged={judged}
                style={{ left, top: `${Math.min(1.12, progress) * 86}%` }}
              >
                {noteBody(beat, kind, judged)}
              </span>
            );
          })}
          <span
            className={styles.judgeLine}
            data-flash={flash ?? undefined}
            // hit_window 기반 게임(ms-07)은 히트 밴드가 ±2px 넓어진 만큼 시각 밴드도 함께 키운다
            data-wide={typeof data.hit_window === "number" ? "true" : undefined}
            aria-hidden="true"
          />
          {data.judge_marker ? (
            // 판정선 마커(ms-07 칼날) — 데이터에 있을 때만, 장식이라 판정에는 관여하지 않는다
            <span
              aria-hidden="true"
              style={{ position: "absolute", left: 8, bottom: "14%", transform: "translateY(50%)", pointerEvents: "none" }}
            >
              <PixelSprite id={data.judge_marker} label="" size={40} />
            </span>
          ) : null}
        </div>
      )}

      {!done ? (
        <div className={styles.controls}>
          {usedKeys.map((key) => (
            <button
              key={key}
              type="button"
              className={styles.controlButton}
              data-variant={key === "report" ? "primary" : undefined}
              aria-label={KEY_LABEL[key] ?? key}
              onClick={() => handleInput(key)}
            >
              {KEY_LABEL[key] ?? key}
            </button>
          ))}
        </div>
      ) : null}

      {done ? (
        <ResultBar score={score} failReason={failReason}>
          박자 <b>{hitCount}/{total}</b>
          {countsRef.current.misses + countsRef.current.swapMisses > 0 ? (
            <>
              {" · "}놓침 <b>{countsRef.current.misses + countsRef.current.swapMisses}</b>
            </>
          ) : null}
          {countsRef.current.spoiled > 0 ? (
            <>
              {" · "}상한 재료 <b>{countsRef.current.spoiled}</b>
            </>
          ) : null}
          {countsRef.current.decoyHits > 0 ? (
            <>
              {" · "}함정 조작 <b>{countsRef.current.decoyHits}</b>
            </>
          ) : null}
          {countsRef.current.strays > 0 ? (
            <>
              {" · "}창 밖 연타 <b>{countsRef.current.strays}</b>
            </>
          ) : null}
        </ResultBar>
      ) : null}
    </div>
  );
}

/* ══════════════════════ balance 모드 ══════════════════════ */

type BalanceAxis = { id?: string; label?: string; start?: number };

type BalanceData = {
  target?: number;
  tolerance?: number;
  drift?: number;
  hold_seconds?: number;
  axes?: BalanceAxis[];
  disturbances?: Array<{ at?: number; axis?: string; push?: number; reason?: string }>;
  forbidden?: Array<{ id?: string; reason?: string }>;
  settle?: { target_zone?: string; tolerance?: number; sway_fail?: number; drop_fail?: number };
};

function BalanceGame({ game, onComplete }: EngineProps) {
  const data = game.data as BalanceData;
  if (data.settle) return <SettleBalance game={game} onComplete={onComplete} />;
  return <AxesBalance game={game} onComplete={onComplete} />;
}

/** 게이지 표시 범위(±°) — tolerance 밴드는 이 범위 위에 그린다 */
const AXIS_RANGE = 8;
/** 방향키를 누르고 있을 때 보정 속도(°/s) */
const INPUT_RATE = 3.2;

/* ── balance: 축 기울기(jm-05 단일축 폴백 · ys-09 피치·롤 2축) ── */
function AxesBalance({ game, onComplete }: EngineProps) {
  const data = game.data as BalanceData;
  const target = data.target ?? 0;
  const tolerance = data.tolerance ?? 2;
  const drift = data.drift ?? 0.3;
  const holdSeconds = data.hold_seconds ?? 3;
  const axes = useMemo<BalanceAxis[]>(
    () => (data.axes && data.axes.length > 0 ? data.axes : [{ id: "기울기", label: "기울기", start: 2.6 }]),
    [data.axes],
  );
  const disturbances = useMemo(() => data.disturbances ?? [], [data.disturbances]);
  const forbidden = useMemo(() => data.forbidden ?? [], [data.forbidden]);
  const gate = forbidden[0] ?? null; // 첫 항목 = 시작 전 게이트(ys-09 프로펠러 분리)
  const trap = forbidden[1] ?? null; // 둘째 항목 = 성급한 완료 보고 함정(수평확인 생략)

  const sim = useRef({
    angles: axes.map((a) => a.start ?? 0),
    bias: axes.map(() => 0),
    input: axes.map(() => 0),
    outSeconds: 0,
    excursions: 0,
    prevInRange: false,
    inRangeSince: null as number | null,
    lastStep: Date.now(),
    started: false,
    startedAtMs: 0,
    fired: disturbances.map(() => false),
    forbiddenHits: new Set<string>(),
  });
  const doneRef = useRef(false);
  const [done, setDone] = useState(false);
  const [score, setScore] = useState(0);
  const [angles, setAngles] = useState(() => [...sim.current.angles]);
  const [holdPct, setHoldPct] = useState(0);
  const [gateOpen, setGateOpen] = useState(gate !== null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  /** 채점 — 허용범위 밖에 머문 시간(초기 안정화 유예 제외)에 비례해 깎는다. */
  const finishScore = useCallback(
    (startedAtRef: { current: number }) => {
      if (doneRef.current) return;
      doneRef.current = true;
      const s = sim.current;
      const perSecond = scoringOf(game, "out_of_range_penalty", 15);
      const forbiddenPenalty = scoringOf(game, "forbidden_penalty", 40);
      const grace = holdSeconds + 2; // 시작 기울기를 잡는 데 드는 정상 시간
      const excess = Math.max(0, s.outSeconds - grace);
      const accuracy = clampScore(100 - excess * perSecond - s.forbiddenHits.size * forbiddenPenalty);
      setScore(accuracy);
      setDone(true);
      onComplete({
        accuracy,
        time_seconds: elapsedSeconds(startedAtRef),
        mistakes: s.excursions + s.forbiddenHits.size,
      });
    },
    [game, holdSeconds, onComplete],
  );

  const { remaining, startedAt } = useCountdown(game.time_limit, done, () => finishScore(startedAt));

  /** 금지행동 — 같은 항목은 1회만 감점(중첩 금지). */
  const forbiddenOnce = useCallback(
    (entry: { id?: string; reason?: string }) => {
      const id = entry.id ?? "forbidden";
      if (sim.current.forbiddenHits.has(id)) return;
      sim.current.forbiddenHits.add(id);
      showToast(entry.reason ?? "금지된 조작입니다");
    },
    [showToast],
  );

  const setInput = useCallback(
    (axisIdx: number, value: number) => {
      if (doneRef.current) return;
      if (gate && !sim.current.started) {
        if (value !== 0) forbiddenOnce(gate); // 분리 전 조정 시도 = 금지행동
        return;
      }
      sim.current.input[axisIdx] = value;
    },
    [gate, forbiddenOnce],
  );

  const clearGate = useCallback(() => {
    if (sim.current.started || doneRef.current) return;
    sim.current.started = true;
    sim.current.startedAtMs = Date.now();
    sim.current.lastStep = Date.now();
    setGateOpen(false);
  }, []);

  // 게이트가 없으면(jm-05류 단일축) 바로 시작
  useEffect(() => {
    if (!gate) {
      sim.current.started = true;
      sim.current.startedAtMs = Date.now();
    }
  }, [gate]);

  /** 시뮬레이션 한 스텝 — dt 는 벽시계에서 역산하되 프레임당 0.1초로 클램프.
   *  백그라운드에서 rAF 가 멈췄다 돌아와도 물리가 폭주하지 않는다. 유지 시간은
   *  타임스탬프(inRangeSince)로 판정하므로 탭이 숨어 있어도 정확하다. */
  const step = useCallback(
    (nowMs: number) => {
      const s = sim.current;
      const dt = Math.min(0.1, Math.max(0, (nowMs - s.lastStep) / 1000));
      s.lastStep = nowMs;
      if (!s.started || doneRef.current || dt === 0) return;

      const elapsed = (nowMs - s.startedAtMs) / 1000;
      axes.forEach((_, i) => {
        s.bias[i] += (Math.random() * 2 - 1) * drift * 6 * dt;
        s.bias[i] = Math.max(-drift * 3, Math.min(drift * 3, s.bias[i]));
        s.angles[i] += s.bias[i] * dt + s.input[i] * INPUT_RATE * dt;
        s.angles[i] = Math.max(-AXIS_RANGE, Math.min(AXIS_RANGE, s.angles[i]));
      });

      // 교란 — at ≤ 1 이면 제한시간 대비 비율, 그보다 크면 초로 해석
      disturbances.forEach((d, i) => {
        if (s.fired[i]) return;
        const at = d.at ?? 0;
        const fireAt = at <= 1 ? at * (game.time_limit ?? 45) : at;
        if (elapsed < fireAt) return;
        s.fired[i] = true;
        const axisIdx = Math.max(0, axes.findIndex((a) => a.id === d.axis));
        s.angles[axisIdx] += d.push ?? 1;
        if (d.reason) showToast(d.reason);
      });

      const inRange = s.angles.every((angle) => Math.abs(angle - target) <= tolerance);
      if (inRange) {
        if (s.inRangeSince === null) s.inRangeSince = nowMs;
        if ((nowMs - s.inRangeSince) / 1000 >= holdSeconds) {
          finishScore(startedAt); // 안정화 성공 — 즉시 종료
          return;
        }
      } else {
        if (s.prevInRange) s.excursions += 1; // 잡았다가 다시 벗어남
        s.inRangeSince = null;
        s.outSeconds += dt;
      }
      s.prevInRange = inRange;
    },
    [axes, drift, disturbances, game.time_limit, target, tolerance, holdSeconds, finishScore, startedAt, showToast],
  );

  // rAF 는 그리기용 — 백그라운드 보험으로 300ms interval 병행(유지 성공 감지)
  useEffect(() => {
    if (done) return;
    let raf = 0;
    const frame = () => {
      step(Date.now());
      const s = sim.current;
      setAngles([...s.angles]);
      setHoldPct(s.inRangeSince ? Math.min(1, (Date.now() - s.inRangeSince) / 1000 / holdSeconds) : 0);
      raf = window.requestAnimationFrame(frame);
    };
    raf = window.requestAnimationFrame(frame);
    const timer = window.setInterval(() => step(Date.now()), 300);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearInterval(timer);
    };
  }, [done, step, holdSeconds]);

  // 키보드 — 축0: ↑/W(−)·↓/S(+), 축1: ←/A(−)·→/D(+). 축이 하나면 ←/→ 로도 잡는다.
  useEffect(() => {
    const single = axes.length === 1;
    const keyMap = (key: string): [number, number] | null => {
      if (key === "ArrowUp" || key === "w" || key === "W") return [0, -1];
      if (key === "ArrowDown" || key === "s" || key === "S") return [0, 1];
      if (key === "ArrowLeft" || key === "a" || key === "A") return single ? [0, -1] : [1, -1];
      if (key === "ArrowRight" || key === "d" || key === "D") return single ? [0, 1] : [1, 1];
      return null;
    };
    const onDown = (event: KeyboardEvent) => {
      const hit = keyMap(event.key);
      if (!hit || hit[0] >= axes.length) return;
      event.preventDefault();
      setInput(hit[0], hit[1]);
    };
    const onUp = (event: KeyboardEvent) => {
      const hit = keyMap(event.key);
      if (!hit || hit[0] >= axes.length) return;
      setInput(hit[0], 0);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [axes.length, setInput]);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  const okCount = angles.filter((angle) => Math.abs(angle - target) <= tolerance).length;
  const bandLeft = ((target - tolerance + AXIS_RANGE) / (AXIS_RANGE * 2)) * 100;
  const bandWidth = ((tolerance * 2) / (AXIS_RANGE * 2)) * 100;

  return (
    <div className={shared.shell}>
      <GameHud
        label="허용범위 안 축"
        count={okCount}
        total={scoringOf(game, "axis_count", axes.length)}
        remaining={remaining}
        timeLimit={game.time_limit}
      />

      <div className={styles.balanceStage} role="group" aria-label="축별 기울기 표시계" style={{ position: "relative" }}>
        {axes.map((axis, i) => {
          const angle = angles[i] ?? 0;
          const ok = Math.abs(angle - target) <= tolerance;
          return (
            <div key={axis.id ?? i} className={styles.axisRow}>
              <span className={styles.axisLabel}>
                {axis.label ?? axis.id}
                <span className={styles.axisVerdict} data-ok={ok}>
                  {ok ? "범위 안" : "범위 밖"}
                </span>
              </span>
              <div className={styles.axisTrack}>
                <span className={styles.axisBand} style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }} />
                <span className={styles.axisCenter} aria-hidden="true" />
                <span
                  className={styles.axisNeedle}
                  data-ok={ok}
                  style={{ left: `${((angle + AXIS_RANGE) / (AXIS_RANGE * 2)) * 100}%` }}
                />
              </div>
            </div>
          );
        })}

        <div className={styles.holdRow}>
          <span>안정화 유지</span>
          <span className={styles.holdTrack}>
            <span className={styles.holdValue} style={{ width: `${holdPct * 100}%` }} />
          </span>
        </div>

        {gateOpen && gate ? (
          <div className={styles.gateOverlay}>
            <p className={styles.gateText}>{gate.reason ?? "시작 전 확인이 필요합니다"}</p>
            <button type="button" className={styles.controlButton} data-variant="primary" onClick={clearGate}>
              프로펠러 분리
            </button>
          </div>
        ) : null}
      </div>

      {toast ? <span className={styles.toast} role="status">{toast}</span> : null}

      {!done ? (
        <div className={styles.controls}>
          {axes.map((axis, i) => (
            <span key={axis.id ?? i} style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className={styles.controlButton}
                aria-label={`${axis.label ?? axis.id} 낮추기`}
                onPointerDown={() => setInput(i, -1)}
                onPointerUp={() => setInput(i, 0)}
                onPointerLeave={() => setInput(i, 0)}
              >
                {i === 0 ? "▲" : "◀"} {axis.label ?? axis.id}
              </button>
              <button
                type="button"
                className={styles.controlButton}
                aria-label={`${axis.label ?? axis.id} 높이기`}
                onPointerDown={() => setInput(i, 1)}
                onPointerUp={() => setInput(i, 0)}
                onPointerLeave={() => setInput(i, 0)}
              >
                {i === 0 ? "▼" : "▶"} {axis.label ?? axis.id}
              </button>
            </span>
          ))}
          {trap ? (
            <button
              type="button"
              className={styles.controlButton}
              data-variant="danger"
              aria-label="수평 확인 전 투입 요청(금지행동)"
              onClick={() => {
                forbiddenOnce(trap); // 수평확인 생략 = 금지행동 감점 후 그대로 종료
                finishScore(startedAt);
              }}
            >
              비행 투입 요청
            </button>
          ) : null}
        </div>
      ) : null}

      {done ? (
        <ResultBar score={score}>
          범위 이탈 <b>{Math.round(sim.current.outSeconds)}초</b>
          {sim.current.excursions > 0 ? (
            <>
              {" · "}재이탈 <b>{sim.current.excursions}회</b>
            </>
          ) : null}
          {sim.current.forbiddenHits.size > 0 ? (
            <>
              {" · "}금지행동 <b>{sim.current.forbiddenHits.size}건</b>
            </>
          ) : null}
        </ResultBar>
      ) : null}
    </div>
  );
}

/* ── balance: settle(jm-05 크레인 양중 착지) ── */

/** 착지 목표점 중심(정규화 −1~1) — 시작 위치(−0.6)에서 이동해 와야 한다 */
const TARGET_X = 0.45;
/** 흔들림이 착지점에 더해지는 수평 팔 길이 */
const SWAY_LEVER = 0.35;

function SettleBalance({ game, onComplete }: EngineProps) {
  const data = game.data as BalanceData;
  const drift = data.drift ?? 0.3;
  const settle = data.settle ?? {};
  const zoneTol = settle.tolerance ?? 0.1;
  const swayFail = settle.sway_fail ?? 0.6;
  const dropFail = settle.drop_fail ?? 0.5;

  const sim = useRef({
    x: -0.6, // 트롤리 수평 위치 (−1 ~ 1)
    s: 0.18, // 흔들림 변위 — 살짝 흔들린 채 시작
    sv: 0,
    bias: 0,
    h: 1, // 화물 높이 (1=위, 0=착지)
    vh: 0, // 하강 속도
    input: 0, // −1 | 0 | 1
    lower: false,
    lastStep: Date.now(),
  });
  const doneRef = useRef(false);
  const [done, setDone] = useState(false);
  const [failReason, setFailReason] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [view, setView] = useState({ x: -0.6, s: 0.18, h: 1, vh: 0 });
  const [landedOff, setLandedOff] = useState<number | null>(null);

  const fail = useCallback(
    (reason: string, startedAtRef: { current: number }) => {
      if (doneRef.current) return;
      doneRef.current = true;
      setFailReason(reason);
      setDone(true);
      onComplete(failResult(startedAtRef, 1));
    },
    [onComplete],
  );

  /** 착지 채점 — 목표점 반경 안이면 만점, 밖이면 어긋난 거리에 비례해 깎는다. */
  const land = useCallback(
    (startedAtRef: { current: number }) => {
      if (doneRef.current) return;
      const s = sim.current;
      if (s.vh > dropFail) {
        fail("하강 속도가 너무 빨라 화물을 세게 떨어뜨렸습니다", startedAtRef);
        return;
      }
      doneRef.current = true;
      const off = Math.abs(s.x + s.s * SWAY_LEVER - TARGET_X);
      const accuracy = off <= zoneTol ? 100 : clampScore(100 - (off - zoneTol) * 220);
      setLandedOff(off);
      setScore(accuracy);
      setDone(true);
      onComplete({
        accuracy,
        time_seconds: elapsedSeconds(startedAtRef),
        mistakes: off <= zoneTol ? 0 : 1,
      });
    },
    [dropFail, zoneTol, fail, onComplete],
  );

  const { remaining, startedAt } = useCountdown(game.time_limit, done, () =>
    fail("제한 시간 안에 안착하지 못했습니다", startedAt),
  );

  /** 물리 스텝 — 벽시계 dt(프레임당 0.1초 클램프). rAF 는 그리기 전용. */
  const step = useCallback(
    (nowMs: number) => {
      const s = sim.current;
      const dt = Math.min(0.1, Math.max(0, (nowMs - s.lastStep) / 1000));
      s.lastStep = nowMs;
      if (doneRef.current || dt === 0) return;

      // 트롤리 이동 — 움직임이 흔들림을 키운다(반동)
      s.x = Math.max(-0.95, Math.min(0.95, s.x + s.input * 0.45 * dt));

      // 흔들림 — 진자 복원력 + 감쇠 + 입력 반동 + 바람(drift) 랜덤워크
      s.bias += (Math.random() * 2 - 1) * drift * 3 * dt;
      s.bias = Math.max(-drift, Math.min(drift, s.bias));
      s.sv += (-5.5 * s.s - 0.5 * s.sv - s.input * 1.35 + s.bias) * dt;
      s.s += s.sv * dt;

      // 하강 — 누르고 있으면 가속(참으면 위험 속도까지), 떼면 권상 브레이크
      if (s.lower) s.vh = Math.min(0.85, s.vh + 0.45 * dt);
      else s.vh = Math.max(0, s.vh - 2.2 * dt);
      s.h = Math.max(0, s.h - s.vh * dt);

      if (Math.abs(s.s) > swayFail) {
        fail("화물이 크게 흔들려 인접 자재를 옆으로 쳤습니다", startedAt);
        return;
      }
      if (s.h <= 0) land(startedAt);
    },
    [drift, swayFail, fail, land, startedAt],
  );

  useEffect(() => {
    if (done) return;
    let raf = 0;
    const frame = () => {
      step(Date.now());
      const s = sim.current;
      setView({ x: s.x, s: s.s, h: s.h, vh: s.vh });
      raf = window.requestAnimationFrame(frame);
    };
    raf = window.requestAnimationFrame(frame);
    const timer = window.setInterval(() => step(Date.now()), 300);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearInterval(timer);
    };
  }, [done, step]);

  // 키보드 — ←/A·→/D 이동, ↓/S 누르는 동안 하강
  useEffect(() => {
    const onDown = (event: KeyboardEvent) => {
      if (doneRef.current) return;
      if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
        event.preventDefault();
        sim.current.input = -1;
      } else if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
        event.preventDefault();
        sim.current.input = 1;
      } else if (event.key === "ArrowDown" || event.key === "s" || event.key === "S") {
        event.preventDefault();
        sim.current.lower = true;
      }
    };
    const onUp = (event: KeyboardEvent) => {
      if (["ArrowLeft", "a", "A", "ArrowRight", "d", "D"].includes(event.key)) sim.current.input = 0;
      if (["ArrowDown", "s", "S"].includes(event.key)) sim.current.lower = false;
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, []);

  const pct = (v: number) => ((v + 1) / 2) * 100; // 정규화 −1~1 → 스테이지 %
  const loadX = view.x + view.s * SWAY_LEVER;
  const loadTop = 12 + (1 - view.h) * 56; // % — h=0 이면 지면 위
  const projectedOk = Math.abs(loadX - TARGET_X) <= zoneTol;

  return (
    <div className={shared.shell}>
      <GameHud label="안착" count={done && !failReason ? 1 : 0} total={1} remaining={remaining} timeLimit={game.time_limit} />

      <div className={styles.craneStage} role="group" aria-label="크레인 양중 화면">
        <span className={styles.craneRail} aria-hidden="true" />
        <span className={styles.craneTrolley} style={{ left: `${pct(view.x)}%` }} aria-hidden="true" />
        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }} aria-hidden="true">
          <line
            x1={`${pct(view.x)}%`}
            y1="12%"
            x2={`${pct(loadX)}%`}
            y2={`${loadTop}%`}
            stroke="rgba(255,255,255,0.5)"
            strokeWidth="2"
          />
        </svg>
        <span
          className={styles.craneLoad}
          data-warn={Math.abs(view.s) > swayFail * 0.7}
          style={{ left: `${pct(loadX)}%`, top: `${loadTop}%` }}
          aria-hidden="true"
        />
        <span
          className={styles.craneZone}
          data-locked={projectedOk}
          style={{ left: `${pct(TARGET_X)}%`, width: `${zoneTol * 100}%` }}
          aria-hidden="true"
        />
        <span className={styles.craneGround} aria-hidden="true" />
        <span className={styles.speedHint} data-fast={view.vh > dropFail * 0.8}>
          {view.vh > dropFail * 0.8 ? "하강 속도 위험" : "하강 속도 안전"}
        </span>
      </div>

      {!done ? (
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.controlButton}
            aria-label="왼쪽으로 이동 (← 또는 A)"
            onPointerDown={() => {
              sim.current.input = -1;
            }}
            onPointerUp={() => {
              sim.current.input = 0;
            }}
            onPointerLeave={() => {
              sim.current.input = 0;
            }}
          >
            ◀ 좌
          </button>
          <button
            type="button"
            className={styles.controlButton}
            aria-label="오른쪽으로 이동 (→ 또는 D)"
            onPointerDown={() => {
              sim.current.input = 1;
            }}
            onPointerUp={() => {
              sim.current.input = 0;
            }}
            onPointerLeave={() => {
              sim.current.input = 0;
            }}
          >
            우 ▶
          </button>
          <button
            type="button"
            className={styles.controlButton}
            data-variant="primary"
            aria-label="누르는 동안 하강 (↓ 또는 S)"
            onPointerDown={() => {
              sim.current.lower = true;
            }}
            onPointerUp={() => {
              sim.current.lower = false;
            }}
            onPointerLeave={() => {
              sim.current.lower = false;
            }}
          >
            ▼ 누르는 동안 하강
          </button>
        </div>
      ) : null}

      {done ? (
        <ResultBar score={score} failReason={failReason}>
          {landedOff !== null ? (
            landedOff <= zoneTol ? (
              <>
                목표점 안에 <b>살짝 안착</b>
              </>
            ) : (
              <>
                목표점에서 <b>벗어나</b> 안착 (거리 비례 감점)
              </>
            )
          ) : null}
        </ResultBar>
      ) : null}
    </div>
  );
}
