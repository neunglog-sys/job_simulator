import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import shared from "../../../styles/minigame.module.css";
import styles from "../../../styles/traceGame.module.css";
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
 * trace 엔진 — 가이드 경로(진행도 0~1)를 드래그/터치로 따라 긋는다(ms-08·ms-09).
 *
 * 진행·판정은 시각(타임스탬프) 기준이다: interrupt 의 '멈춰서 hold초 유지'는
 * 벽시계로 재고, rAF 누적에 기대지 않으므로 백그라운드 탭에서도 틀어지지 않는다
 * (PourGame 규약). 경로는 SVG 곡선을 등간격 길이로 표본화해 쓴다.
 *
 * 채점은 파일 scoring 이 명세: off_track(공차 이탈 구간당)·spark·no_go·interrupt_miss·
 * skip_penalty·incomplete. 한 이탈 구간엔 가장 무거운 감점 하나만 붙인다(중첩 금지).
 * terminal_stop 재개·emergency 무시·정밀구간 전면이탈은 즉시 실패.
 *
 * 도트 아트(표시 전용 — 채점·판정 계약과 무관, ms-09):
 *   - data.guide 와 같은 이름의 스프라이트가 있으면 배경 스킨(금속 판재)으로 깔린다.
 *     파일이 없으면 조용히 빠져 기존 그라데이션 배경 그대로다(ms-08 폴백 규약).
 *   - data.head 가 있으면 드래그 지점을 절삭 헤드 스프라이트가 따라다니고,
 *     stage 가 아트 모드(data-art)로 전환돼 밴드·경로 대비만 살짝 올라간다.
 *   - emergency.signal·data.spark_sprite 도 같은 이름의 파일이 있으면 도트로 그려지고,
 *     없으면 기존 라벨 칩·원광 플래시로 폴백한다.
 *   - emergency 잠금 중엔 하단 footer 가 전용 경보 슬롯(신호 아이콘+대형 보고 버튼)으로
 *     바뀐다 — 표시 전용이며 report() 판정·채점은 그대로다. emergency 가 없는 게임
 *     (ms-08)은 기존 footerRow 렌더만 탄다(디자이너 피드백: 보고 버튼 시인성).
 */

type TraceBand = { from?: number; to?: number; tolerance?: number; color?: string };

type TraceData = {
  guide?: string;
  tolerance?: number;
  bands?: TraceBand[];
  start_gate?: { action?: string; reason?: string; skip_penalty?: number };
  interrupts?: Array<{ at?: number; reason?: string; hold?: number }>;
  terminal_stop?: { at?: number; reason?: string };
  emergency?: { at?: number; signal?: string; action?: string; resume_after_report?: boolean };
  sparks?: Array<{ at?: number; reason?: string }>;
  no_go?: Array<{ from?: number; to?: number; reason?: string; offset?: number }>;
  /** 표시 전용 — 드래그 지점을 따라다니는 절삭 헤드 스프라이트 id(있으면 아트 모드) */
  head?: string;
  /** 표시 전용 — 스파크 플래시에 겹쳐 그리는 스프라이트 id */
  spark_sprite?: string;
};

type FailEntry = { when: string; reason: string };

type Pt = { x: number; y: number };

type GateKind = "interrupt" | "emergency" | "terminal";

type Gate = {
  kind: GateKind;
  at: number;
  hold: number; // interrupt 만 사용
  reason: string;
  index: number; // interrupts 배열 인덱스 (그 외 -1)
};

const VIEW_W = 960;
const VIEW_H = 440;
/** 경로 표본 개수 — 판정·렌더 공용 */
const SAMPLES = 480;
/** 공차 밖이어도 이 여유까지는 전진을 허용(대신 이탈 구간으로 감점) */
const OFF_MARGIN = 14;
/** 잠금 중 이만큼 끌면 '멈추지 않은 것'으로 판정(px, viewBox 기준) */
const LOCK_DRAG_LIMIT = 55;
/** 기본 가이드 곡선 — 직선→곡선→정밀 곡선→마무리 직선(밴드 구간과 호흡이 맞는 S자) */
const GUIDE_D =
  "M 70 350 C 210 300 260 160 400 140 C 500 126 540 210 600 250 C 660 290 730 300 800 250 C 850 214 880 160 895 110";

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** scoring.fail 항목을 토큰 포함으로 찾는다 — 없으면 폴백 문구. */
function failReasonOf(fails: FailEntry[], token: string, fallback: string): string {
  return fails.find((f) => f.when.includes(token))?.reason ?? fallback;
}

/** 신호 라벨 — 'xx — 설명' 형태에서 상황 부분만 잘라 정답을 유출하지 않는다. */
function situationOf(text: string | undefined): string {
  if (!text) return "";
  return text.split("—")[0].replace(/_/g, " ").trim();
}

export function TraceGame({ game, onComplete }: EngineProps) {
  const data = game.data as TraceData;
  // 표시 전용 스프라이트 id — 전부 없으면(ms-08) 기존 렌더와 동일하게 동작한다
  const headSprite = typeof data.head === "string" ? data.head : undefined;
  const sparkSprite = typeof data.spark_sprite === "string" ? data.spark_sprite : undefined;
  const guideSkin = typeof data.guide === "string" ? data.guide : undefined;
  const emergencySignal = typeof data.emergency?.signal === "string" ? data.emergency.signal : undefined;
  const bands = useMemo(() => data.bands ?? [], [data.bands]);
  const interrupts = useMemo(() => data.interrupts ?? [], [data.interrupts]);
  const sparks = useMemo(() => data.sparks ?? [], [data.sparks]);
  const noGoRanges = useMemo(() => data.no_go ?? [], [data.no_go]);
  const fails = useMemo<FailEntry[]>(() => {
    const raw = game.scoring?.fail;
    return Array.isArray(raw)
      ? (raw as Array<{ when?: unknown; reason?: unknown }>)
          .map((f) => ({ when: String(f.when ?? ""), reason: String(f.reason ?? "") }))
          .filter((f) => f.when)
      : [];
  }, [game.scoring]);

  /** 진행도 순 게이트 목록 — interrupt(멈췄다 재개) → emergency(보고) → terminal(종료) */
  const gates = useMemo<Gate[]>(() => {
    const list: Gate[] = interrupts.map((it, index) => ({
      kind: "interrupt",
      at: it.at ?? 0,
      hold: it.hold ?? 0.6,
      reason: it.reason ?? "잠깐 멈추세요",
      index,
    }));
    if (data.emergency && typeof data.emergency.at === "number") {
      // signal 은 스프라이트 id 를 겸한다(ms-09 균열라인_연기_아이콘) — 표시할 땐 '아이콘' 접미사만 벗긴다
      const signalLabel = situationOf(data.emergency.signal?.replace(/_?아이콘$/, ""));
      list.push({ kind: "emergency", at: data.emergency.at, hold: 0, reason: signalLabel || "돌발 신호", index: -1 });
    }
    if (data.terminal_stop && typeof data.terminal_stop.at === "number") {
      list.push({ kind: "terminal", at: data.terminal_stop.at, hold: 0, reason: situationOf(data.terminal_stop.reason) || "즉시 중단", index: -1 });
    }
    return list.sort((a, b) => a.at - b.at);
  }, [interrupts, data.emergency, data.terminal_stop]);

  const toleranceAt = useCallback(
    (t: number) => {
      const band = bands.find((b) => t >= (b.from ?? 0) && t < (b.to ?? 1));
      const fallback = typeof data.tolerance === "number" ? data.tolerance : 8;
      return typeof band?.tolerance === "number" ? band.tolerance : fallback;
    },
    [bands, data.tolerance],
  );

  // 경로 표본 — 마운트 후 getTotalLength/getPointAtLength 로 등간격 표본화
  const pathRef = useRef<SVGPathElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [pts, setPts] = useState<Pt[]>([]);
  useEffect(() => {
    const el = pathRef.current;
    if (!el) return;
    const total = el.getTotalLength();
    const sampled: Pt[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      const p = el.getPointAtLength((total * i) / (SAMPLES - 1));
      sampled.push({ x: p.x, y: p.y });
    }
    setPts(sampled);
  }, []);

  /** 표본 인덱스의 경로 법선 — no_go 평행선(옛 절삭선) 좌표용 */
  const normalAt = useCallback(
    (i: number): Pt => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      if (!a || !b) return { x: 0, y: 0 };
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: -dy / len, y: dx / len };
    },
    [pts],
  );

  const noGoPts = useMemo(() => {
    if (pts.length === 0) return [] as Array<{ range: number; points: Pt[]; stamps: Pt[] }>;
    return noGoRanges.map((range, rIdx) => {
      const from = Math.floor((range.from ?? 0) * (SAMPLES - 1));
      const to = Math.ceil((range.to ?? 1) * (SAMPLES - 1));
      const offset = range.offset ?? 12;
      const points: Pt[] = [];
      for (let i = from; i <= to && i < pts.length; i += 1) {
        const n = normalAt(i);
        points.push({ x: pts[i].x + n.x * offset, y: pts[i].y + n.y * offset });
      }
      // 취소 스탬프(X) 자리 — 옛 선이 함정임을 글자 없이 모양으로 알린다(표시 전용)
      const stamps = [0.2, 0.5, 0.8]
        .map((f) => points[Math.floor(f * (points.length - 1))])
        .filter((p): p is Pt => Boolean(p));
      return { range: rIdx, points, stamps };
    });
  }, [pts, noGoRanges, normalAt]);

  // ── 판정 상태(refs — 포인터 이벤트에서 직접 갱신) ──
  const st = useRef({
    pi: 0, // 현재 표본 인덱스
    drawing: false,
    lastPointer: null as Pt | null,
    // 이탈 구간(episode) — 한 구간엔 가장 무거운 감점 하나만
    episodeOpen: false,
    episodeKind: "off" as "off" | "spark" | "no_go",
    counts: { off: 0, spark: 0, no_go: 0, interruptMiss: 0 },
    // 게이트
    gateStatus: [] as Array<"pending" | "active" | "done">,
    activeGate: -1,
    activatedAt: 0,
    lastMoveAt: 0,
    attempt: 0,
    pausedAtGate: false,
    // 시작 게이트·정밀 구간
    gateSkipped: false,
    precision: { samples: 0, clean: 0, done: false },
  });
  if (st.current.gateStatus.length !== gates.length) {
    st.current.gateStatus = gates.map(() => "pending");
  }

  const doneRef = useRef(false);
  const [done, setDone] = useState(false);
  const [failReason, setFailReason] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [progress, setProgress] = useState(0);
  const [offNow, setOffNow] = useState(false);
  const [startGateOpen, setStartGateOpen] = useState(Boolean(data.start_gate));
  const [lockView, setLockView] = useState<{ kind: GateKind; reason: string; holdPct: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sparkFlash, setSparkFlash] = useState<{ x: number; y: number; key: number } | null>(null);
  /** 절삭 헤드 커서 위치(viewBox 좌표) — head 스프라이트가 있을 때만 갱신(표시 전용) */
  const [pointerPos, setPointerPos] = useState<Pt | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const closeEpisode = useCallback(() => {
    const s = st.current;
    if (!s.episodeOpen) return;
    s.episodeOpen = false;
    s.counts[s.episodeKind] += 1;
  }, []);

  const finishScore = useCallback(
    (startedAtRef: { current: number }, expired: boolean) => {
      if (doneRef.current) return;
      doneRef.current = true;
      closeEpisode();
      const s = st.current;
      const completeAt = scoringOf(game, "complete_at", 1);
      const reached = Math.min(s.pi / (SAMPLES - 1), completeAt);
      const base = completeAt > 0 ? (reached / completeAt) * 100 : 0;
      const skipPenalty = s.gateSkipped ? data.start_gate?.skip_penalty ?? 25 : 0;
      const incomplete =
        expired && s.pi / (SAMPLES - 1) < completeAt ? scoringOf(game, "incomplete_penalty", 0) : 0;
      const accuracy = clampScore(
        base -
          s.counts.off * scoringOf(game, "off_track_penalty", 10) -
          s.counts.spark * scoringOf(game, "spark_penalty", 15) -
          s.counts.no_go * scoringOf(game, "no_go_penalty", 20) -
          s.counts.interruptMiss * scoringOf(game, "interrupt_miss_penalty", 15) -
          skipPenalty -
          incomplete,
      );
      setScore(accuracy);
      setDone(true);
      onComplete({
        accuracy,
        time_seconds: elapsedSeconds(startedAtRef),
        mistakes:
          s.counts.off + s.counts.spark + s.counts.no_go + s.counts.interruptMiss + (s.gateSkipped ? 1 : 0),
      });
    },
    [game, data.start_gate, closeEpisode, onComplete],
  );

  const { remaining, startedAt } = useCountdown(game.time_limit, done, () => finishScore(startedAt, true));

  const fail = useCallback(
    (reason: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      const s = st.current;
      setFailReason(reason);
      setDone(true);
      onComplete(
        failResult(
          startedAt,
          s.counts.off + s.counts.spark + s.counts.no_go + s.counts.interruptMiss + 1,
        ),
      );
    },
    [onComplete, startedAt],
  );

  /** 게이트 활성화 — 진행을 게이트 지점에 고정하고 멈춤 판정을 시작한다. */
  const activateGate = useCallback((gateIdx: number) => {
    const s = st.current;
    s.gateStatus[gateIdx] = "active";
    s.activeGate = gateIdx;
    s.activatedAt = Date.now();
    s.lastMoveAt = Date.now();
    s.attempt = 0;
    s.pausedAtGate = false;
  }, []);

  const releaseGate = useCallback(() => {
    const s = st.current;
    if (s.activeGate >= 0) s.gateStatus[s.activeGate] = "done";
    s.activeGate = -1;
    setLockView(null);
  }, []);

  /** 잠금 중 드래그 — 계속 끌면 '멈추지 않음' 판정(감점 또는 즉시 실패). */
  const dragWhileLocked = useCallback(
    (moved: number) => {
      const s = st.current;
      const gate = gates[s.activeGate];
      if (!gate) return;
      if (moved > 4) s.lastMoveAt = Date.now();
      if (Date.now() - Math.max(s.activatedAt, s.lastMoveAt) > 1000) s.pausedAtGate = true;
      s.attempt += moved;
      if (s.attempt <= LOCK_DRAG_LIMIT) return;
      if (gate.kind === "interrupt") {
        s.counts.interruptMiss += 1; // 멈춰야 할 지점에서 안 멈춤 — 감점 후 재개
        showToast("멈추지 않고 계속 그었습니다 (감점)");
        releaseGate();
        return;
      }
      if (gate.kind === "emergency") {
        fail(failReasonOf(fails, "무시", "돌발 신호를 무시하고 계속 진행했습니다"));
        return;
      }
      // terminal — 멈추지 않으면 강행, 멈췄다가 다시 그으면 재개(둘 다 즉시 실패)
      if (s.pausedAtGate) fail(failReasonOf(fails, "재개", "중단 지점에서 다시 그어 완성을 강행했습니다"));
      else fail(failReasonOf(fails, "강행", "중단 지점을 멈추지 않고 지나갔습니다"));
    },
    [gates, fails, fail, releaseGate, showToast],
  );

  /** 정밀 구간(공차 최소 밴드) 추적 — 전 구간을 밴드 밖으로만 지나면 즉시 실패. */
  const trackPrecision = useCallback(
    (t: number, clean: boolean) => {
      const s = st.current;
      const band = bands.reduce<TraceBand | null>(
        (min, b) => (typeof b.tolerance === "number" && (!min || b.tolerance < (min.tolerance ?? Infinity)) ? b : min),
        null,
      );
      if (!band || s.precision.done) return;
      const from = band.from ?? 0;
      const to = band.to ?? 1;
      if (t >= from && t < to) {
        s.precision.samples += 1;
        if (clean) s.precision.clean += 1;
        return;
      }
      if (t >= to && s.precision.samples >= 6) {
        s.precision.done = true;
        if (s.precision.clean === 0) {
          fail(failReasonOf(fails, "전면이탈", "정밀 구간을 공차 밖으로 완전히 이탈했습니다"));
        }
      }
    },
    [bands, fails, fail],
  );

  const penaltyOf = useCallback(
    (kind: "off" | "spark" | "no_go") =>
      kind === "no_go"
        ? scoringOf(game, "no_go_penalty", 20)
        : kind === "spark"
          ? scoringOf(game, "spark_penalty", 15)
          : scoringOf(game, "off_track_penalty", 10),
    [game],
  );

  /** 포인터 → viewBox 좌표 */
  const toView = useCallback((event: ReactPointerEvent): Pt => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - rect.left) * VIEW_W) / rect.width,
      y: ((event.clientY - rect.top) * VIEW_H) / rect.height,
    };
  }, []);

  /** 전진 판정 — 현재 표본 주변에서 가장 가까운 표본을 찾아 공차와 비교한다. */
  const advance = useCallback(
    (p: Pt) => {
      const s = st.current;
      if (pts.length === 0) return;
      const from = Math.max(0, s.pi - 6);
      const to = Math.min(pts.length - 1, s.pi + 70);
      let bestJ = s.pi;
      let bestD = Number.POSITIVE_INFINITY;
      for (let j = from; j <= to; j += 1) {
        const d = dist(p, pts[j]);
        if (d < bestD) {
          bestD = d;
          bestJ = j;
        }
      }
      const t = bestJ / (SAMPLES - 1);
      const tol = toleranceAt(t);
      const clean = bestD <= tol;

      // 옛 경로(no_go) 추종 — 본선보다 옛 선에 더 붙어 있으면 no_go 구간
      let nearNoGo = false;
      for (const ng of noGoPts) {
        for (const q of ng.points) {
          if (dist(p, q) < Math.min(bestD, 8)) {
            nearNoGo = true;
            break;
          }
        }
        if (nearNoGo) break;
      }

      if (bestD <= tol + OFF_MARGIN) {
        let target = bestJ;
        const gi = gates.findIndex(
          (g, idx) => s.gateStatus[idx] === "pending" && Math.floor(g.at * (SAMPLES - 1)) <= target,
        );
        if (gi >= 0) {
          target = Math.floor(gates[gi].at * (SAMPLES - 1));
          activateGate(gi);
        }
        if (target > s.pi) s.pi = target;
      }

      // 이탈 구간(episode) — 열릴 때 분류하고, 더 무거운 쪽이 나오면 승격(한 구간 한 감점)
      if (!clean && bestD <= tol + 90) {
        const kind: "off" | "spark" | "no_go" = sparks.some((sp) => Math.abs(t - (sp.at ?? -1)) <= 0.04)
          ? "spark"
          : nearNoGo
            ? "no_go"
            : "off";
        if (!s.episodeOpen) {
          s.episodeOpen = true;
          s.episodeKind = kind;
          if (kind === "spark") setSparkFlash({ x: p.x, y: p.y, key: Date.now() });
        } else if (penaltyOf(kind) > penaltyOf(s.episodeKind)) {
          s.episodeKind = kind;
          if (kind === "spark") setSparkFlash({ x: p.x, y: p.y, key: Date.now() });
        }
      } else if (clean) {
        closeEpisode();
      }

      trackPrecision(t, clean);

      if (s.pi >= SAMPLES - 3 && s.gateStatus.every((g) => g !== "active")) {
        finishScore(startedAt, false);
        return;
      }
      setProgress(s.pi / (SAMPLES - 1));
      setOffNow(!clean);
    },
    [pts, toleranceAt, noGoPts, gates, sparks, penaltyOf, activateGate, closeEpisode, trackPrecision, finishScore, startedAt],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      if (doneRef.current || pts.length === 0) return;
      const s = st.current;
      if (startGateOpen) {
        // 확인 카드 없이 첫 획 — skip_penalty (1회)
        s.gateSkipped = true;
        setStartGateOpen(false);
        showToast("확인 없이 시작했습니다 (감점)");
      }
      const p = toView(event);
      if (headSprite) setPointerPos(p); // 터치 시작에도 헤드가 바로 붙는다(표시 전용)
      if (s.activeGate < 0 && dist(p, pts[s.pi]) > toleranceAt(s.pi / (SAMPLES - 1)) + 30) return;
      s.drawing = true;
      s.lastPointer = p;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [pts, startGateOpen, toView, toleranceAt, showToast, headSprite],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      const s = st.current;
      if (doneRef.current) return;
      const p = toView(event);
      if (headSprite) setPointerPos(p); // 마우스 호버에도 헤드가 따라다닌다(판정 무관)
      if (!s.drawing) return;
      const moved = s.lastPointer ? dist(p, s.lastPointer) : 0;
      s.lastPointer = p;
      if (s.activeGate >= 0) {
        dragWhileLocked(moved);
        return;
      }
      advance(p);
    },
    [toView, dragWhileLocked, advance, headSprite],
  );

  const onPointerUp = useCallback(() => {
    st.current.drawing = false;
    st.current.lastPointer = null;
  }, []);

  /** 스테이지 이탈 — 획을 끊고 헤드 커서도 감춘다. */
  const onPointerLeave = useCallback(() => {
    st.current.drawing = false;
    st.current.lastPointer = null;
    setPointerPos(null);
  }, []);

  // 게이트 멈춤 판정 티커 — 정지 시간은 타임스탬프로 잰다(백그라운드 안전)
  useEffect(() => {
    if (done) return;
    const timer = window.setInterval(() => {
      const s = st.current;
      if (s.activeGate < 0) {
        setLockView(null);
        return;
      }
      const gate = gates[s.activeGate];
      if (!gate) return;
      const stillFor = (Date.now() - Math.max(s.activatedAt, s.lastMoveAt)) / 1000;
      if (stillFor > 1) s.pausedAtGate = true;
      if (gate.kind === "interrupt") {
        if (stillFor >= gate.hold) {
          releaseGate();
          showToast("좋습니다 — 이어서 그으세요");
          return;
        }
        setLockView({ kind: gate.kind, reason: gate.reason, holdPct: Math.min(1, stillFor / gate.hold) });
        return;
      }
      setLockView({ kind: gate.kind, reason: gate.reason, holdPct: 0 });
    }, 120);
    return () => window.clearInterval(timer);
  }, [done, gates, releaseGate, showToast]);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  /** emergency 보고 버튼 — 정답 행동. 보고 후 재개(resume_after_report). */
  const report = useCallback(() => {
    const s = st.current;
    const gate = gates[s.activeGate];
    if (!gate || gate.kind !== "emergency" || doneRef.current) return;
    releaseGate();
    if (data.emergency?.resume_after_report === false) {
      finishScore(startedAt, false);
      return;
    }
    showToast("보고 완료 — 재개 지시를 받았습니다. 이어서 그으세요");
  }, [gates, releaseGate, data.emergency, finishScore, startedAt, showToast]);

  /** terminal_stop 종료 버튼 — 여기서 멈추고 끝내는 것이 정답(완주 인정). */
  const terminate = useCallback(() => {
    const s = st.current;
    const gate = gates[s.activeGate];
    if (!gate || gate.kind !== "terminal" || doneRef.current) return;
    releaseGate();
    finishScore(startedAt, false);
  }, [gates, releaseGate, finishScore, startedAt]);

  const idx = Math.min(SAMPLES - 1, Math.round(progress * (SAMPLES - 1)));
  const drawnPoints = useMemo(
    () => pts.slice(0, idx + 1).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "),
    [pts, idx],
  );
  const bandsToRender = bands.length > 0 ? bands : [{ from: 0, to: 1, tolerance: data.tolerance ?? 8, color: "초록" }];
  const markerPos = (at: number): Pt => pts[Math.min(SAMPLES - 1, Math.floor(at * (SAMPLES - 1)))] ?? { x: 0, y: 0 };
  const emergencyActionLabel = (data.emergency?.action ?? "작업중지_보고").replace(/_/g, " ").replace(/버튼$/, "").trim();

  return (
    <div className={shared.shell}>
      <GameHud label="진행" count={Math.round(progress * 100)} total={100} remaining={remaining} timeLimit={game.time_limit} />

      <div className={styles.stage} data-art={headSprite ? "true" : undefined}>
        {guideSkin ? (
          // 배경 스킨(도트 판재) — guide 와 같은 이름의 스프라이트가 있으면 깔린다.
          // 파일이 없으면 조용히 빠져 기존 그라데이션 배경 그대로다(ms-08 폴백).
          <div className={styles.bgLayer} aria-hidden="true">
            <PixelSprite id={guideSkin} label="" size={VIEW_W} fallbackClassName={styles.spriteHidden} />
          </div>
        ) : null}
        <svg
          ref={svgRef}
          className={styles.svg}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="application"
          aria-label="가이드 경로를 드래그로 따라 긋는 화면"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerLeave}
        >
          {pts.length > 0
            ? bandsToRender.map((band, i) => {
                const from = Math.floor((band.from ?? 0) * (SAMPLES - 1));
                const to = Math.ceil((band.to ?? 1) * (SAMPLES - 1));
                const seg = pts.slice(from, to + 1).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
                return (
                  <polyline
                    key={i}
                    className={styles.band}
                    data-color={band.color}
                    strokeWidth={(band.tolerance ?? 8) * 2}
                    points={seg}
                  />
                );
              })
            : null}
          {noGoPts.map((ng) => (
            <polyline
              key={ng.range}
              className={styles.noGo}
              points={ng.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
            />
          ))}
          {/* 옛 선 위 취소 스탬프(X) — '따라가지 말 것'을 글자 없이 모양으로 */}
          {noGoPts.map((ng) =>
            ng.stamps.map((p, i) => (
              <g key={`ng-stamp-${ng.range}-${i}`} className={styles.noGoStamp} aria-hidden="true">
                <line x1={p.x - 4} y1={p.y - 4} x2={p.x + 4} y2={p.y + 4} />
                <line x1={p.x - 4} y1={p.y + 4} x2={p.x + 4} y2={p.y - 4} />
              </g>
            )),
          )}
          <path ref={pathRef} className={styles.guide} d={GUIDE_D} />
          {drawnPoints ? <polyline className={styles.drawn} data-off={offNow} points={drawnPoints} /> : null}
          {pts.length > 0 && progress < 0.01 ? <circle className={styles.startDot} cx={pts[0].x} cy={pts[0].y} r={8} /> : null}
          {pts.length > 0 ? (
            <circle className={styles.cursor} data-locked={lockView !== null} cx={pts[idx]?.x ?? 0} cy={pts[idx]?.y ?? 0} r={7} />
          ) : null}
        </svg>

        {/* 경로 위 신호 마커 — 활성 게이트만 노출(사전 유출 방지).
            emergency 는 signal 과 같은 이름의 스프라이트가 있으면 도트 아이콘으로,
            없으면 지금처럼 라벨 칩으로 나온다(균열라인_연기_아이콘 — ms-09). */}
        {pts.length > 0
          ? gates.map((gate, i) => {
              const status = st.current.gateStatus[i];
              if (status === "pending") return null;
              const pos = markerPos(gate.at);
              const spriteMode = gate.kind === "emergency" && emergencySignal !== undefined;
              return (
                <span
                  key={`${gate.kind}-${i}`}
                  className={styles.marker}
                  data-kind={status === "done" ? "done" : gate.kind === "interrupt" ? undefined : "danger"}
                  data-sprite={spriteMode ? "true" : undefined}
                  // 활성 emergency 만 하단 경보 슬롯의 아이콘과 같은 리듬으로 깜빡인다
                  // (표시 전용) — interrupt·terminal(ms-08)에는 붙지 않는다.
                  data-alert={status === "active" && gate.kind === "emergency" ? "true" : undefined}
                  style={{ left: `${(pos.x / VIEW_W) * 100}%`, top: `${(pos.y / VIEW_H) * 100}%` }}
                >
                  {spriteMode ? (
                    <PixelSprite
                      id={emergencySignal ?? ""}
                      label={situationOf(gate.reason)}
                      size={44}
                      fallbackClassName={styles.markerFallback}
                    />
                  ) : (
                    situationOf(gate.reason)
                  )}
                </span>
              );
            })
          : null}

        {/* 절삭 헤드 커서 — 드래그/호버 지점을 따라다닌다(head 스프라이트가 있을 때만) */}
        {headSprite && pointerPos && !done ? (
          <span
            className={styles.headCursor}
            style={{ left: `${(pointerPos.x / VIEW_W) * 100}%`, top: `${(pointerPos.y / VIEW_H) * 100}%` }}
            aria-hidden="true"
          >
            <PixelSprite id={headSprite} label="" size={36} fallbackClassName={styles.spriteHidden} />
          </span>
        ) : null}

        {sparkFlash ? (
          <span
            key={sparkFlash.key}
            className={styles.spark}
            style={{ left: `${(sparkFlash.x / VIEW_W) * 100}%`, top: `${(sparkFlash.y / VIEW_H) * 100}%` }}
            aria-hidden="true"
          >
            {sparkSprite ? (
              // 도트 스파크 — 원광(배경) 위에 겹친다. 파일이 없으면 원광만 남는다.
              <PixelSprite id={sparkSprite} label="" size={28} fallbackClassName={styles.spriteHidden} />
            ) : null}
          </span>
        ) : null}

        {lockView && lockView.kind === "interrupt" ? (
          <span className={styles.holdBadge} role="status">
            멈추세요 — {situationOf(lockView.reason)}
            <span className={styles.holdTrack} aria-hidden="true">
              <span className={styles.holdValue} style={{ width: `${lockView.holdPct * 100}%` }} />
            </span>
          </span>
        ) : null}
        {lockView && lockView.kind !== "interrupt" ? (
          <span className={styles.holdBadge} data-kind="danger" role="alert">
            {situationOf(lockView.reason)} — 아래 버튼으로 대응하세요
          </span>
        ) : null}

        {startGateOpen && data.start_gate ? (
          <div className={styles.gateOverlay} style={{ pointerEvents: "none" }}>
            <p className={styles.gateText}>{data.start_gate.reason ?? "시작 전 확인이 필요합니다"}</p>
            <button
              type="button"
              className={styles.actionButton}
              style={{ pointerEvents: "auto" }}
              onClick={() => setStartGateOpen(false)}
            >
              {(data.start_gate.action ?? "확인").replace(/_/g, " ").replace(/탭$/, "").trim() || "확인"}
            </button>
            <span className={styles.gateHint}>확인 없이 바로 그으면 감점됩니다</span>
          </div>
        ) : null}
      </div>

      {!done ? (
        lockView?.kind === "emergency" ? (
          /* emergency 전용 고정 경보 슬롯 — footer 자리를 통째로 써서 스테이지(경로)를
             가리지 않는다. 경로 위 마커와 같은 신호 스프라이트(균열·연기)를 대형 보고
             버튼 옆에 함께 그려 시각적으로 잇는다. 표시 전용 — report() 판정·채점 불변,
             emergency 가 없는 게임(ms-08)은 아래 기존 footerRow 분기만 탄다. */
          <div className={styles.emergencyDock}>
            <span className={styles.emergencySignal} aria-hidden="true">
              {emergencySignal ? (
                <PixelSprite id={emergencySignal} label="" size={44} fallbackClassName={styles.emergencyFallback} />
              ) : (
                <span className={styles.emergencyFallback} />
              )}
            </span>
            <span className={styles.emergencyText}>
              {situationOf(lockView.reason) || "돌발 신호"}
              <small>즉시 멈추고 버튼으로 보고하세요</small>
            </span>
            <button type="button" className={styles.actionButton} data-variant="emergency" onClick={report} aria-label="작업 중지하고 보고">
              {emergencyActionLabel || "작업중지 보고"}
            </button>
          </div>
        ) : (
          <div className={styles.footerRow}>
            <span className={styles.hintText}>초록 점에서 시작해 점선 경로를 따라 드래그하세요</span>
            {lockView?.kind === "terminal" ? (
              <button type="button" className={styles.actionButton} data-variant="alert" onClick={terminate} aria-label="여기서 중단하고 종료">
                여기서 종료
              </button>
            ) : null}
          </div>
        )
      ) : null}

      {toast ? <span className={styles.hintText} role="status" style={{ textAlign: "center" }}>{toast}</span> : null}

      {done ? (
        <ResultBar score={score} failReason={failReason}>
          진행 <b>{Math.round(progress * 100)}%</b>
          {st.current.counts.off > 0 ? (
            <>
              {" · "}공차 이탈 <b>{st.current.counts.off}회</b>
            </>
          ) : null}
          {st.current.counts.spark > 0 ? (
            <>
              {" · "}스파크 <b>{st.current.counts.spark}회</b>
            </>
          ) : null}
          {st.current.counts.no_go > 0 ? (
            <>
              {" · "}옛 경로 추종 <b>{st.current.counts.no_go}회</b>
            </>
          ) : null}
          {st.current.counts.interruptMiss > 0 ? (
            <>
              {" · "}멈춤 누락 <b>{st.current.counts.interruptMiss}회</b>
            </>
          ) : null}
          {st.current.gateSkipped ? (
            <>
              {" · "}시작 확인 <b>생략</b>
            </>
          ) : null}
        </ResultBar>
      ) : null}
    </div>
  );
}
