import { useMemo, useRef, useState } from "react";
import base from "../../../styles/minigame.module.css";
import styles from "../../../styles/gaugeGame.module.css";
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
 * gauge 엔진 — 바늘이 멈춘 자리를 색 띠로 읽고 판정한다. 4개 시나리오가 쓴다.
 *
 * 숫자는 화면에 절대 띄우지 않는다(_SCHEMA.md 규칙 1) — value는 바늘 각도를 정하는
 * 내부 수치일 뿐이다. 경계값 함정(88 vs 90)이 성립하도록 240° 스윕의 큰 다이얼에
 * ok_zone 색 띠와 경계 눈금을 그려, 바늘이 눈금의 어느 쪽인지로만 판별하게 한다.
 *
 * 두 모드(데이터가 결정):
 * - 판정 모드(ys-04·ys-06·ys-07): 게이지마다 합격/불합격 버튼. 버튼 라벨은 파일의
 *   action(적재칸·재충전대·차단표찰 부착·재조임)에서 오되 게임 전체에 동일 — 정답 비유출.
 * - 순찰 모드(ys-08 — scoring에 miss/false_tap 키): 이상 계기만 탭한다. 놓치면 miss_penalty,
 *   정상을 탭하면 false_tap_penalty.
 *
 * escalate(ys-04 반장 보고)는 escalate_required면 판정 1건으로 세고, 생략 시 추가 감점.
 * forbidden 버튼(ys-06 직접조임 등)은 scoring.forbidden_penalty가 있을 때만 렌더 — 누르면 40.
 */

type GaugeItem = {
  id: string;
  label?: string;
  sprite?: string;
  value: number;
  verdict: string; // "pass" | "fail"
  action?: string;
};
type GaugeData = {
  ok_zone?: [number, number];
  gauges?: GaugeItem[];
  escalate?: { label?: string; when?: string | string[]; sprite?: string };
  forbidden?: Array<{ id: string; reason?: string }>;
};

type Summary = {
  score: number;
  correct: number;
  total: number;
  misjudged: number;
  missed: number;
  falseTaps: number;
  forbiddenPresses: number;
  missedEscalate: boolean;
};

const pretty = (raw: string) => raw.replace(/_/g, " ");

/** Fisher–Yates 셔플 — 프론트 런타임이므로 Math.random 사용(마운트 시 1회). */
function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ── 다이얼 기하 — 150°에서 시작해 시계방향 240° 스윕(경계 판별이 되게 크게) ── */
const SWEEP_START = 150;
const SWEEP = 240;
const DIAL = { cx: 60, cy: 54, r: 42, face: 50 } as const;
const MINOR_TICK_STEP = 10; // 보조 눈금 간격 — 숫자 없는 기준선. 경계 눈금과 겹치면 생략

function polar(r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [DIAL.cx + r * Math.cos(rad), DIAL.cy + r * Math.sin(rad)];
}

function arcPath(r: number, fromDeg: number, toDeg: number): string {
  const [x1, y1] = polar(r, fromDeg);
  const [x2, y2] = polar(r, toDeg);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

const angleOf = (value: number) =>
  SWEEP_START + (Math.max(0, Math.min(100, value)) / 100) * SWEEP;

/** 눈금판 — 장비 패널풍 페이스 + ok_zone 색 띠 + 경계 눈금(암색 테두리) + 양각 바늘. 숫자 미표시. */
function Dial({ value, zone }: { value: number; zone: [number, number] }) {
  const zoneFrom = angleOf(zone[0]);
  const zoneTo = angleOf(zone[1]);
  const needle = angleOf(value);
  const rad = (needle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const pt = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;
  // 끝이 뾰족한 바늘(폭 있는 몸통 + 반대편 카운터웨이트) — 경계 눈금 대비 판독 정밀도 확보
  const needlePoints = [
    pt(DIAL.cx + (DIAL.r + 3) * cos, DIAL.cy + (DIAL.r + 3) * sin),
    pt(DIAL.cx - sin * 2.6, DIAL.cy + cos * 2.6),
    pt(DIAL.cx - cos * 11, DIAL.cy - sin * 11),
    pt(DIAL.cx + sin * 2.6, DIAL.cy - cos * 2.6),
  ].join(" ");
  const minorTicks: number[] = [];
  for (let v = 0; v <= 100; v += MINOR_TICK_STEP) {
    if (v !== zone[0] && v !== zone[1]) minorTicks.push(angleOf(v));
  }
  return (
    <svg className={styles.dial} viewBox="0 0 120 108" aria-hidden="true">
      <circle className={styles.dialFace} cx={DIAL.cx} cy={DIAL.cy} r={DIAL.face} />
      <circle className={styles.dialBezel} cx={DIAL.cx} cy={DIAL.cy} r={DIAL.face} />
      <path className={styles.dialTrack} d={arcPath(DIAL.r, SWEEP_START, SWEEP_START + SWEEP)} />
      <path className={styles.dialZone} d={arcPath(DIAL.r, zoneFrom, zoneTo)} />
      {minorTicks.map((deg) => {
        const [mx1, my1] = polar(30, deg);
        const [mx2, my2] = polar(35, deg);
        return (
          <line
            key={deg}
            className={styles.minorTick}
            x1={mx1.toFixed(2)}
            y1={my1.toFixed(2)}
            x2={mx2.toFixed(2)}
            y2={my2.toFixed(2)}
          />
        );
      })}
      {[zoneFrom, zoneTo].map((deg) => {
        const [tx1, ty1] = polar(30, deg);
        const [tx2, ty2] = polar(DIAL.face - 1, deg);
        const seg = {
          x1: tx1.toFixed(2),
          y1: ty1.toFixed(2),
          x2: tx2.toFixed(2),
          y2: ty2.toFixed(2),
        };
        return (
          <g key={deg}>
            {/* 암색 halo 위에 흰 눈금 — 초록 띠·빨강 트랙 어느 쪽에서도 경계가 또렷하다(88 vs 91) */}
            <line className={styles.zoneTickHalo} {...seg} />
            <line className={styles.zoneTick} {...seg} />
          </g>
        );
      })}
      <polygon className={styles.needle} points={needlePoints} />
      <circle className={styles.needleHub} cx={DIAL.cx} cy={DIAL.cy} r={6.2} />
      <circle className={styles.needleCap} cx={DIAL.cx} cy={DIAL.cy} r={2.4} />
    </svg>
  );
}

export function GaugeGame({ game, onComplete }: EngineProps) {
  const data = game.data as GaugeData;
  // 표시 순서만 마운트 시 1회 셔플 — 합격/미달이 예측 순서로 오지 않게.
  // 판정·채점은 전부 id·verdict 기준(아래 filter/find/decisions[id])이라 순서와 무관, 정답성 불변.
  const gauges = useMemo(() => shuffle(data.gauges ?? []), [data.gauges]);
  const zone = useMemo<[number, number]>(
    () =>
      Array.isArray(data.ok_zone) && data.ok_zone.length === 2
        ? [Number(data.ok_zone[0]), Number(data.ok_zone[1])]
        : [0, 100],
    [data.ok_zone],
  );

  const scoring = game.scoring ?? {};
  const tapMode =
    "miss_penalty" in scoring || "false_tap_penalty" in scoring || "abnormal_count" in scoring;
  const showForbidden =
    (data.forbidden?.length ?? 0) > 0 && typeof scoring.forbidden_penalty === "number";

  const failGauges = useMemo(() => gauges.filter((g) => g.verdict === "fail"), [gauges]);
  const escalateRequired = scoring.escalate_required === true && failGauges.length > 0;

  // 버튼 라벨은 파일의 action에서 오되 게임 전체 공통 — 게이지별로 다르면 정답이 샌다
  const passAction = gauges.find((g) => g.verdict === "pass" && g.action)?.action ?? "합격";
  const failAction = failGauges.find((g) => g.action)?.action ?? "이상";
  const passLabel = pretty(passAction);
  const failLabel = pretty(failAction);

  const [decisions, setDecisions] = useState<Record<string, "pass" | "fail">>({});
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [forbiddenPressed, setForbiddenPressed] = useState<Record<string, boolean>>({});
  const [escalated, setEscalated] = useState(false);
  const [done, setDone] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const finished = useRef(false);

  const emit = (next: Summary, mistakes: number) => {
    setSummary(next);
    setDone(true);
    onComplete({
      accuracy: next.score,
      time_seconds: elapsedSeconds(startedAt),
      mistakes,
    });
  };

  // 판정 모드 채점 — 파일 scoring 주석이 명세(ys-04: (맞힌 판정/6)*100 − 오판정*15 − 보고생략 15)
  const finishJudgment = (finalDecisions: Record<string, "pass" | "fail">, finalEscalated: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const correct = gauges.filter((g) => finalDecisions[g.id] === g.verdict).length;
    const misjudged = gauges.filter(
      (g) => finalDecisions[g.id] && finalDecisions[g.id] !== g.verdict,
    ).length;
    const escalateUnit = escalateRequired && finalEscalated ? 1 : 0;
    const missedEscalate = escalateRequired && !finalEscalated;
    const forbiddenCount = Object.keys(forbiddenPressed).length;
    const total = scoringOf(
      game,
      "decision_count",
      scoringOf(game, "gauge_count", gauges.length + (escalateRequired ? 1 : 0)),
    );
    const raw =
      ((correct + escalateUnit) / Math.max(1, total)) * 100 -
      misjudged * scoringOf(game, "misjudge_penalty", 0) -
      (missedEscalate
        ? scoringOf(game, "escalate_missed_penalty", scoringOf(game, "missed_escalate_penalty", 15))
        : 0) -
      forbiddenCount * scoringOf(game, "forbidden_penalty", 40);
    emit(
      {
        score: clampScore(raw),
        correct: correct + escalateUnit,
        total,
        misjudged,
        missed: 0,
        falseTaps: 0,
        forbiddenPresses: forbiddenCount,
        missedEscalate,
      },
      misjudged + forbiddenCount + (missedEscalate ? 1 : 0),
    );
  };

  // 순찰 모드 채점 — ys-08: (맞게 처리/9)*100 − 놓침*30 − 오탐*12
  const finishTap = (finalMarks: Record<string, boolean>) => {
    if (finished.current) return;
    finished.current = true;
    const correct = gauges.filter((g) => (g.verdict === "fail") === Boolean(finalMarks[g.id])).length;
    const missed = failGauges.filter((g) => !finalMarks[g.id]).length;
    const falseTaps = gauges.filter((g) => g.verdict === "pass" && finalMarks[g.id]).length;
    const total = scoringOf(game, "gauge_count", gauges.length);
    const raw =
      (correct / Math.max(1, total)) * 100 -
      missed * scoringOf(game, "miss_penalty", 30) -
      falseTaps * scoringOf(game, "false_tap_penalty", 12);
    emit(
      {
        score: clampScore(raw),
        correct,
        total,
        misjudged: 0,
        missed,
        falseTaps,
        forbiddenPresses: 0,
        missedEscalate: false,
      },
      missed + falseTaps,
    );
  };

  const finishNow = () => {
    if (tapMode) finishTap(marks);
    else finishJudgment(decisions, escalated);
  };

  const { remaining, startedAt } = useCountdown(game.time_limit, done, finishNow);

  const judge = (id: string, kind: "pass" | "fail") => {
    if (done || decisions[id]) return;
    const next = { ...decisions, [id]: kind };
    setDecisions(next);
    // 보고 버튼이 없으면 마지막 판정에서 자동 종료 — 있으면 제출로 마감(보고 기회 보장)
    if (!data.escalate && Object.keys(next).length === gauges.length) finishJudgment(next, escalated);
  };

  const tap = (id: string) => {
    if (done || marks[id]) return;
    const next = { ...marks, [id]: true };
    setMarks(next);
    if (failGauges.every((g) => next[g.id])) finishTap(next);
  };

  const pressForbidden = (id: string) => {
    if (done || forbiddenPressed[id]) return;
    setForbiddenPressed((cur) => ({ ...cur, [id]: true }));
  };

  const judgedCount = Object.keys(decisions).length;
  const hitCount = failGauges.filter((g) => marks[g.id]).length;
  const abnormalTotal = scoringOf(game, "abnormal_count", failGauges.length);

  return (
    <div className={`${base.shell} ${styles.gaugeShell}`}>
      <GameHud
        label={tapMode ? "이상 계기" : "계기 판정"}
        count={tapMode ? hitCount : judgedCount}
        total={tapMode ? abnormalTotal : gauges.length}
        remaining={remaining}
        timeLimit={game.time_limit}
      />

      <div className={styles.grid} role="group" aria-label="계기판">
        {gauges.map((g) => {
          const name = g.label ?? pretty(g.id);
          const decision = decisions[g.id];
          const marked = Boolean(marks[g.id]);
          const handled = tapMode
            ? (g.verdict === "fail") === marked
            : decision === g.verdict;
          const verdictShown = done ? (handled ? "ok" : "bad") : undefined;
          return (
            <div
              key={g.id}
              className={styles.card}
              data-judged={tapMode ? marked : Boolean(decision)}
              data-verdict={verdictShown}
              role="group"
              aria-label={`${name} 게이지`}
            >
              {/* 다이얼은 카드 전폭을 써서 6~9개가 좁은 칸에 들어가도 바늘·눈금이 크게 읽힌다.
                  장비 스프라이트(ys-04 공기호흡기_본체 등, 표시 전용·판정 단서 아님)는 라벨 줄로
                  내려 작은 배지로 붙인다. 아트 파일이 없으면 PixelSprite가 라벨 칩으로 폴백한다
                  (ys-06 임시배선 등) — 이때 well은 :has(img) 미충족으로 민무늬가 된다. */}
              <div className={styles.dialRow}>
                <Dial value={Number(g.value)} zone={zone} />
              </div>
              <div className={styles.labelRow}>
                {g.sprite ? (
                  <span className={styles.spriteWell}>
                    <PixelSprite
                      id={g.sprite}
                      label={pretty(g.sprite)}
                      size={26}
                      fallbackClassName={styles.cardSprite}
                    />
                  </span>
                ) : null}
                <span className={styles.cardLabel}>{name}</span>
              </div>

              {tapMode ? (
                marked ? (
                  <span className={styles.decisionChip} data-kind={g.verdict === "fail" ? "fail" : "miss"}>
                    {g.verdict === "fail" ? pretty(g.action ?? "이상 표시") : "오탐"}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={styles.tapButton}
                    disabled={done}
                    onClick={() => tap(g.id)}
                    aria-label={`${name} — 이상 표시`}
                  >
                    이상 표시
                  </button>
                )
              ) : decision ? (
                <span className={styles.decisionChip} data-kind={decision}>
                  {decision === "pass" ? passLabel : failLabel}
                </span>
              ) : (
                <div className={styles.judgeRow}>
                  {/* 버튼 아이콘은 장식 — <action>_아이콘.svg 가 있으면 표시(ys-04 적재칸·재충전대),
                      없으면 label="" 폴백이 빈 span 이라 라벨만 남는다. 정답 단서 아님. */}
                  <button
                    type="button"
                    className={styles.judgeButton}
                    data-kind="pass"
                    disabled={done}
                    onClick={() => judge(g.id, "pass")}
                    aria-label={`${name} — ${passLabel} 판정`}
                  >
                    <PixelSprite id={`${passAction}_아이콘`} label="" size={18} />
                    {passLabel}
                  </button>
                  <button
                    type="button"
                    className={styles.judgeButton}
                    data-kind="fail"
                    disabled={done}
                    onClick={() => judge(g.id, "fail")}
                    aria-label={`${name} — ${failLabel} 판정`}
                  >
                    <PixelSprite id={`${failAction}_아이콘`} label="" size={18} />
                    {failLabel}
                  </button>
                </div>
              )}

              {verdictShown ? (
                <span className={styles.cardMark} data-ok={verdictShown === "ok"} aria-hidden="true">
                  {verdictShown === "ok" ? "✓" : "✕"}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {showForbidden ? (
        <div className={styles.toolRow} role="group" aria-label="현장 조치">
          {(data.forbidden ?? []).map((f) => {
            const pressed = Boolean(forbiddenPressed[f.id]);
            return (
              <div key={f.id} className={styles.tool}>
                <button
                  type="button"
                  className={styles.toolButton}
                  data-pressed={pressed}
                  disabled={done || pressed}
                  onClick={() => pressForbidden(f.id)}
                >
                  {pretty(f.id)}
                </button>
                {pressed && f.reason ? (
                  <span className={styles.toolReason} role="status">
                    {f.reason}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {!done ? (
        <div className={styles.footer}>
          {data.escalate ? (
            <button
              type="button"
              className={styles.escalateButton}
              data-on={escalated}
              aria-pressed={escalated}
              onClick={() => setEscalated((v) => !v)}
            >
              {data.escalate.sprite ? (
                <PixelSprite id={data.escalate.sprite} label="" size={20} />
              ) : null}
              {escalated ? `${data.escalate.label ?? "보고"} 완료` : data.escalate.label ?? "보고"}
            </button>
          ) : null}
          <button type="button" className={styles.submitButton} onClick={finishNow}>
            점검 완료 제출
          </button>
        </div>
      ) : null}

      {done && summary ? (
        <ResultBar score={summary.score}>
          판정{" "}
          <b>
            {summary.correct}/{summary.total}
          </b>
          {summary.misjudged > 0 ? (
            <>
              {" · "}오판정 <b>{summary.misjudged}건</b>
            </>
          ) : null}
          {summary.missed > 0 ? (
            <>
              {" · "}이상 계기 놓침 <b>{summary.missed}건</b>
            </>
          ) : null}
          {summary.falseTaps > 0 ? (
            <>
              {" · "}오탐 <b>{summary.falseTaps}건</b>
            </>
          ) : null}
          {summary.forbiddenPresses > 0 ? (
            <>
              {" · "}금지행동 <b>{summary.forbiddenPresses}건</b>
            </>
          ) : null}
          {summary.missedEscalate ? (
            <>
              {" · "}보고 <b>누락</b>
            </>
          ) : null}
        </ResultBar>
      ) : null}
    </div>
  );
}
