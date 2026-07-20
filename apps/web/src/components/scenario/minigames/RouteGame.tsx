import { useMemo, useRef, useState, type MouseEvent } from "react";
import shared from "../../../styles/minigame.module.css";
import styles from "../../../styles/routeGame.module.css";
import { SCENE } from "./types";
import {
  clampScore,
  elapsedSeconds,
  GameHud,
  ResultBar,
  scoringOf,
  useCountdown,
  type EngineProps,
} from "./shared";

/**
 * route 엔진 — 출발→경유→도착 폴리라인을 그린다. jm-01·jm-04·stn-02·yg-04 4종.
 *
 * 조작: 노드를 클릭하면 그 노드로 선이 이어지고, 빈 곳을 클릭하면 자유 경유점이
 * 생겨 선을 꺾을 수 있다(위험구역을 피해 돌아가려면 필요 — jm-01 보호구역은
 * 직선 노드 연결로는 피할 수 없다). '되돌리기'로 마지막 점을 지운다.
 *
 * 회피구역(avoid)은 사전에 그리지 않는다 — 선분이 원을 스치는 순간 구역이
 * 드러나고 reason 이 표시된다(사전 유출 금지 — stn-02 "미리 붉게 칠하지 않는다").
 * 채점은 '제출한 최종 경로' 기준이다. 네 시나리오 모두 결과물이 계획·설계·수정안
 * (노선 계획, 항로 수정안, 동선 설계, 위치 보고)이므로 스치고 되돌린 흔적이 아니라
 * 제출안이 위험구역을 지나는지를 본다. 시행착오의 비용은 제한시간이 진다.
 *
 * 좌표가 없는 노드(jm-04·yg-04)는 자동 배치한다: 정답 경유지는 위쪽 호(arc)에,
 * decoy 는 출발→도착 직선 위에, 좌표 없는 avoid 구역도 같은 직선 위에 깔린다.
 * 그래서 decoy 를 경로에 넣으면 그 선분이 구역을 관통해 자연 감점된다(설계 의도).
 * 노드 id 를 이름에 포함한 구역(yg-04 DB_정상구간)은 그 노드 위에 앉는다 —
 * 갈래에 들어가는 선분이 곧 구역 침범이 된다.
 */

type Pt = [number, number];
type NodeKind = "start" | "waypoint" | "decoy" | "extra";

type RouteNode = {
  id: string;
  kind: NodeKind;
  at: Pt;
  label?: string;
  color?: string;
  arrival?: boolean;
};

type Zone = { id: string; at: Pt; radius: number; penalty: number; reason?: string };

type BlockerDef = {
  id: string;
  at: Pt;
  sprite?: string;
  label?: string;
  action: string;
  missedPenalty: number;
};

type Vertex = { at: Pt; nodeId?: string };
type Outcome = { score: number; parts: string[] };

/* ── YAML(unknown) 안전 파싱 ── */

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function pt(v: unknown): Pt | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const x = num(v[0]);
  const y = num(v[1]);
  return x !== undefined && y !== undefined ? [x, y] : null;
}
function nonNull<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined;
}
const pretty = (id: string) => id.replace(/_/g, " ");

/** 데이터의 한국어 색 이름 → 표시 색 (stn-02 노드 color 필드) */
const NODE_COLORS: Record<string, string> = {
  노랑: "#ffd76e",
  파랑: "#6ea8ff",
  주황: "#ffa94d",
  보라: "#b08cff",
  초록: "#5adcb4",
  흰색: "#f4f4f8",
  빨강: "#ff7a8c",
};

/* ── 모델 구성 (좌표 자동 배치 포함) ── */

const AUTO_START: Pt = [90, 240];
const AUTO_ARRIVAL: Pt = [870, 240];
const AUTO_ARC_Y = 90; // 정답 경유지 호(위쪽)
const AUTO_EXTRA_Y = 370; // 신호만 있는 갈래 노드(아래쪽)
const AUTO_ZONE_RADIUS = 55;

type RawNode = { id: string; at: Pt | null; label?: string; color?: string; arrival?: boolean };

function parseNodeRaw(v: unknown): RawNode | null {
  const s = str(v);
  if (s) return { id: s, at: null };
  const r = asRecord(v);
  if (!r) return null;
  const id = str(r.id);
  if (!id) return null;
  return { id, at: pt(r.at), label: str(r.label), color: str(r.color), arrival: r.arrival === true };
}

type RouteModel = {
  map: string | null;
  start: RouteNode;
  waypoints: RouteNode[];
  decoys: RouteNode[];
  extras: RouteNode[];
  zones: Zone[];
  blockers: BlockerDef[];
  lights: Map<string, { light: string; hint?: string }>;
  logHints: Map<string, string>;
  reportAt: string | null;
  submitAs: string | null;
  budgetTime: number | null;
  timeOverPenalty: number;
};

function buildModel(data: Record<string, unknown>): RouteModel {
  const startRaw: RawNode = parseNodeRaw(data.start) ?? { id: "출발", at: null };
  const wpRaw = asArray(data.waypoints).map(parseNodeRaw).filter(nonNull);
  const decoyRaw = asArray(data.decoy_waypoints).map(parseNodeRaw).filter(nonNull);

  // 구간 상태등(yg-04) — signals[].at 은 좌표가 아니라 노드 id 참조다
  const lights = new Map<string, { light: string; hint?: string }>();
  for (const s of asArray(data.signals).map(asRecord).filter(nonNull)) {
    const nodeId = str(s.at);
    const light = str(s.light);
    if (nodeId && light) lights.set(nodeId, { light, hint: str(s.hint) });
  }
  const logHints = new Map<string, string>();
  for (const h of asArray(data.log_hints).map(asRecord).filter(nonNull)) {
    const nodeId = str(h.at);
    const text = str(h.text);
    if (nodeId && text) logHints.set(nodeId, text);
  }

  // 신호만 있고 경로에 없는 노드(yg-04 DB) → 갈래 노드로 렌더
  const knownIds = new Set([startRaw.id, ...wpRaw.map((w) => w.id), ...decoyRaw.map((d) => d.id)]);
  const extraIds = [...lights.keys()].filter((id) => !knownIds.has(id));

  const startAt: Pt = startRaw.at ?? AUTO_START;
  const arrivalIdx = wpRaw.length - 1;
  const arrivalAt: Pt = (arrivalIdx >= 0 ? wpRaw[arrivalIdx].at : null) ?? AUTO_ARRIVAL;
  const lerp = (t: number): Pt => [
    Math.round(startAt[0] + (arrivalAt[0] - startAt[0]) * t),
    Math.round(startAt[1] + (arrivalAt[1] - startAt[1]) * t),
  ];

  const start: RouteNode = { id: startRaw.id, kind: "start", at: startAt, label: startRaw.label, color: startRaw.color };
  const interCount = Math.max(0, arrivalIdx);
  const waypoints: RouteNode[] = wpRaw.map((w, i) => {
    let at = w.at;
    if (!at) {
      // 도착지는 우측, 중간 경유지는 위쪽 호 — 직선 회랑(decoy·구역)에서 비켜난다
      at = i === arrivalIdx ? arrivalAt : [lerp((i + 1) / (interCount + 1))[0], AUTO_ARC_Y];
    }
    return { id: w.id, kind: "waypoint", at, label: w.label, color: w.color, arrival: w.arrival || i === arrivalIdx };
  });
  const decoys: RouteNode[] = decoyRaw.map((d, j) => ({
    id: d.id,
    kind: "decoy",
    at: d.at ?? lerp((j + 1) / (decoyRaw.length + 1)),
    label: d.label,
    color: d.color,
  }));
  const extras: RouteNode[] = extraIds.map((id, e) => ({
    id,
    kind: "extra",
    at: [lerp((e + 1) / (extraIds.length + 1))[0], AUTO_EXTRA_Y],
  }));

  const allNodes = [start, ...waypoints, ...decoys, ...extras];

  // 회피구역 — at 있으면 그대로, 이름이 노드를 가리키면 그 노드 위에,
  // 둘 다 아니면 출발→도착 직선 회랑에 순서대로 깐다(초안 직선 항로 재현 — jm-04)
  const zonesPre = asArray(data.avoid)
    .map(asRecord)
    .filter(nonNull)
    .map((z) => ({
      id: str(z.zone) ?? "위험구역",
      at: pt(z.at),
      radius: num(z.radius),
      penalty: num(z.penalty) ?? 0,
      reason: str(z.reason),
    }));
  const anchorOf = (zoneId: string) => allNodes.find((n) => zoneId.includes(n.id)) ?? null;
  const floatCount = zonesPre.filter((z) => !z.at && !anchorOf(z.id)).length;
  let floatIdx = 0;
  const zones: Zone[] = zonesPre.map((z) => {
    let at = z.at;
    if (!at) {
      const host = anchorOf(z.id);
      if (host) at = host.at;
      else {
        floatIdx += 1;
        at = lerp(floatIdx / (floatCount + 1));
      }
    }
    return { id: z.id, at, radius: z.radius ?? AUTO_ZONE_RADIUS, penalty: z.penalty, reason: z.reason };
  });

  // 경로상 발견·보고물(stn-02) — 회피가 아니라 '발견해 보고'가 정답
  const blockersRaw = asArray(data.blockers).map(asRecord).filter(nonNull);
  const blockers: BlockerDef[] = blockersRaw.map((b, i) => ({
    id: str(b.id) ?? `발견물_${i + 1}`,
    at: pt(b.at) ?? lerp((i + 1) / (blockersRaw.length + 1)),
    sprite: str(b.sprite),
    label: str(b.label),
    action: str(b.action) ?? "보고",
    missedPenalty: num(b.missed_penalty) ?? 40,
  }));

  const budget = asRecord(data.budget);
  return {
    map: str(data.map) ?? null,
    start,
    waypoints,
    decoys,
    extras,
    zones,
    blockers,
    lights,
    logHints,
    reportAt: str(data.report_at) ?? null,
    submitAs: str(data.submit_as) ?? null,
    budgetTime: budget ? (num(budget.time) ?? null) : null,
    timeOverPenalty: budget ? (num(budget.time_over_penalty) ?? 0) : 0,
  };
}

/* ── 기하 ── */

/** 선분-원 교차 — 침범 판정. 선분 위 최근접점과 원 중심의 거리로 계산한다. */
function segHitsZone(a: Pt, b: Pt, zone: Zone): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((zone.at[0] - a[0]) * dx + (zone.at[1] - a[1]) * dy) / len2));
  const px = a[0] + t * dx - zone.at[0];
  const py = a[1] + t * dy - zone.at[1];
  return px * px + py * py <= zone.radius * zone.radius;
}

function inZone(p: Pt, zone: Zone): boolean {
  const dx = p[0] - zone.at[0];
  const dy = p[1] - zone.at[1];
  return dx * dx + dy * dy <= zone.radius * zone.radius;
}

/** 방문 순서 vs 정답 순서 — 최장 공통 부분수열. 순서를 어긴 경유지는 인정 안 된다. */
function orderedMatches(visits: string[], answer: string[]): number {
  const rows = visits.length;
  const cols = answer.length;
  const dp = new Array<number>((rows + 1) * (cols + 1)).fill(0);
  const cell = (r: number, c: number) => r * (cols + 1) + c;
  for (let r = 1; r <= rows; r += 1) {
    for (let c = 1; c <= cols; c += 1) {
      dp[cell(r, c)] =
        visits[r - 1] === answer[c - 1]
          ? dp[cell(r - 1, c - 1)] + 1
          : Math.max(dp[cell(r - 1, c)], dp[cell(r, c - 1)]);
    }
  }
  return dp[cell(rows, cols)];
}

/* ── 컴포넌트 ── */

export function RouteGame({ game, onComplete }: EngineProps) {
  const model = useMemo(() => buildModel(game.data), [game]);
  const [route, setRoute] = useState<Vertex[]>([{ at: model.start.at, nodeId: model.start.id }]);
  const [revealed, setRevealed] = useState<string[]>([]); // 한 번 드러난 구역은 undo 해도 보인다
  const [notices, setNotices] = useState<string[]>([]);
  const [found, setFound] = useState<string[]>([]);
  const [reported, setReported] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const finished = useRef(false);
  const done = outcome !== null;

  const waypointIds = useMemo(() => model.waypoints.map((w) => w.id), [model]);
  const visitOrder = route
    .filter((v) => v.nodeId !== undefined && waypointIds.includes(v.nodeId))
    .map((v) => v.nodeId as string);
  const orderMatters = game.scoring?.["order_matters"] === true;
  const waypointTotal = Math.max(1, scoringOf(game, "waypoint_count", waypointIds.length));
  const matched = orderMatters ? orderedMatches(visitOrder, waypointIds) : visitOrder.length;

  const { remaining, startedAt } = useCountdown(game.time_limit, done, () => finish());

  /** 채점은 제출한 최종 경로 기준 — 감점 중첩 금지(같은 자리 사건은 무거운 쪽 하나만). */
  function finish() {
    if (finished.current) return;
    finished.current = true;
    const segs: Array<[Pt, Pt]> = [];
    for (let i = 1; i < route.length; i += 1) segs.push([route[i - 1].at, route[i].at]);
    const hitZones = model.zones.filter((z) => segs.some(([a, b]) => segHitsZone(a, b, z)));
    const missed = model.blockers.filter((b) => !reported.includes(b.id));

    // 침범한 구역 안의 발견물을 방치한 경우 — 한 사건이므로 무거운 감점 하나만 (stn-02)
    const droppedZones = new Set<string>();
    const keptMissed = missed.filter((b) => {
      const host = hitZones.find((z) => !droppedZones.has(z.id) && inZone(b.at, z));
      if (!host) return true;
      if (host.penalty >= b.missedPenalty) return false; // 구역 감점만 적용
      droppedZones.add(host.id); // 방치 감점이 더 무겁다 — 구역 쪽을 버린다
      return true;
    });
    const activeZones = hitZones.filter((z) => !droppedZones.has(z.id));
    const zoneSum = activeZones.reduce((s, z) => s + z.penalty, 0);
    const missSum = keptMissed.reduce((s, b) => s + b.missedPenalty, 0);

    const elapsed = elapsedSeconds(startedAt);
    const overBudget = model.budgetTime !== null && model.timeOverPenalty > 0 && elapsed > model.budgetTime;
    const overSum = overBudget ? model.timeOverPenalty : 0;

    const base = (matched / waypointTotal) * 100;
    const score = clampScore(base - zoneSum - missSum - overSum);
    const mistakes = activeZones.length + keptMissed.length + (overBudget ? 1 : 0);

    const parts = [`경유지 ${matched}/${waypointTotal} 연결${orderMatters ? " (순서 반영)" : ""}`];
    if (activeZones.length > 0) parts.push(`위험구역 침범 ${activeZones.length}곳 −${zoneSum}`);
    if (keptMissed.length > 0) parts.push(`발견물 미보고 ${keptMissed.length}건 −${missSum}`);
    if (reported.length > 0) parts.push(`보고 완료 ${reported.length}건`);
    if (overBudget) parts.push(`시간 초과 −${overSum}`);
    if (mistakes === 0) parts.push("위반 없음");

    setOutcome({ score, parts });
    onComplete({ accuracy: score, time_seconds: elapsed, mistakes });
  }

  /** 새 선분이 구역을 스치면 그 자리에서 드러내고 reason 을 알린다(침범 후에만). */
  function revealFromSegment(from: Pt, to: Pt) {
    const hits = model.zones.filter((z) => segHitsZone(from, to, z) && !revealed.includes(z.id));
    if (hits.length === 0) return;
    setRevealed((cur) => [...cur, ...hits.map((z) => z.id)]);
    setNotices((cur) => [...cur, ...hits.map((z) => `${pretty(z.id)} 침범 — ${z.reason ?? "위험구역입니다"}`)]);
  }

  function addVertex(at: Pt, nodeId?: string) {
    if (done) return;
    const last = route[route.length - 1];
    revealFromSegment(last.at, at);
    setRoute((cur) => [...cur, { at, nodeId }]);
  }

  const clickNode = (node: RouteNode) => (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (done || node.kind === "start") return;
    if (route.some((v) => v.nodeId === node.id)) return;
    addVertex(node.at, node.id);
  };

  function clickScene(event: MouseEvent<HTMLDivElement>) {
    if (done) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = Math.round(((event.clientX - rect.left) / rect.width) * SCENE.w);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * SCENE.h);
    addVertex([Math.max(0, Math.min(SCENE.w, x)), Math.max(0, Math.min(SCENE.h, y))]);
  }

  function undo() {
    if (done || route.length <= 1) return;
    setRoute((cur) => cur.slice(0, -1));
  }

  const clickBlocker = (blocker: BlockerDef) => (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (done || found.includes(blocker.id)) return;
    setFound((cur) => [...cur, blocker.id]);
  };

  function report(blocker: BlockerDef) {
    if (done || reported.includes(blocker.id)) return;
    setReported((cur) => [...cur, blocker.id]);
  }

  /** 노드 방문 순번 — 출발 제외, 자유 경유점 제외. */
  function visitIndexOf(id: string): number | null {
    let n = 0;
    for (const v of route) {
      if (v.nodeId === undefined || v.nodeId === model.start.id) continue;
      n += 1;
      if (v.nodeId === id) return n;
    }
    return null;
  }

  const lastNodeId = route[route.length - 1].nodeId ?? null;
  const reportMode = model.reportAt !== null;
  // report_at(yg-04): 해당 노드에 도착해 '보고'하는 것이 종료 조건
  const submitReady = reportMode ? lastNodeId === model.reportAt : route.length > 1;
  const submitLabel = reportMode ? "보고" : model.submitAs ? pretty(model.submitAs) : "경로 제출";

  const nodes = [model.start, ...model.waypoints, ...model.decoys, ...model.extras];
  const pendingBlockers = model.blockers.filter((b) => found.includes(b.id) && !reported.includes(b.id));

  return (
    <div className={shared.shell}>
      <GameHud
        label="경유지 연결"
        count={visitOrder.length}
        total={waypointTotal}
        remaining={remaining}
        timeLimit={game.time_limit}
      />

      {/* eslint 없음 — 배경 클릭은 마우스 보조 조작이고, 노드·발견물 버튼만으로도 완주 가능 */}
      <div
        className={`${shared.scene} ${styles.canvas}`}
        role="group"
        aria-label="경로 지도 — 노드를 순서대로 클릭해 선을 잇고, 빈 곳을 클릭하면 경유점을 추가해 선을 꺾을 수 있습니다"
        onClick={clickScene}
      >
        {model.map ? (
          <span className={styles.mapTag} aria-hidden="true">
            {pretty(model.map)}
          </span>
        ) : null}

        <svg
          className={styles.overlay}
          viewBox={`0 0 ${SCENE.w} ${SCENE.h}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {model.zones
            .filter((z) => revealed.includes(z.id))
            .map((z) => (
              <circle key={z.id} className={styles.zone} cx={z.at[0]} cy={z.at[1]} r={z.radius} />
            ))}
          <polyline className={styles.line} points={route.map((v) => `${v.at[0]},${v.at[1]}`).join(" ")} />
          {route.map((v, i) => (
            <circle
              key={`${v.at[0]}-${v.at[1]}-${i}`}
              className={i === route.length - 1 ? styles.vertexHead : styles.vertex}
              cx={v.at[0]}
              cy={v.at[1]}
              r={i === route.length - 1 ? 7 : 4}
            />
          ))}
        </svg>

        {nodes.map((node) => {
          const light = model.lights.get(node.id);
          const hint = [light?.hint, model.logHints.get(node.id)].filter(Boolean).join(" · ");
          const visitedAt = visitIndexOf(node.id);
          const isStart = node.kind === "start";
          const text = node.label ?? pretty(node.id);
          return (
            <button
              key={node.id}
              type="button"
              className={styles.node}
              style={{ left: `${(node.at[0] / SCENE.w) * 100}%`, top: `${(node.at[1] / SCENE.h) * 100}%` }}
              data-kind={node.kind}
              data-visited={isStart || visitedAt !== null}
              data-arrival={node.arrival === true}
              disabled={done || isStart || visitedAt !== null}
              onClick={clickNode(node)}
              title={hint || text}
              aria-label={`${text}${light ? ` — 상태등 ${light.light}` : ""}${visitedAt !== null ? " (연결됨)" : ""}`}
            >
              {light ? <span className={styles.lamp} data-light={light.light} aria-hidden="true" /> : null}
              {node.color ? (
                <span
                  className={styles.colorDot}
                  style={{ background: NODE_COLORS[node.color] ?? "#c9c9d9" }}
                  aria-hidden="true"
                />
              ) : null}
              <span className={styles.nodeText}>{text}</span>
              {isStart ? (
                <span className={styles.badge} data-start="true">
                  출발
                </span>
              ) : null}
              {visitedAt !== null ? <span className={styles.badge}>{visitedAt}</span> : null}
            </button>
          );
        })}

        {model.blockers.map((blocker) => {
          const isFound = found.includes(blocker.id);
          const isReported = reported.includes(blocker.id);
          return (
            <button
              key={blocker.id}
              type="button"
              className={styles.blocker}
              style={{ left: `${(blocker.at[0] / SCENE.w) * 100}%`, top: `${(blocker.at[1] / SCENE.h) * 100}%` }}
              data-state={isReported ? "reported" : isFound ? "found" : "idle"}
              disabled={done || isFound}
              onClick={clickBlocker(blocker)}
              aria-label={isFound ? (blocker.label ?? pretty(blocker.id)) : `발견물 확인: ${pretty(blocker.sprite ?? blocker.id)}`}
            >
              {isFound ? (blocker.label ?? pretty(blocker.id)) : pretty(blocker.sprite ?? blocker.id)}
              {isReported ? (
                <span className={styles.blockerMark} aria-hidden="true">
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {notices.length > 0 ? (
        <div className={styles.notices} role="log" aria-live="polite">
          {notices.map((text, i) => (
            <p key={`${i}-${text}`} className={styles.notice}>
              ⚠ {text}
            </p>
          ))}
        </div>
      ) : null}

      {!done ? (
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.controlButton}
            onClick={undo}
            disabled={route.length <= 1}
            aria-label="마지막 경유점 되돌리기"
          >
            한 칸 되돌리기
          </button>
          {pendingBlockers.map((blocker) => (
            <button
              key={blocker.id}
              type="button"
              className={styles.actionButton}
              onClick={() => report(blocker)}
              aria-label={`${blocker.label ?? pretty(blocker.id)} — ${pretty(blocker.action)}`}
            >
              {pretty(blocker.action)}
            </button>
          ))}
          <button
            type="button"
            className={styles.submitButton}
            onClick={() => finish()}
            disabled={!submitReady}
            title={reportMode && !submitReady ? "원인 구간에 도착한 뒤 보고할 수 있습니다" : undefined}
          >
            {submitLabel}
          </button>
        </div>
      ) : null}

      {outcome ? <ResultBar score={outcome.score}>{outcome.parts.join(" · ")}</ResultBar> : null}
    </div>
  );
}
