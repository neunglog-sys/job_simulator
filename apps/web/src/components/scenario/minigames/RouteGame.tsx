import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import shared from "../../../styles/minigame.module.css";
import styles from "../../../styles/routeGame.module.css";
import { PixelSprite } from "./PixelSprite";
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
 * 예외: `visible: true` 구역만 처음부터 반투명 존+표지로 그린다. 원문이 지도에
 * 위험구역을 미리 표기하는 경우다(jm-01 "노선도에 지름길이 보호구역 경유로 표시").
 * 채점은 '제출한 최종 경로' 기준이다. 네 시나리오 모두 결과물이 계획·설계·수정안
 * (노선 계획, 항로 수정안, 동선 설계, 위치 보고)이므로 스치고 되돌린 흔적이 아니라
 * 제출안이 위험구역을 지나는지를 본다. 시행착오의 비용은 제한시간이 진다.
 *
 * 2단계 확장(jm-01) — `data.driving` 이 있을 때만: ① 시작 시 weather_pool 에서
 * 기상 1개를 랜덤으로 뽑아 상단 배너로 걸고 ② 계획 제출 후 1945식 종스크롤 주행
 * 파트로 전환된다. 방향키/WASD 로 트럭을 조향해 내려오는 장애물을 피하고, 서행
 * 의무 구간에선 트럭을 서행선 아래로 내려야 한다(과속 유지 = 구역당 1회 감점).
 * 날씨 effect(서행)는 주행 기본 속도를 낮추고 when_effect 구간을 활성화한다.
 * 최종 accuracy = 계획 점수 − 주행 감점(clampScore) — 기존 채점 계약 위에 감점만
 * 얹는다. 장애물·진행률은 시계에서 역산하고 rAF 는 렌더만 한다(PourGame 규약).
 * prefers-reduced-motion 이면 저속·무장애물 간이 모드(충돌 감점 없음, 서행 의무 유지).
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
  /** 도트 아트 id(jm-01) — 파일이 없으면 라벨만 보인다 */
  sprite?: string;
  arrival?: boolean;
};

type Zone = {
  id: string;
  at: Pt;
  radius: number;
  penalty: number;
  reason?: string;
  sprite?: string;
  /** true = 계획 화면에서 처음부터 그린다(visible: true — jm-01 보호구역) */
  visible: boolean;
};

type Weather = { id: string; effect?: string; notice?: string };

type SlowZone = {
  id: string;
  /** 주행 진행률 0~1 구간 */
  from: number;
  to: number;
  penalty: number;
  sprite?: string;
  reason?: string;
  /** 이 기상 effect 일 때만 활성(없으면 항상) — 호우·안개 서행 구간 */
  whenEffect?: string;
};

type DrivingDef = {
  duration: number;
  density: number;
  obstacles: string[];
  slowZones: SlowZone[];
};

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

type RawNode = { id: string; at: Pt | null; label?: string; color?: string; sprite?: string; arrival?: boolean };

function parseNodeRaw(v: unknown): RawNode | null {
  const s = str(v);
  if (s) return { id: s, at: null };
  const r = asRecord(v);
  if (!r) return null;
  const id = str(r.id);
  if (!id) return null;
  return { id, at: pt(r.at), label: str(r.label), color: str(r.color), sprite: str(r.sprite), arrival: r.arrival === true };
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
  weatherPool: Weather[];
  driving: DrivingDef | null;
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

  const start: RouteNode = {
    id: startRaw.id,
    kind: "start",
    at: startAt,
    label: startRaw.label,
    color: startRaw.color,
    sprite: startRaw.sprite,
  };
  const interCount = Math.max(0, arrivalIdx);
  const waypoints: RouteNode[] = wpRaw.map((w, i) => {
    let at = w.at;
    if (!at) {
      // 도착지는 우측, 중간 경유지는 위쪽 호 — 직선 회랑(decoy·구역)에서 비켜난다
      at = i === arrivalIdx ? arrivalAt : [lerp((i + 1) / (interCount + 1))[0], AUTO_ARC_Y];
    }
    return {
      id: w.id,
      kind: "waypoint",
      at,
      label: w.label,
      color: w.color,
      sprite: w.sprite,
      arrival: w.arrival || i === arrivalIdx,
    };
  });
  const decoys: RouteNode[] = decoyRaw.map((d, j) => ({
    id: d.id,
    kind: "decoy",
    at: d.at ?? lerp((j + 1) / (decoyRaw.length + 1)),
    label: d.label,
    color: d.color,
    sprite: d.sprite,
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
      sprite: str(z.sprite),
      visible: z.visible === true,
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
    return {
      id: z.id,
      at,
      radius: z.radius ?? AUTO_ZONE_RADIUS,
      penalty: z.penalty,
      reason: z.reason,
      sprite: z.sprite,
      visible: z.visible,
    };
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

  // 기상 풀(weather_pool) — 게임 시작 시 1개가 랜덤으로 걸려 상단 배너가 된다
  const weatherPool: Weather[] = asArray(data.weather_pool)
    .map(asRecord)
    .filter(nonNull)
    .map((w) => ({ id: str(w.id) ?? "", effect: str(w.effect), notice: str(w.notice) }))
    .filter((w) => w.id !== "");

  // 주행 파트(driving) — 이 블록이 있는 게임만 계획 제출 후 주행으로 넘어간다(jm-01)
  const drv = asRecord(data.driving);
  const obstacleIds = drv ? asArray(drv.obstacles).map(str).filter(nonNull) : [];
  const driving: DrivingDef | null = drv
    ? {
        duration: Math.min(60, Math.max(8, num(drv.duration) ?? 24)),
        density: Math.min(1, Math.max(0.1, num(drv.obstacle_density) ?? 0.5)),
        obstacles: obstacleIds.length > 0 ? obstacleIds : ["장애물_차량", "물웅덩이"],
        slowZones: asArray(drv.slow_zones)
          .map(asRecord)
          .filter(nonNull)
          .map((z, i) => ({
            id: str(z.id) ?? `서행구간_${i + 1}`,
            from: Math.min(1, Math.max(0, num(z.from) ?? 0)),
            to: Math.min(1, Math.max(0, num(z.to) ?? 1)),
            penalty: num(z.penalty) ?? 0,
            sprite: str(z.sprite),
            reason: str(z.reason),
            whenEffect: str(z.when_effect),
          })),
      }
    : null;

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
    weatherPool,
    driving,
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

type PlanOutcome = { score: number; parts: string[]; mistakes: number };

export function RouteGame({ game, onComplete }: EngineProps) {
  const model = useMemo(() => buildModel(game.data), [game]);
  const [route, setRoute] = useState<Vertex[]>([{ at: model.start.at, nodeId: model.start.id }]);
  const [revealed, setRevealed] = useState<string[]>([]); // 한 번 드러난 구역은 undo 해도 보인다
  const [notices, setNotices] = useState<string[]>([]);
  const [found, setFound] = useState<string[]>([]);
  const [reported, setReported] = useState<string[]>([]);
  const [planOutcome, setPlanOutcome] = useState<PlanOutcome | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const finished = useRef(false);
  const done = outcome !== null;
  // 계획 → (driving 있으면) 주행 → 완료. 다른 route 3게임은 driving 이 없어 기존 흐름 그대로다.
  const phase: "plan" | "drive" | "done" = done ? "done" : planOutcome !== null && model.driving ? "drive" : "plan";

  // 기상 — 시작 시 랜덤 1개(마운트당 고정). 배너로 표시하고 주행 규칙에 반영한다.
  const [weather] = useState<Weather | null>(() =>
    model.weatherPool.length > 0 ? model.weatherPool[Math.floor(Math.random() * model.weatherPool.length)] : null,
  );

  const waypointIds = useMemo(() => model.waypoints.map((w) => w.id), [model]);
  const visitOrder = route
    .filter((v) => v.nodeId !== undefined && waypointIds.includes(v.nodeId))
    .map((v) => v.nodeId as string);
  const orderMatters = game.scoring?.["order_matters"] === true;
  const waypointTotal = Math.max(1, scoringOf(game, "waypoint_count", waypointIds.length));
  const matched = orderMatters ? orderedMatches(visitOrder, waypointIds) : visitOrder.length;

  // 제한시간은 계획 파트의 예산이다 — 주행으로 넘어가면 멈춘다(주행은 duration 이 곧 시계)
  const { remaining, startedAt } = useCountdown(game.time_limit, done || planOutcome !== null, () => finish());

  /** 최종 확정 — 점수·서술을 굳히고 onComplete 1회 호출. */
  function conclude(res: PlanOutcome) {
    setOutcome({ score: res.score, parts: res.parts });
    onComplete({ accuracy: res.score, time_seconds: elapsedSeconds(startedAt), mistakes: res.mistakes });
  }

  /** 계획 파트 채점 — 제출한 최종 경로 기준. 감점 중첩 금지(같은 자리 사건은 무거운 쪽 하나만). */
  function computePlan(): PlanOutcome {
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

    return { score, parts, mistakes };
  }

  /** 계획 제출 — driving 이 있으면 주행 파트로 넘어가고, 없으면 그대로 확정한다. */
  function finish() {
    if (finished.current) return;
    finished.current = true;
    const plan = computePlan();
    if (model.driving) {
      setPlanOutcome(plan);
      return;
    }
    conclude(plan);
  }

  /** 주행 완주 — 계획 점수에서 주행 감점만 뺀다(clampScore). 기존 채점 계약 위에 얹는 감점. */
  function handleDriveDone(drive: DriveOutcome) {
    if (planOutcome === null || finishedDrive.current) return;
    finishedDrive.current = true;
    conclude({
      score: clampScore(planOutcome.score - drive.penalty),
      parts: [...planOutcome.parts, ...drive.parts],
      mistakes: planOutcome.mistakes + drive.mistakes,
    });
  }
  const finishedDrive = useRef(false);

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
      {/* 기상 배너 — weather_pool 이 있는 게임만. 계획·주행 내내 걸려 있다. */}
      {weather ? (
        <div className={styles.weatherBanner} data-effect={weather.effect ?? "없음"} role="status">
          <span className={styles.weatherBadge}>{weather.effect ? "기상주의보" : "기상 안내"}</span>
          <b>{pretty(weather.id)}</b>
          <span className={styles.weatherNotice}>
            {weather.notice ?? (weather.effect ? pretty(weather.effect) : "특이사항 없음")}
          </span>
        </div>
      ) : null}

      {phase !== "drive" ? (
        <GameHud
          label="경유지 연결"
          count={visitOrder.length}
          total={waypointTotal}
          remaining={remaining}
          timeLimit={game.time_limit}
        />
      ) : null}

      {phase === "drive" && model.driving && planOutcome ? (
        <DrivingPhase
          driving={model.driving}
          weather={weather}
          planScore={planOutcome.score}
          truckSprite={model.start.sprite}
          collisionPenalty={scoringOf(game, "collision_penalty", 8)}
          onDone={handleDriveDone}
        />
      ) : null}

      {phase !== "drive" ? (
        <>
      {/* eslint 없음 — 배경 클릭은 마우스 보조 조작이고, 노드·발견물 버튼만으로도 완주 가능 */}
      <div
        className={`${shared.scene} ${styles.canvas}`}
        role="group"
        aria-label="경로 지도 — 노드를 순서대로 클릭해 선을 잇고, 빈 곳을 클릭하면 경유점을 추가해 선을 꺾을 수 있습니다"
        onClick={clickScene}
      >
        {model.map ? (
          // 도트 배경 노선도 — 캔버스에 꽉 채워 깔린다. 파일이 없으면 조용히 빠지고
          // 기존 이름표(mapTag)·반투명 오버레이만 남는다.
          <div className={styles.mapLayer} aria-hidden="true">
            <PixelSprite id={model.map} label={pretty(model.map)} size={SCENE.w} fallbackClassName={styles.spriteHidden} />
          </div>
        ) : null}
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
          {/* visible: true 구역은 처음부터, 나머지는 침범해 드러난 뒤에만 */}
          {model.zones
            .filter((z) => z.visible || revealed.includes(z.id))
            .map((z) => (
              <circle
                key={z.id}
                className={revealed.includes(z.id) ? styles.zone : styles.zonePre}
                cx={z.at[0]}
                cy={z.at[1]}
                r={z.radius}
              />
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

        {/* 구역 표지 스프라이트(jm-01 어린이보호구역_표지) — visible 구역은 사전에, 나머지는 침범 후 */}
        {model.zones.map((zone) =>
          zone.sprite !== undefined && (zone.visible || revealed.includes(zone.id)) ? (
            <span
              key={`zone-sprite-${zone.id}`}
              className={styles.zoneSprite}
              style={{ left: `${(zone.at[0] / SCENE.w) * 100}%`, top: `${(zone.at[1] / SCENE.h) * 100}%` }}
              aria-hidden="true"
            >
              <PixelSprite id={zone.sprite} label={pretty(zone.id)} size={34} fallbackClassName={styles.spriteHidden} />
            </span>
          ) : null,
        )}

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
              {node.sprite !== undefined ? (
                // 도트 마커(트럭·배송지·창고) — 파일이 없으면 숨고 라벨만 남는다
                <PixelSprite id={node.sprite} label={text} size={24} fallbackClassName={styles.spriteHidden} />
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
            {model.driving && submitReady ? `${submitLabel} → 출발` : submitLabel}
          </button>
        </div>
      ) : null}
        </>
      ) : null}

      {outcome ? <ResultBar score={outcome.score}>{outcome.parts.join(" · ")}</ResultBar> : null}
    </div>
  );
}

/* ── 주행 파트 (data.driving) — 1945식 종스크롤 ── */

type DriveOutcome = { penalty: number; parts: string[]; mistakes: number };

const ROAD_L = 300; // 도로 좌우 경계(SCENE 좌표)
const ROAD_R = 660;
const LANES = [345, 435, 525, 615]; // 4차선 중심
const TRUCK_W = 40; // 배송트럭_톱다운(10x14) 표시 폭·높이 — SCENE 단위
const TRUCK_H = 56;
const SPEED_LINE_Y = 205; // 서행선 — 이 위(화면 위쪽)에 머무르면 과속 위치
const BASE_SCROLL = 235; // 기본 도로 흐름 속도(SCENE 단위/초)
const WEATHER_SLOW_FACTOR = 0.72; // effect: 서행 기상이면 감속(속도에 날씨 반영)
const REDUCED_FACTOR = 0.55; // prefers-reduced-motion 간이 모드 저속
const STEER_X = 330; // 트럭 조향 속도(단위/초)
const STEER_Y = 270;
const SPAWN_Y = -70; // 장애물이 화면 위 밖에서 태어나는 y
const SPEEDING_GRACE = 1.0; // 서행 구간에서 이 시간(초) 이상 과속 '유지'해야 위반 1회

/** 장애물 스프라이트별 표시 크기(SCENE 단위) — viewBox 비율과 맞춘다 */
const OBSTACLE_SIZE: Record<string, { w: number; h: number }> = {
  장애물_차량: { w: 40, h: 56 },
  물웅덩이: { w: 46, h: 26 },
  장애물_라바콘: { w: 30, h: 30 },
};

type Obstacle = { key: number; spawnAt: number; x: number; sprite: string; w: number; h: number };

/** 스폰 스케줄 — 시작 시 한 번 뽑는다(Math.random 허용). 이후 위치는 전부 시계 역산. */
function buildSchedule(driving: DrivingDef): Obstacle[] {
  const list: Obstacle[] = [];
  const gap = 0.55 / driving.density; // density 0.5 → 평균 1.1~2.0초 간격
  let t = 1.6; // 첫 장애물 전 유예
  let key = 0;
  let prevLane = -1;
  while (t < driving.duration - 1) {
    // 직전과 다른 차선 — 한 번에 하나만 내려오므로 항상 피할 길이 있다
    let lane = Math.floor(Math.random() * LANES.length);
    if (lane === prevLane) lane = (lane + 1 + Math.floor(Math.random() * (LANES.length - 1))) % LANES.length;
    prevLane = lane;
    const sprite = driving.obstacles[Math.floor(Math.random() * driving.obstacles.length)];
    const size = OBSTACLE_SIZE[sprite] ?? { w: 40, h: 40 };
    list.push({ key, spawnAt: t, x: LANES[lane], sprite, w: size.w, h: size.h });
    key += 1;
    t += gap * (0.75 + Math.random() * 0.9);
  }
  return list;
}

type Frame = {
  elapsed: number;
  truck: Pt;
  hits: number;
  zone: SlowZone | null;
  zoneViolated: boolean;
  speeding: boolean;
  hitFlash: boolean;
};

const KEYMAP: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  w: "up", s: "down", a: "left", d: "right",
  W: "up", S: "down", A: "left", D: "right",
};

function DrivingPhase({
  driving,
  weather,
  planScore,
  truckSprite,
  collisionPenalty,
  onDone,
}: {
  driving: DrivingDef;
  weather: Weather | null;
  planScore: number;
  truckSprite?: string;
  collisionPenalty: number;
  onDone: (result: DriveOutcome) => void;
}) {
  // 간이 모드 — 저속·무장애물. 서행 의무는 반사신경이 아니라 판단이라 유지한다.
  const reduced = useMemo(
    () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const weatherSlow = weather?.effect === "서행";
  const scroll = BASE_SCROLL * (weatherSlow ? WEATHER_SLOW_FACTOR : 1) * (reduced ? REDUCED_FACTOR : 1);
  const schedule = useMemo(() => (reduced ? [] : buildSchedule(driving)), [driving, reduced]);
  // when_effect 구간은 해당 기상일 때만 활성 — 날씨가 주행 규칙에 반영되는 지점
  const zones = useMemo(
    () => driving.slowZones.filter((z) => z.whenEffect === undefined || z.whenEffect === weather?.effect),
    [driving, weather],
  );

  const startRef = useRef<number | null>(null); // 첫 프레임에 고정 — 이후 전부 이 시각에서 역산
  const lastRef = useRef(0);
  const truckRef = useRef<{ x: number; y: number }>({ x: 480, y: 372 });
  const keysRef = useRef(new Set<string>());
  const hitRef = useRef(new Set<number>());
  const lastHitAtRef = useRef(-10);
  const violatedRef = useRef(new Set<string>());
  const speedingForRef = useRef(0);
  const endedRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const [frame, setFrame] = useState<Frame>({
    elapsed: 0,
    truck: [480, 372],
    hits: 0,
    zone: null,
    zoneViolated: false,
    speeding: false,
    hitFlash: false,
  });
  const [events, setEvents] = useState<string[]>([]);

  // 키 입력 — 방향키/WASD. 방향키의 페이지 스크롤은 막는다.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const dir = KEYMAP[e.key];
      if (!dir) return;
      e.preventDefault();
      keysRef.current.add(dir);
    };
    const up = (e: KeyboardEvent) => {
      const dir = KEYMAP[e.key];
      if (dir) keysRef.current.delete(dir);
    };
    const clear = () => keysRef.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, []);

  // 시뮬레이션 — rAF 는 렌더만 한다. 장애물 y·진행률은 시계에서 역산하고,
  // 조향(입력)만 프레임 dt 로 적분한다(입력은 역산이 불가능한 유일한 값).
  // 탭이 백그라운드면 rAF 가 멈추고, 돌아오면 장애물은 지나가 있다 — 억울한 감점 없음.
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const now = Date.now();
      if (startRef.current === null) {
        startRef.current = now;
        lastRef.current = now;
      }
      const elapsed = (now - startRef.current) / 1000;
      const dt = Math.min(0.25, (now - lastRef.current) / 1000);
      lastRef.current = now;

      const truck = truckRef.current;
      const keys = keysRef.current;
      if (keys.has("left")) truck.x -= STEER_X * dt;
      if (keys.has("right")) truck.x += STEER_X * dt;
      if (keys.has("up")) truck.y -= STEER_Y * dt;
      if (keys.has("down")) truck.y += STEER_Y * dt;
      truck.x = Math.max(ROAD_L + TRUCK_W / 2, Math.min(ROAD_R - TRUCK_W / 2, truck.x));
      truck.y = Math.max(60, Math.min(SCENE.h - TRUCK_H / 2 - 6, truck.y));

      const progress = Math.min(1, elapsed / driving.duration);
      const zone = zones.find((z) => progress >= z.from && progress <= z.to) ?? null;
      const newEvents: string[] = [];

      // 충돌 — 장애물당 1회(사건당 감점 하나). 히트박스는 66%로 너그럽게.
      for (const ob of schedule) {
        if (hitRef.current.has(ob.key)) continue;
        const y = SPAWN_Y + (elapsed - ob.spawnAt) * scroll;
        if (y < SPAWN_Y || y > SCENE.h + 80) continue;
        if (
          Math.abs(ob.x - truck.x) < (ob.w + TRUCK_W) * 0.33 &&
          Math.abs(y - truck.y) < (ob.h + TRUCK_H) * 0.33
        ) {
          hitRef.current.add(ob.key);
          lastHitAtRef.current = elapsed;
          newEvents.push(`충돌 — ${pretty(ob.sprite)} −${collisionPenalty}`);
        }
      }

      // 서행 의무 — 서행선 위(과속 위치)를 SPEEDING_GRACE 초 유지하면 구역당 1회 감점
      let speeding = false;
      if (zone !== null && !violatedRef.current.has(zone.id)) {
        if (truck.y < SPEED_LINE_Y) {
          speeding = true;
          speedingForRef.current += dt;
          if (speedingForRef.current >= SPEEDING_GRACE) {
            violatedRef.current.add(zone.id);
            speedingForRef.current = 0;
            newEvents.push(`과속 위반 — ${pretty(zone.id)} −${zone.penalty}`);
          }
        } else {
          speedingForRef.current = 0;
        }
      } else {
        speedingForRef.current = 0;
      }

      if (newEvents.length > 0) setEvents((cur) => [...cur, ...newEvents].slice(-4));
      setFrame({
        elapsed,
        truck: [truck.x, truck.y],
        hits: hitRef.current.size,
        zone,
        zoneViolated: zone !== null && violatedRef.current.has(zone.id),
        speeding,
        hitFlash: elapsed - lastHitAtRef.current < 0.5,
      });

      if (elapsed >= driving.duration) {
        if (!endedRef.current) {
          endedRef.current = true;
          const collisions = hitRef.current.size;
          const violated = zones.filter((z) => violatedRef.current.has(z.id));
          const collisionSum = collisions * collisionPenalty;
          const zoneSum = violated.reduce((s, z) => s + z.penalty, 0);
          const parts: string[] = [
            collisions > 0 ? `주행 충돌 ${collisions}건 −${collisionSum}` : "무충돌 주행",
          ];
          if (violated.length > 0) {
            parts.push(`서행 위반 ${violated.map((z) => pretty(z.id)).join("·")} −${zoneSum}`);
          }
          if (reduced) parts.push("간이 주행 모드");
          onDoneRef.current({ penalty: collisionSum + zoneSum, parts, mistakes: collisions + violated.length });
        }
        return; // 완주 — 루프 중단
      }
      raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [driving, zones, schedule, scroll, collisionPenalty, reduced]);

  const press = (dir: string, on: boolean) => () => {
    if (on) keysRef.current.add(dir);
    else keysRef.current.delete(dir);
  };

  const remainingSec = Math.max(0, Math.ceil(driving.duration - frame.elapsed));
  const timerPct = Math.max(0, (1 - frame.elapsed / driving.duration) * 100);
  const scrollPx = Math.round(frame.elapsed * scroll);
  const pctX = (x: number) => `${(x / SCENE.w) * 100}%`;
  const pctY = (y: number) => `${(y / SCENE.h) * 100}%`;
  const visibleObstacles = schedule
    .map((ob) => ({ ob, y: SPAWN_Y + (frame.elapsed - ob.spawnAt) * scroll }))
    .filter(({ y }) => y >= SPAWN_Y && y <= SCENE.h + 80);

  return (
    <>
      <div className={styles.driveHud}>
        <span className={styles.driveHudLabel}>배송 주행</span>
        <span className={shared.timerTrack}>
          <span className={shared.timerValue} style={{ width: `${timerPct}%` }} data-low={remainingSec <= 5} />
        </span>
        <span className={styles.driveChip}>{remainingSec}초</span>
        <span className={styles.driveChip}>계획 {planScore}점</span>
        <span className={styles.driveChip} data-warn={frame.hits > 0}>
          충돌 {frame.hits}
        </span>
      </div>

      <div
        className={`${shared.scene} ${styles.driveScene}`}
        role="application"
        aria-label="배송 주행 — 방향키 또는 WASD로 트럭을 움직여 장애물을 피하세요. 서행 구간에서는 트럭을 서행선 아래로 내리세요"
      >
        <div className={styles.roadSide} style={{ left: 0, width: pctX(ROAD_L) }} aria-hidden="true" />
        <div className={styles.roadSide} style={{ right: 0, width: pctX(SCENE.w - ROAD_R) }} aria-hidden="true" />
        <div className={styles.road} style={{ left: pctX(ROAD_L), width: pctX(ROAD_R - ROAD_L) }} aria-hidden="true">
          {[1, 2, 3].map((i) => (
            <span
              key={i}
              className={styles.laneLine}
              style={{ left: `${i * 25}%`, backgroundPositionY: `${scrollPx}px` }}
            />
          ))}
        </div>

        {frame.zone ? <div className={styles.zoneTint} data-violated={frame.zoneViolated} aria-hidden="true" /> : null}
        {frame.zone ? (
          <span className={styles.speedLine} style={{ top: pctY(SPEED_LINE_Y) }} aria-hidden="true">
            <i>서행선</i>
          </span>
        ) : null}
        {frame.zone ? (
          <div className={styles.slowBanner} data-speeding={frame.speeding} data-violated={frame.zoneViolated} role="status">
            {frame.zone.sprite !== undefined ? (
              <PixelSprite id={frame.zone.sprite} label="" size={20} fallbackClassName={styles.spriteHidden} />
            ) : null}
            서행 의무 — {pretty(frame.zone.id)}
            {frame.zoneViolated ? " (위반)" : ""}
          </div>
        ) : null}

        {visibleObstacles.map(({ ob, y }) => (
          <span
            key={ob.key}
            className={styles.obstacle}
            data-hit={hitRef.current.has(ob.key)}
            style={{ left: pctX(ob.x), top: pctY(y), width: pctX(ob.w) }}
            aria-hidden="true"
          >
            <PixelSprite id={ob.sprite} label={pretty(ob.sprite)} size={ob.w} fallbackClassName={styles.obstacleFallback} />
          </span>
        ))}

        <span
          className={styles.truck}
          data-hit={frame.hitFlash}
          style={{ left: pctX(frame.truck[0]), top: pctY(frame.truck[1]), width: pctX(TRUCK_W) }}
          aria-hidden="true"
        >
          {truckSprite !== undefined ? (
            <PixelSprite id={truckSprite} label="배송트럭" size={TRUCK_W} fallbackClassName={styles.obstacleFallback} />
          ) : (
            <span className={styles.obstacleFallback} />
          )}
        </span>
      </div>

      {events.length > 0 ? (
        <div className={styles.notices} role="log" aria-live="polite">
          {events.map((text, i) => (
            <p key={`${i}-${text}`} className={styles.notice}>
              ⚠ {text}
            </p>
          ))}
        </div>
      ) : null}

      <div className={styles.driveControls}>
        <div className={styles.dpad}>
          <button type="button" className={styles.dpadButton} style={{ gridArea: "up" }} aria-label="위로 이동"
            onPointerDown={press("up", true)} onPointerUp={press("up", false)}
            onPointerLeave={press("up", false)} onPointerCancel={press("up", false)}>▲</button>
          <button type="button" className={styles.dpadButton} style={{ gridArea: "left" }} aria-label="왼쪽으로 이동"
            onPointerDown={press("left", true)} onPointerUp={press("left", false)}
            onPointerLeave={press("left", false)} onPointerCancel={press("left", false)}>◀</button>
          <button type="button" className={styles.dpadButton} style={{ gridArea: "down" }} aria-label="아래로 이동"
            onPointerDown={press("down", true)} onPointerUp={press("down", false)}
            onPointerLeave={press("down", false)} onPointerCancel={press("down", false)}>▼</button>
          <button type="button" className={styles.dpadButton} style={{ gridArea: "right" }} aria-label="오른쪽으로 이동"
            onPointerDown={press("right", true)} onPointerUp={press("right", false)}
            onPointerLeave={press("right", false)} onPointerCancel={press("right", false)}>▶</button>
        </div>
        <p className={styles.driveNote}>
          {reduced
            ? "간이 모드 — 장애물 없이 서행 주행합니다. 서행 구간의 서행선만 지키세요."
            : "방향키·WASD로 트럭을 움직여 장애물을 피하세요. 서행 구간에선 트럭을 서행선 아래로."}
        </p>
      </div>
    </>
  );
}
