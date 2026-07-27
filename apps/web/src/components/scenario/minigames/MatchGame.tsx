import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import "@fontsource/new-rocker/400.css";
import common from "../../../styles/minigame.module.css";
import styles from "../../../styles/matchGame.module.css";
import { PixelSprite } from "./PixelSprite";
import { GameHud, ResultBar, clampScore, elapsedSeconds, scoringOf, useCountdown, type EngineProps } from "./shared";

/**
 * match 엔진 — 좌우 카드를 선으로 잇는다. 8개 시나리오(ms-02·ys-03·kts-02·03·05·stn-01·03·04)가 쓴다.
 *
 * 판(좌/우 카드)은 공통이고, 파일마다 확장 블록이 하나씩 붙는다:
 *   unmatched(+unmatched_action)  짝 없는 카드 — '짝 없음' 도장이 정답 (ms-02·ys-03·stn-01·03·04)
 *   discard                        휴지통으로 버려야 하는 카드 (stn-01)
 *   stream                         흐르는 구슬에서 이상치만 클릭 (stn-03)
 *   keys                           매칭한 손님에게 색 객실 키 전달 (kts-05)
 *   sudden+stages+escalate         돌발 손님 → 단계 순서대로 → 호출 (kts-03)
 *   escalate(when=카드 id)         특정 카드는 선긋기 대신 호출이 정답 (ys-03)
 *   equivalent / forbidden_pairs   교차 배정 인정 / 금기 조합 (kts-02 등)
 *
 * 선은 카드당 1개 — 새 선이 기존 선을 대체한다. kts-02의 one_line_per_left("전부 잇기
 * 감점 회피 봉쇄")를 판 전체 규칙으로 올린 것으로, 8개 데이터 모두 카드당 정답이 1개라
 * 다중 연결이 필요한 파일이 없다.
 *
 * 채점은 '제출' 버튼(또는 시간 만료) 시 최종 상태에서 한 번 계산한다 — 전판을 판정해도
 * 자동 종료하지 않는다(일괄 제출, 디자이너 확정). 미완 제출이 가능해야 방치 감점(missed_*)이
 * 작동하고, 전판 완료 시에는 제출 버튼을 강조해 안내한다.
 * 감점 중첩 금지 — 한 사건(선 하나·카드 하나)에는 후보 중 가장 무거운 감점 하나만(_SCHEMA.md).
 * 카드 마커는 PixelSprite 로 그린다 — public/assets/minigames/<sprite id>.svg 가 있으면
 * 도트 아트(ys-03 얼굴·출입증 초상 등), 없으면 지금처럼 sprite id 텍스트 칩으로 폴백.
 * 확장 블록도 같은 규약으로 그린다: 구슬(stream)·객실 키(keys[].sprite)·돌발 아이콘
 * (sudden.sprite/stages[].sprite)·휴지통 버튼(discard.sprite). 단 구슬만은 sprite id 가
 * 이상치 여부를 글자로 유출하므로(구슬_붉은 vs 구슬_파랑 — 규칙 1) 폴백 라벨을 중립 문구
 * '구슬'로 고정한다.
 */

type Side = "left" | "right";

type MatchCard = {
  id: string;
  sprite: string;
  /** kts-03 전용 — 니즈 말풍선과 별개로 보여 주는 투명 배경 손님 일러스트. */
  customer_sprite?: string;
  label?: string;
  /** kts-03 고객 응대 화면 전용 표시 데이터. */
  speech?: string;
  foreign?: boolean;
  foreign_speech?: string;
  translated_speech?: string;
  kind?: "red" | "white" | "sweet" | "rose" | "sparkling" | string;
  price?: string;
  stock?: string;
  tier?: "premium" | "favorite" | "house" | string;
  /** kts-03 SVG 우측 진열대 내부 고정 슬롯 순서와 테두리색. */
  slot?: number;
  accent?: string;
  /** ys-03 — 금속탐지기 반응자. 게이트 램프 점멸(확산 링)에 카드 흔들림·붉은 펄스를 얹는다
   *  (시각 단서 강화 — 디자이너 피드백 2026-07-20). '벨이 정답'을 가리키는 표시는 금지 —
   *  울림을 잘 보이게만 하고 판단은 유저 몫. 선긋기·도장·인계 어느 쪽이든 카드가 처리되면
   *  경보가 잦아든다(모든 처리에 동일 — 정답 유출 없음). */
  detector?: boolean;
};

type StageDef = { id: string; sprite?: string; label?: string };

type SuddenDef = {
  id?: string;
  sprite?: string;
  appears_at?: number;
  label?: string;
  stages?: StageDef[];
  persists_after_stages?: boolean;
  forbidden_actions?: Array<{ id: string; label?: string; reason?: string }>;
};

type SupplyOrderItem = {
  id: string;
  label: string;
  display_label?: string;
  sprite: string;
  target: number;
  /** 와인 이미지 표시 영역 중심 좌표. */
  at: [number, number];
  /** 실제 수량이 증가하는 선반 상자 클릭 영역 중심 좌표. */
  hit_at?: [number, number];
  /** SVG 상자 테두리의 폭·높이. */
  hit_size?: [number, number];
};

type SupplyObstacle = {
  id: string;
  label: string;
  sprite: string;
  lane: number;
  at: number;
};

type TransportDirection = "up" | "down" | "left" | "right";
type TransportPosition = { x: number; y: number };
type TransportObstacleLayout = {
  kind: "dynamic" | "static";
  x: number;
  y: number;
  range: number;
  phase: number;
  direction?: 1 | -1;
};

type SupplyRunDef = {
  memory_seconds?: number;
  order?: SupplyOrderItem[];
  transport?: {
    duration_seconds?: number;
    obstacles?: SupplyObstacle[];
  };
};

type MatchData = {
  /** kts-03 — 원본 장면 위 손님·상품 배치 + 돌발 손님 상세 대응 화면. 채점에는 영향 없음. */
  presentation?: "customer_floor" | string;
  /** kts-03 — 출고 목록 기억 → 창고 피킹 → 카트 안전 운반 프롤로그. */
  supply_run?: SupplyRunDef;
  /** kts-03 첫 번째 분리 게임 — 운반 완료 시 고객 응대로 이어지지 않고 게임을 끝낸다. */
  supply_only?: boolean;
  left?: MatchCard[];
  right?: MatchCard[];
  /** 컬럼 헤더(선택) — 예: 입장객/제시된 출입증. 없으면 중립 라벨 '왼쪽'/'오른쪽'. */
  left_label?: string;
  right_label?: string;
  pairs?: Array<[string, string]>;
  unmatched?: string[];
  /** 짝없음 도장의 표시 라벨(표시 전용) — stn-04 재검증_표시, ys-03 불가능. 없으면 '짝 없음'. */
  unmatched_action?: string;
  /** kts-02 — 같은 그룹끼리는 교차 배정도 정답. */
  equivalent?: string[][];
  /** kts-02 — 좌 카드당 선 1개 제한. 이 엔진은 판 전체를 카드당 1선으로 운영해 항상 충족한다. */
  one_line_per_left?: boolean;
  /** right 스칼라·리스트({left,right}) 및 pair:[l,r](stn-03) 두 형태 모두 지원. */
  forbidden_pairs?: Array<{ left?: string; right?: string | string[]; pair?: [string, string]; reason?: string }>;
  /** stn-01 — 휴지통. sprite 는 버리기 버튼의 도트 아이콘(표시 전용 — 채점 무관, 파일 부재 시 기존 텍스트 버튼 그대로). */
  discard?: { bin?: string; sprite?: string; items?: Array<{ id: string; reason?: string }> };
  /** stn-03 — 흐름 검수. */
  stream?: {
    beads?: Array<{ id: string; sprite?: string }>;
    outliers?: Array<{ id: string; sprite?: string; reason?: string }>;
    decoy_beads?: Array<{ id: string; sprite?: string }>;
  };
  /** kts-05 — 객실 키 전달. sprite(객실키_파랑 등)는 표시 전용 도트 키 아트 — 없으면 색 원 폴백. */
  keys?: Array<{ guest: string; key_color: string; label?: string; sprite?: string }>;
  /** kts-03 — 돌발 손님. */
  sudden?: SuddenDef;
  /** when이 카드 id면 '선택한 카드 인계'(ys-03), 상태 조건이면 돌발 패널의 호출 버튼(kts-03). */
  escalate?: { label?: string; when?: string | string[]; requires?: string[] };
  /** ys-03 — 눌러선 안 되는 버튼(직접_신체수색 등). 누르면 forbidden_penalty. */
  forbidden?: Array<{ id: string; reason?: string }>;
  /** kts-03 — 카드 밑에 붙는 보조 시각 단서(가격표 개수 등). */
  visual_cues?: Record<string, string>;
};

/** 카드 단독 판정 — 도장·폐기·인계. 선(line)과 상호 배타. */
type CardMark = "stamped" | "discarded" | "escalated";

type Line = { left: string; right: string };

type Anchor = { x: number; y: number };

type Outcome = {
  accuracy: number;
  matchAccuracy: number;
  supplyAccuracy?: number;
  penalty: number;
  incidents: number;
  numerator: number;
  denominator: number;
  correctLineKeys: string[];
  cardVerdicts: Record<string, "ok" | "bad">;
};

const FLOW_SECONDS = 9; // 구슬이 밴드를 한 번 지나는 시간
// 창고 출고(kts-03-supply)에서 수량 힌트를 볼 수 있는 총 횟수.
const SUPPLY_HINT_LIMIT = 3;
// 카트 운반 단계 제한시간(초). 암기(10초)는 supply_run.memory_seconds가, 피킹은 무제한이고,
// 운반만 이 시계를 쓴다 — 전역 타이머 하나를 세 단계가 나눠 쓰면 앞 단계에서 시간을 다
// 써버려 뒤 단계를 못 하는 문제가 있었다.
const TRANSPORT_SECONDS = 60;

/** kts-05 객실 키 색 팔레트 — 아트 전 임시 색값. */
const KEY_COLORS: Record<string, string> = {
  blue: "#5b8def",
  green: "#35c28f",
  gold: "#e8b64c",
  red: "#e0506f",
  silver: "#b9c2d4",
  purple: "#9a6cf0",
};

/** 연결선 팔레트 — 좌 카드마다 고정 색을 배정한다(어두운 판 위에서 3:1 이상 나오는 밝은 톤만). */
const WIRE_COLORS = ["#7ab5ff", "#54d7a8", "#ffd166", "#ff9e7a", "#c792ea", "#6fe0e8", "#ff9ec2", "#b8e06a"];
/** 우 카드를 먼저 골랐을 때의 임시선 색 — 좌 카드가 정해지기 전이라 중립 톤. */
const WIRE_NEUTRAL = "#9fb6ff";

const lineKey = (line: Line) => `${line.left}|${line.right}`;
const pretty = (id: string) => id.replace(/_/g, " ");
const TRANSPORT_ROW_COUNT = 7;
const TRANSPORT_COLUMN_COUNT = 13;
const TRANSPORT_LANE_Y = Array.from(
  { length: TRANSPORT_ROW_COUNT },
  (_, index) => ((index + 0.5) / TRANSPORT_ROW_COUNT) * 100,
);
const TRANSPORT_COLUMN_X = Array.from(
  { length: TRANSPORT_COLUMN_COUNT },
  (_, index) => ((index + 0.5) / TRANSPORT_COLUMN_COUNT) * 100,
);
const TRANSPORT_START: TransportPosition = {
  x: TRANSPORT_COLUMN_X[0],
  y: TRANSPORT_LANE_Y[TRANSPORT_ROW_COUNT - 1],
};
const TRANSPORT_DESTINATION: TransportPosition = {
  x: TRANSPORT_COLUMN_X[TRANSPORT_COLUMN_COUNT - 1],
  y: TRANSPORT_LANE_Y[0],
};
const nudgeTransportPosition = (
  position: TransportPosition,
  direction: TransportDirection,
): TransportPosition => {
  const nearestIndex = (values: number[], current: number) =>
    values.reduce(
      (nearest, value, index) =>
        Math.abs(value - current) < Math.abs(values[nearest] - current) ? index : nearest,
      0,
    );
  if (direction === "left" || direction === "right") {
    const currentColumn = nearestIndex(TRANSPORT_COLUMN_X, position.x);
    const nextColumn = Math.max(
      0,
      Math.min(
        TRANSPORT_COLUMN_X.length - 1,
        currentColumn + (direction === "right" ? 1 : -1),
      ),
    );
    return { x: TRANSPORT_COLUMN_X[nextColumn], y: position.y };
  }
  const currentLane = nearestIndex(TRANSPORT_LANE_Y, position.y);
  const nextLane = Math.max(
    0,
    Math.min(TRANSPORT_LANE_Y.length - 1, currentLane + (direction === "down" ? 1 : -1)),
  );
  return { x: position.x, y: TRANSPORT_LANE_Y[nextLane] };
};
const transportRouteProgress = (position: TransportPosition) => {
  const totalDistance = Math.hypot(
    TRANSPORT_DESTINATION.x - TRANSPORT_START.x,
    TRANSPORT_DESTINATION.y - TRANSPORT_START.y,
  );
  const remainingDistance = Math.hypot(
    TRANSPORT_DESTINATION.x - position.x,
    TRANSPORT_DESTINATION.y - position.y,
  );
  return Math.max(0, Math.min(100, Math.round((1 - remainingDistance / totalDistance) * 100)));
};
const expandTransportObstacles = (obstacles: SupplyObstacle[]): SupplyObstacle[] => {
  const result = [...obstacles];
  const dynamicSeeds = obstacles.filter((obstacle) => /직원|고객/.test(`${obstacle.id} ${obstacle.label}`));
  const staticSeeds = obstacles.filter((obstacle) => !/직원|고객/.test(`${obstacle.id} ${obstacle.label}`));
  let dynamicCount = dynamicSeeds.length;
  let staticCount = staticSeeds.length;
  while (dynamicCount < 9 && dynamicSeeds.length > 0) {
    const source = dynamicSeeds[dynamicCount % dynamicSeeds.length];
    result.push({
      ...source,
      id: `${source.id}_runtime_${dynamicCount + 1}`,
      label: `${source.label} ${dynamicCount + 1}`,
    });
    dynamicCount += 1;
  }
  while (staticCount < 13 && staticSeeds.length > 0) {
    const source = staticSeeds[staticCount % staticSeeds.length];
    result.push({
      ...source,
      id: `${source.id}_runtime_${staticCount + 1}`,
      label: `${source.label} ${staticCount + 1}`,
    });
    staticCount += 1;
  }
  return result;
};
const createTransportObstacleLayout = (obstacles: SupplyObstacle[]): Record<string, TransportObstacleLayout> => {
  const dynamicTemplates = [
    { x: 4, y: TRANSPORT_LANE_Y[0], range: 92, phase: 8, direction: 1 as const },
    { x: 4, y: TRANSPORT_LANE_Y[1], range: 92, phase: 24, direction: -1 as const },
    { x: 4, y: TRANSPORT_LANE_Y[2], range: 42, phase: 4, direction: 1 as const },
    { x: 4, y: TRANSPORT_LANE_Y[3], range: 92, phase: 34, direction: -1 as const },
    { x: 4, y: TRANSPORT_LANE_Y[4], range: 42, phase: 12, direction: 1 as const },
    { x: 4, y: TRANSPORT_LANE_Y[5], range: 92, phase: 44, direction: -1 as const },
    { x: 4, y: TRANSPORT_LANE_Y[6], range: 92, phase: 20, direction: 1 as const },
    { x: 54, y: TRANSPORT_LANE_Y[2], range: 42, phase: 18, direction: -1 as const },
    { x: 54, y: TRANSPORT_LANE_Y[4], range: 42, phase: 28, direction: -1 as const },
  ];
  const staticTemplates = [
    { x: 20, y: TRANSPORT_LANE_Y[0] },
    { x: 40, y: TRANSPORT_LANE_Y[0] },
    { x: 58, y: TRANSPORT_LANE_Y[1] },
    { x: 76, y: TRANSPORT_LANE_Y[1] },
    { x: 27, y: TRANSPORT_LANE_Y[2] },
    { x: 49, y: TRANSPORT_LANE_Y[2] },
    { x: 72, y: TRANSPORT_LANE_Y[3] },
    { x: 35, y: TRANSPORT_LANE_Y[4] },
    { x: 64, y: TRANSPORT_LANE_Y[4] },
    { x: 6, y: TRANSPORT_LANE_Y[1] },
    { x: 6, y: TRANSPORT_LANE_Y[5] },
    { x: 94, y: TRANSPORT_LANE_Y[2] },
    { x: 94, y: TRANSPORT_LANE_Y[5] },
  ];
  let dynamicIndex = 0;
  let staticIndex = 0;
  return Object.fromEntries(
    obstacles.map((obstacle) => {
      const dynamic = /직원|고객/.test(`${obstacle.id} ${obstacle.label}`);
      if (dynamic) {
        const currentDynamicIndex = dynamicIndex;
        const template = dynamicTemplates[currentDynamicIndex % dynamicTemplates.length];
        dynamicIndex += 1;
        return [
          obstacle.id,
          {
            kind: "dynamic",
            x: template.x,
            y: template.y,
            range: template.range,
            phase: template.phase,
            direction: template.direction,
          },
        ];
      }
      const template = staticTemplates[staticIndex % staticTemplates.length];
      staticIndex += 1;
      return [
        obstacle.id,
        {
          kind: "static",
          x: template.x,
          y: template.y,
          range: 0,
          phase: 0,
        },
      ];
    }),
  );
};
const transportObstaclePosition = (
  layout: TransportObstacleLayout,
  motionProgress: number,
): TransportPosition => {
  if (layout.kind === "static" || layout.range <= 0) return { x: layout.x, y: layout.y };
  const cycle = layout.range * 2;
  const directedProgress = motionProgress * (layout.direction ?? 1);
  const cycleProgress = ((layout.phase + directedProgress) % cycle + cycle) % cycle;
  const offset = cycleProgress <= layout.range ? cycleProgress : cycle - cycleProgress;
  return {
    x: layout.x + offset,
    y: layout.y,
  };
};

function sameAnchors(a: Record<string, Anchor>, b: Record<string, Anchor>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return bKeys.every((k) => a[k] !== undefined && a[k].x === b[k].x && a[k].y === b[k].y);
}

export function MatchGame({ game, onComplete }: EngineProps) {
  const data = game.data as MatchData;
  const left = useMemo(() => data.left ?? [], [data.left]);
  const right = useMemo(() => data.right ?? [], [data.right]);
  const pairs = useMemo(() => data.pairs ?? [], [data.pairs]);
  const unmatchedList = useMemo(() => data.unmatched ?? [], [data.unmatched]);

  // 카드 표시 순서 셔플 — 나열 순서 그대로면 정답이 같은 행에 나란히 놓여 선긋기가 무의미해진다
  // (디자이너: 전 match 게임 공통). 좌/우를 각각 독립으로 섞고, 짝의 좌·우가 같은 행에 겹치면
  // 우측만 다시 섞어 어긋나게 한다. 표시 순서만 바꿀 뿐 매칭 판정은 카드 id·pairs 기준이라
  // 정답성·채점은 불변이다(선 anchor 는 셔플 후 마운트 시점에 measure). left/right 배열 자체는
  // 채점·색배정·완료판정에 그대로 쓰이고, 아래 두 배열은 렌더 순서 전용이다.
  // useMemo 는 [left,right,pairs] 가 data 파생 안정 참조라 마운트당 1회만 섞는다(리렌더 재섞음 없음).
  const [displayLeft, displayRight] = useMemo(() => {
    const shuffle = (arr: MatchCard[]): MatchCard[] => {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    };
    // kts-03 고객 응대는 SVG의 1→5 순서가 곧 플레이 순서다.
    if (data.presentation === "customer_floor") return [left.slice(), right.slice()] as const;
    const dl = shuffle(left);
    const leftRow = new Map(dl.map((card, i) => [card.id, i] as const));
    // 우측 순서에서 '정답이 같은 행에 겹친' 짝의 수 — 0 이 되도록 재셔플한다.
    const alignedCount = (order: MatchCard[]) =>
      pairs.reduce((n, [pl, pr]) => {
        const li = leftRow.get(pl);
        if (li === undefined) return n;
        return order.findIndex((card) => card.id === pr) === li ? n + 1 : n;
      }, 0);
    let dr = shuffle(right);
    // 회피 불가능한 극단 배치(예: 카드 1장)에서 무한루프 방지 — 최대 30회 후 그대로 둔다.
    for (let tries = 0; tries < 30 && alignedCount(dr) > 0; tries += 1) dr = shuffle(right);
    return [dl, dr] as const;
  }, [data.presentation, left, right, pairs]);
  const discardItems = useMemo(() => data.discard?.items ?? [], [data.discard]);
  const keyDefs = useMemo(() => data.keys ?? [], [data.keys]);
  const outliers = useMemo(() => data.stream?.outliers ?? [], [data.stream]);
  const sudden = data.sudden;
  const stages = useMemo(() => sudden?.stages ?? [], [sudden]);
  const customerFloor = data.presentation === "customer_floor";
  const supplyRun = data.supply_run;
  const supplyOrder = useMemo(() => supplyRun?.order ?? [], [supplyRun?.order]);
  const supplyObstacles = useMemo(
    () => supplyRun?.transport?.obstacles ?? [],
    [supplyRun?.transport?.obstacles],
  );
  const transportObstacles = useMemo(() => expandTransportObstacles(supplyObstacles), [supplyObstacles]);

  const unmatchedSet = useMemo(() => new Set(unmatchedList), [unmatchedList]);
  const discardSet = useMemo(() => new Set(discardItems.map((item) => item.id)), [discardItems]);

  // equivalent 그룹 — 같은 그룹이면 교차 배정도 정답(kts-02 회원 A↔B).
  const eqClass = useMemo(() => {
    const map = new Map<string, number>();
    (data.equivalent ?? []).forEach((group, gi) => group.forEach((id) => map.set(id, gi)));
    return map;
  }, [data.equivalent]);
  const eq = (a: string, b: string) => a === b || (eqClass.has(a) && eqClass.get(a) === eqClass.get(b));

  // 금기 조합 — {left, right(스칼라·리스트)} 와 {pair:[l,r]}(stn-03) 둘 다 "l→r" 키로 편다.
  const forbiddenPairSet = useMemo(() => {
    const set = new Set<string>();
    for (const fp of data.forbidden_pairs ?? []) {
      if (Array.isArray(fp.pair) && fp.pair.length === 2) set.add(`${fp.pair[0]}→${fp.pair[1]}`);
      if (fp.left !== undefined && fp.right !== undefined) {
        const rights = Array.isArray(fp.right) ? fp.right : [fp.right];
        for (const r of rights) set.add(`${fp.left}→${r}`);
      }
    }
    return set;
  }, [data.forbidden_pairs]);

  // escalate.when 이 실재 카드 id를 가리키면 '카드 인계' 모드(ys-03) — 그 카드의 정답은 선이 아니라 호출.
  const escTargets = useMemo(() => {
    const when = data.escalate?.when;
    const ids = new Set([...left, ...right].map((card) => card.id));
    const list = Array.isArray(when) ? when : when ? [when] : [];
    return list.filter((w) => ids.has(w));
  }, [data.escalate, left, right]);
  const isItemEscalate = escTargets.length > 0;

  // 구슬 흐름 — 정상·이상치·decoy 를 라운드로빈으로 섞어 이상치가 몰리지 않게 한다.
  const flowBeads = useMemo(() => {
    const src = data.stream;
    if (!src) return [] as Array<{ id: string; sprite: string; kind: "normal" | "outlier" | "decoy" }>;
    const groups: Array<[Array<{ id: string; sprite?: string }> | undefined, "normal" | "outlier" | "decoy"]> = [
      [src.beads, "normal"],
      [src.outliers, "outlier"],
      [src.decoy_beads, "decoy"],
    ];
    const rows: Array<{ id: string; sprite: string; kind: "normal" | "outlier" | "decoy" }> = [];
    const longest = Math.max(0, ...groups.map(([g]) => g?.length ?? 0));
    for (let i = 0; i < longest; i += 1) {
      for (const [group, kind] of groups) {
        const bead = group?.[i];
        if (bead) rows.push({ id: bead.id, sprite: bead.sprite ?? bead.id, kind });
      }
    }
    return rows;
  }, [data.stream]);

  // 돌발 단계 버튼 — 나열 순서가 곧 정답 순서라 그대로 그리면 왼쪽부터 누르기만 하면 된다.
  // id 해시로 고정 셔플해 '절차를 아는지'가 판정되게 한다(아트 전 임시 배치).
  const displayStages = useMemo(() => {
    const hash = (s: string) => [...s].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 9973, 7);
    return [...stages].sort((a, b) => hash(a.id) - hash(b.id));
  }, [stages]);

  const keyPalette = useMemo(() => [...new Set(keyDefs.map((k) => k.key_color))], [keyDefs]);
  // 키 색 → 도트 키 아트(kts-05 객실키_* — 표시 전용). 같은 색은 같은 아트를 공유한다.
  const keySpriteOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const k of keyDefs) if (k.sprite && !map.has(k.key_color)) map.set(k.key_color, k.sprite);
    return map;
  }, [keyDefs]);

  // ── 진행 상태 ──
  const [lines, setLines] = useState<Line[]>([]);
  const [marks, setMarks] = useState<Record<string, CardMark>>({});
  const [selected, setSelected] = useState<{ side: Side; id: string } | null>(null);
  const [beadClicks, setBeadClicks] = useState<Record<string, "caught" | "wrong">>({});
  const [stagesDone, setStagesDone] = useState<string[]>([]);
  const [stageViolations, setStageViolations] = useState(0); // 순서 위반 — 누른 시점에 확정
  const [escalated, setEscalated] = useState(false); // 상태형(sudden) 호출
  const [earlyEscalate, setEarlyEscalate] = useState(false); // 단계 전 성급 호출
  const [pressedForbidden, setPressedForbidden] = useState<string[]>([]);
  /** 금지 버튼을 누른 직후의 제지 배너 — tick 은 같은 배너 재등장 시 애니메이션 재생용. */
  const [forbiddenWarning, setForbiddenWarning] = useState<{ id: string; reason: string; tick: number } | null>(null);
  const [suddenVisible, setSuddenVisible] = useState(false);
  const [suddenArrived, setSuddenArrived] = useState(false);
  const [suddenFocused, setSuddenFocused] = useState(false);
  const [suddenResponseRemaining, setSuddenResponseRemaining] = useState(30);
  const [suddenTimedOut, setSuddenTimedOut] = useState(false);
  const [suddenDismissed, setSuddenDismissed] = useState(false);
  const [floorCustomerIndex, setFloorCustomerIndex] = useState(0);
  const [floorMatchFlash, setFloorMatchFlash] = useState(false);
  const [floorTranslated, setFloorTranslated] = useState(false);
  const [floorWineDetailId, setFloorWineDetailId] = useState<string | null>(null);
  const floorAdvanceTimer = useRef<number | null>(null);
  const supplyHintTimer = useRef<number | null>(null);
  const [flowPhase, setFlowPhase] = useState<"memory" | "picking" | "transport" | "customer">(
    supplyRun ? "memory" : "customer",
  );
  const memorySeconds = Math.max(1, supplyRun?.memory_seconds ?? 10);
  const [memoryRemaining, setMemoryRemaining] = useState(memorySeconds);
  const [transportRemaining, setTransportRemaining] = useState(TRANSPORT_SECONDS);
  const [pickedCounts, setPickedCounts] = useState<Record<string, number>>({});
  const [supplyHintVisible, setSupplyHintVisible] = useState(false);
  const [supplyHintUsed, setSupplyHintUsed] = useState(0);
  const transportRoadRef = useRef<HTMLDivElement | null>(null);
  const [transportPosition, setTransportPosition] = useState<TransportPosition>(TRANSPORT_START);
  const [transportObstacleLayout, setTransportObstacleLayout] = useState<Record<string, TransportObstacleLayout>>(
    () => createTransportObstacleLayout(transportObstacles),
  );
  const [transportProgress, setTransportProgress] = useState(0);
  const [transportObstacleProgress, setTransportObstacleProgress] = useState(0);
  const [transportRunning, setTransportRunning] = useState(false);
  const [transportComplete, setTransportComplete] = useState(false);
  const [transportHits, setTransportHits] = useState<string[]>([]);
  const [transportCollisions, setTransportCollisions] = useState(0);
  const [keysGiven, setKeysGiven] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const finishedRef = useRef(false);

  const linkedSet = useMemo(() => new Set(lines.flatMap((l) => [l.left, l.right])), [lines]);
  const activeFloorCustomer = customerFloor ? displayLeft[floorCustomerIndex] : undefined;
  const activeFloorForeign = Boolean(activeFloorCustomer?.foreign);
  const floorWineDetail = floorWineDetailId ? right.find((wine) => wine.id === floorWineDetailId) : undefined;

  useEffect(
    () => () => {
      if (floorAdvanceTimer.current !== null) window.clearTimeout(floorAdvanceTimer.current);
      if (supplyHintTimer.current !== null) window.clearTimeout(supplyHintTimer.current);
    },
    [],
  );

  useEffect(() => {
    setFloorTranslated(false);
    setFloorWineDetailId(null);
  }, [activeFloorCustomer?.id]);

  // kts-03 ① 출고 목록은 정해진 시간만 보여 준 뒤 자동으로 창고 피킹 화면으로 넘어간다.
  useEffect(() => {
    if (!supplyRun || flowPhase !== "memory" || done) return;
    const timer = window.setInterval(() => {
      setMemoryRemaining((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          setFlowPhase("picking");
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [supplyRun, flowPhase, done]);

  // kts-03 ③ 운반 단계만 제한시간을 둔다. 0이 되면 도착하지 못한 채로 운반을 마감해
  // (도착 판정은 그대로 미달) 다음 단계로 넘어갈 수 있게 한다 — 멈춰 서서 못 넘어가는 상태 방지.
  useEffect(() => {
    if (!supplyRun || flowPhase !== "transport" || transportComplete || done) return;
    const timer = window.setInterval(() => {
      setTransportRemaining((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          setTransportRunning(false);
          setTransportComplete(true);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [supplyRun, flowPhase, transportComplete, done]);

  // 카트의 실제 위치를 기준으로 좌측 하단 출발점 → 우측 상단 매장까지의 진행률과 도착을 판정한다.
  useEffect(() => {
    if (flowPhase !== "transport" || transportComplete || done) return;
    const progress = transportRouteProgress(transportPosition);
    setTransportProgress(progress);
    if (!transportRunning) return;
    const distance = Math.hypot(
      TRANSPORT_DESTINATION.x - transportPosition.x,
      TRANSPORT_DESTINATION.y - transportPosition.y,
    );
    if (distance > 8.5) return;
    setTransportProgress(100);
    setTransportRunning(false);
    setTransportComplete(true);
  }, [flowPhase, transportPosition, transportRunning, transportComplete, done]);

  // 동적 장애물은 카트 속도와 무관한 평상 속도로 좌우 왕복한다. 정적 장애물은 이 값을 사용하지 않는다.
  useEffect(() => {
    if (!supplyRun || flowPhase !== "transport" || !transportRunning || transportComplete || done) return;
    const duration = Math.max(8, supplyRun.transport?.duration_seconds ?? 24);
    const baseStep = 100 / (duration * (1000 / 120));
    const timer = window.setInterval(() => {
      setTransportObstacleProgress((value) => value + baseStep * 1.75);
    }, 120);
    return () => window.clearInterval(timer);
  }, [supplyRun, flowPhase, transportRunning, transportComplete, done]);

  // 장애물 중심과 카트 중심의 거리가 겹치는 순간을 한 번만 충돌로 센다.
  useEffect(() => {
    if (flowPhase !== "transport" || !transportRunning || done) return;
    const hit = transportObstacles.find(
      (obstacle, index) => {
        const layout = transportObstacleLayout[obstacle.id] ?? {
          kind: index < 2 ? "dynamic" : "static",
          x: 24 + index * 11,
          y: 30 + index * 10,
          range: index < 2 ? 24 : 0,
          phase: 0,
        };
        const obstaclePosition = transportObstaclePosition(layout, transportObstacleProgress);
        return (
          !transportHits.includes(obstacle.id) &&
          Math.abs(obstaclePosition.x - transportPosition.x) <= 3.7 &&
          Math.abs(obstaclePosition.y - transportPosition.y) <= 5.5
        );
      },
    );
    if (!hit) return;
    setTransportHits((current) => [...current, hit.id]);
    setTransportCollisions((value) => value + 1);
  }, [
    flowPhase,
    transportRunning,
    transportPosition,
    transportObstacleProgress,
    transportHits,
    transportObstacles,
    transportObstacleLayout,
    done,
  ]);

  // 상하는 한 레인씩 이동하고, 좌우는 키를 누르는 동안 자유롭게 이동한다.
  useEffect(() => {
    if (flowPhase !== "transport" || !transportRunning || transportComplete || done) return;
    const directionOf = (key: string): TransportDirection | null => {
      if (key === "ArrowUp" || key === "w" || key === "W") return "up";
      if (key === "ArrowDown" || key === "s" || key === "S") return "down";
      if (key === "ArrowLeft" || key === "a" || key === "A") return "left";
      if (key === "ArrowRight" || key === "d" || key === "D") return "right";
      return null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = directionOf(event.key);
      if (!direction) return;
      event.preventDefault();
      if (event.repeat) return;
      setTransportPosition((position) => nudgeTransportPosition(position, direction));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [flowPhase, transportRunning, transportComplete, done]);

  // 연결선 색 — 좌 카드 id 마다 고정 색. 선을 다시 그어도 같은 좌 카드면 같은 색이 유지된다.
  const wireColorMap = useMemo(() => {
    const map = new Map<string, string>();
    left.forEach((card, i) => map.set(card.id, WIRE_COLORS[i % WIRE_COLORS.length]));
    return map;
  }, [left]);
  const wireColorOf = (leftId: string) => wireColorMap.get(leftId) ?? WIRE_COLORS[0];

  // ── 채점 파라미터 — 표준 채점 키(_SCHEMA.md)만 읽는다 ──
  const scoringHasKey = (key: string) => typeof game.scoring?.[key] === "number";

  // 분모 — 파일별 명세: judgement_count/decision_count 가 있으면 그 수(도장·폐기·이상치·인계까지
  // 판정으로 센다), 없으면 pair_count(+unmatched_count). kts-02·03·05 는 pairs 만 분모다.
  const judgeTotal = scoringHasKey("judgement_count")
    ? scoringOf(game, "judgement_count", 0)
    : scoringHasKey("decision_count")
      ? scoringOf(game, "decision_count", 0)
      : null;
  const includeExtras = judgeTotal !== null;
  const includeUnmatched = includeExtras || scoringHasKey("unmatched_count");
  const denominator = Math.max(
    1,
    judgeTotal ??
    scoringOf(game, "pair_count", pairs.length) +
    (includeUnmatched ? scoringOf(game, "unmatched_count", unmatchedList.length) : 0),
  );

  const computeSupplyOutcome = () => {
    if (!supplyRun || supplyOrder.length === 0) return { accuracy: 100, incidents: 0, exact: 0 };
    const exact = supplyOrder.filter((item) => (pickedCounts[item.id] ?? 0) === item.target).length;
    const countIncidents = supplyOrder.length - exact;
    const transportPoints = transportComplete ? 30 : 0;
    const accuracy = clampScore(
      (exact / supplyOrder.length) * 70 +
      transportPoints -
      transportCollisions * 12,
    );
    return {
      accuracy,
      incidents: countIncidents + transportCollisions,
      exact,
    };
  };

  /** 최종 상태에서 한 번 채점 — 감점 중첩 금지(사건당 가장 무거운 것 하나). */
  const computeOutcome = (): Outcome => {
    const wrongPairP = scoringOf(game, "wrong_pair_penalty", 12);
    const forbiddenP = scoringOf(game, "forbidden_penalty", 40);
    const hasMatchedUnmatchedP = scoringHasKey("matched_unmatched_penalty");
    const matchedUnmatchedP = scoringOf(game, "matched_unmatched_penalty", wrongPairP);
    const missedUnmatchedP = scoringOf(game, "missed_unmatched_penalty", 0);
    const missedEscalateP = scoringOf(game, "missed_escalate_penalty", 40);
    const earlyEscalateP = scoringOf(game, "early_escalate_penalty", 25);
    const stageSkipP = scoringOf(game, "stage_skip_penalty", 15);
    const ignoreSuddenP = scoringOf(game, "ignore_sudden_penalty", 40);
    const decoyP = scoringOf(game, "decoy_penalty", 15);
    const wrongKeyP = scoringOf(game, "wrong_key_penalty", 10);

    let penalty = 0;
    let incidents = 0;
    const addIncident = (amount: number) => {
      penalty += amount;
      incidents += 1;
    };
    const verdicts: Record<string, "ok" | "bad"> = {};
    const touched = (id: string) => linkedSet.has(id) || Boolean(marks[id]);
    const isEscTarget = (id: string) => escTargets.includes(id);

    // 1) 정답 선 대조 — equivalent 교차 배정 인정, 선 하나는 짝 하나만 충족(중복 크레딧 금지)
    const usedLines = new Set<number>();
    let correctPairs = 0;
    for (const [pl, pr] of pairs) {
      const idx = lines.findIndex((ln, i) => !usedLines.has(i) && eq(ln.left, pl) && eq(ln.right, pr));
      if (idx >= 0) {
        usedLines.add(idx);
        correctPairs += 1;
      }
    }

    // 2) 틀린 선 — 한 선 = 한 사건. 해당되는 감점 후보 중 최댓값 하나만.
    const correctLineKeys: string[] = [];
    lines.forEach((ln, i) => {
      if (usedLines.has(i)) {
        correctLineKeys.push(lineKey(ln));
        verdicts[ln.left] = "ok";
        verdicts[ln.right] = "ok";
        return;
      }
      const candidates = [wrongPairP];
      if (forbiddenPairSet.has(`${ln.left}→${ln.right}`)) candidates.push(forbiddenP);
      // 버려야 할 시안을 손님에게 이어붙임 — 금지행동(stn-01 scoring 주석)
      if (discardSet.has(ln.left) || discardSet.has(ln.right)) candidates.push(forbiddenP);
      if (hasMatchedUnmatchedP && (unmatchedSet.has(ln.left) || unmatchedSet.has(ln.right)))
        candidates.push(matchedUnmatchedP);
      // 인계 대상을 선으로 그냥 통과시킴(ys-03 E) — 방치와 같은 무게
      if (isEscTarget(ln.left) || isEscTarget(ln.right)) candidates.push(missedEscalateP);
      addIncident(Math.max(...candidates));
      verdicts[ln.left] = "bad";
      verdicts[ln.right] = "bad";
    });

    // 3) 카드 단독 판정 — 도장·폐기·인계의 옳고 그름
    let correctStamps = 0;
    let correctDiscards = 0;
    let correctEscalates = 0;
    for (const [id, mark] of Object.entries(marks)) {
      if (mark === "stamped") {
        if (unmatchedSet.has(id)) {
          correctStamps += 1;
          verdicts[id] = "ok";
        } else {
          const candidates = [wrongPairP];
          if (isEscTarget(id)) candidates.push(missedEscalateP);
          addIncident(Math.max(...candidates));
          verdicts[id] = "bad";
        }
      } else if (mark === "discarded") {
        if (discardSet.has(id)) {
          correctDiscards += 1;
          verdicts[id] = "ok";
        } else {
          const candidates = [wrongPairP];
          if (isEscTarget(id)) candidates.push(missedEscalateP);
          addIncident(Math.max(...candidates));
          verdicts[id] = "bad";
        }
      } else if (isEscTarget(id)) {
        correctEscalates += 1;
        verdicts[id] = "ok";
      } else {
        // 엉뚱한 카드를 인계 — 오판정
        addIncident(wrongPairP);
        verdicts[id] = "bad";
      }
    }

    // 4) 방치 — 아무 판정도 받지 않은 카드. 선·도장 사건과 중첩하지 않는다(untouched 만 본다).
    for (const id of unmatchedList) {
      if (touched(id)) continue;
      if (missedUnmatchedP > 0) {
        addIncident(missedUnmatchedP); // stn-04 '조용히 제외' 봉쇄
        verdicts[id] = "bad";
      } else if (includeUnmatched) {
        verdicts[id] = "bad"; // 분자 손실만(ms-02 등 — 감점 키 없음)
      } else {
        verdicts[id] = "ok"; // 남겨두는 것이 정답(kts-02·03·05)
      }
    }
    for (const id of escTargets) {
      if (!touched(id)) {
        addIncident(missedEscalateP); // ys-03 탐지기 반응자 방치
        verdicts[id] = "bad";
      }
    }
    for (const item of discardItems) {
      if (!touched(item.id) && includeExtras) verdicts[item.id] = "bad";
    }

    // 5) 돌발(kts-03) — 응대가 전무하면 ignore 사건 하나로만 채점(중첩 금지).
    //    appears_at 전에 제출해 돌발을 피하는 것도 '응대하지 않고 종료'다.
    if (sudden) {
      if (suddenTimedOut) {
        addIncident(ignoreSuddenP);
      } else {
        const interacted = stagesDone.length > 0 || escalated;
        if (!interacted) {
          addIncident(ignoreSuddenP);
        } else {
          for (const stage of stages) if (!stagesDone.includes(stage.id)) addIncident(stageSkipP); // 생략 — 건당
          for (let i = 0; i < stageViolations; i += 1) addIncident(stageSkipP); // 순서 위반 — 건당
          if (earlyEscalate) addIncident(earlyEscalateP);
          if (Boolean(sudden.persists_after_stages) && !escalated) addIncident(missedEscalateP);
        }
      }
    }

    // 6) 금지 버튼(직접_신체수색·맞대응_언쟁 등) — 누른 것마다 사건 1
    for (let i = 0; i < pressedForbidden.length; i += 1) addIncident(forbiddenP);

    // 7) 구슬 — 이상치는 분자, 정상·decoy 클릭은 개당 감점(stn-03)
    let caught = 0;
    for (const outlier of outliers) if (beadClicks[outlier.id] === "caught") caught += 1;
    for (const judged of Object.values(beadClicks)) if (judged === "wrong") addIncident(decoyP);

    // 8) 객실 키 — 색이 틀리면 건당 감점(kts-05). 키는 분모에 없다(감점 전용).
    for (const key of keyDefs) {
      const given = keysGiven[key.guest];
      if (linkedSet.has(key.guest) && given && given !== key.key_color) addIncident(wrongKeyP);
    }

    const numerator =
      correctPairs +
      (includeUnmatched ? correctStamps : 0) +
      (includeExtras ? correctDiscards + caught + correctEscalates : 0);
    const matchAccuracy = clampScore((numerator / denominator) * 100 - penalty);
    const supply = computeSupplyOutcome();
    const supplyWeight = supplyRun
      ? Math.min(0.8, Math.max(0.1, scoringOf(game, "supply_weight", 35) / 100))
      : 0;
    const accuracy = data.supply_only
      ? supply.accuracy
      : supplyRun
        ? clampScore(supply.accuracy * supplyWeight + matchAccuracy * (1 - supplyWeight))
        : matchAccuracy;
    incidents = data.supply_only ? supply.incidents : incidents + (supplyRun ? supply.incidents : 0);
    return {
      accuracy,
      matchAccuracy,
      supplyAccuracy: supplyRun ? supply.accuracy : undefined,
      penalty,
      incidents,
      numerator,
      denominator,
      correctLineKeys,
      cardVerdicts: verdicts,
    };
  };

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const scored = computeOutcome();
    setOutcome(scored);
    setDone(true);
    onComplete({ accuracy: scored.accuracy, time_seconds: elapsedSeconds(startedAt), mistakes: scored.incidents });
  };

  const { remaining, startedAt } = useCountdown(game.time_limit, done, () => finish());

  // 돌발 등장 — 출고·운반 프롤로그가 끝나고 고객 응대 화면이 열린 시점부터 센다.
  useEffect(() => {
    if (!sudden || done || flowPhase !== "customer") return;
    const delay = Math.max(0, (sudden.appears_at ?? 0) * 1000);
    const timer = window.setTimeout(() => {
      setFloorWineDetailId(null);
      setSuddenResponseRemaining(30);
      setSuddenTimedOut(false);
      setSuddenDismissed(false);
      setSuddenVisible(true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [sudden, done, flowPhase]);

  // kts-03 돌발 손님은 최종 배치 전체가 함께 들어오며, 도착 모션이 끝난 뒤에만 클릭할 수 있다.
  useEffect(() => {
    if (!customerFloor || !suddenVisible) {
      setSuddenArrived(false);
      return;
    }
    setSuddenArrived(false);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const timer = window.setTimeout(() => setSuddenArrived(true), reduceMotion ? 0 : 850);
    return () => window.clearTimeout(timer);
  }, [customerFloor, suddenVisible, sudden?.id]);

  // ── 일괄 제출 — 자동 종료 없음(디자이너 확정). 전판을 판정해도 '제출'을 눌러야 채점하고,
  //    시간 만료(useCountdown)만 예외로 즉시 채점한다. 아래 값들은 제출 버튼 강조·안내용 신호다.
  const allResolved =
    left.length + right.length > 0 &&
    [...left, ...right].every((card) => linkedSet.has(card.id) || Boolean(marks[card.id]));
  const caughtCount = outliers.filter((o) => beadClicks[o.id] === "caught").length;
  const streamDone = outliers.length === 0 || caughtCount === outliers.length;
  const stagesAllDone = stages.every((s) => stagesDone.includes(s.id));
  const suddenChoiceCount = stagesDone.length + pressedForbidden.length + (escalated ? 1 : 0);
  const customerSuddenChoiceComplete = customerFloor && suddenChoiceCount >= 4;
  const suddenSettled =
    suddenTimedOut ||
    customerSuddenChoiceComplete ||
    (stagesAllDone && (!sudden?.persists_after_stages || escalated));
  const suddenGate = !sudden || (suddenVisible && suddenSettled);
  const keysDone =
    keyDefs.length === 0 || left.every((card) => !linkedSet.has(card.id) || Boolean(keysGiven[card.id]));
  const readyToSubmit = !done && allResolved && streamDone && suddenGate && keysDone;

  useEffect(() => {
    if (!customerFloor || !suddenVisible || !suddenSettled || suddenFocused) {
      setSuddenDismissed(false);
      return;
    }
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const timer = window.setTimeout(() => setSuddenDismissed(true), reduceMotion ? 0 : 680);
    return () => window.clearTimeout(timer);
  }, [customerFloor, suddenFocused, suddenSettled, suddenVisible]);

  useEffect(() => {
    if (!customerFloor || !suddenVisible || done || suddenSettled) return;
    if (suddenResponseRemaining <= 0) {
      setSuddenTimedOut(true);
      setSuddenFocused(false);
      return;
    }
    const timer = window.setTimeout(
      () => setSuddenResponseRemaining((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [customerFloor, done, suddenResponseRemaining, suddenSettled, suddenVisible]);

  useEffect(() => {
    if (!customerFloor || !suddenFocused || suddenChoiceCount < 4) return;
    const timer = window.setTimeout(() => setSuddenFocused(false), 420);
    return () => window.clearTimeout(timer);
  }, [customerFloor, suddenChoiceCount, suddenFocused]);

  // ── 선 좌표 측정 — 카드 버튼의 모서리 중앙을 보드 기준 픽셀로 잰다 ──
  const boardRef = useRef<HTMLDivElement | null>(null);
  const cardEls = useRef(new Map<string, { el: HTMLElement; side: Side }>());
  const [anchors, setAnchors] = useState<Record<string, Anchor>>({});

  const measure = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const base = board.getBoundingClientRect();
    const next: Record<string, Anchor> = {};
    for (const [id, entry] of cardEls.current) {
      const rect = entry.el.getBoundingClientRect();
      next[id] = {
        x: (entry.side === "left" ? rect.right : rect.left) - base.left,
        y: rect.top + rect.height / 2 - base.top,
      };
    }
    setAnchors((prev) => (sameAnchors(prev, next) ? prev : next)); // 동일하면 재렌더 없음
  }, []);

  useLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    const board = boardRef.current;
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" || !board ? null : new ResizeObserver(measure);
    observer?.observe(board as Element);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [measure]);

  const registerCard = (id: string, side: Side) => (el: HTMLButtonElement | null) => {
    if (el) cardEls.current.set(id, { el, side });
    else cardEls.current.delete(id);
  };

  // 임시선 — 카드를 하나 고른 상태에서 포인터를 따라오는 점선. 좌표는 보드 기준 픽셀.
  const [cursor, setCursor] = useState<Anchor | null>(null);
  const trackPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (done || !selected) return;
    const base = boardRef.current?.getBoundingClientRect();
    if (!base) return;
    setCursor({ x: event.clientX - base.left, y: event.clientY - base.top });
  };

  // ── 조작 ──
  const toggleCard = (side: Side, id: string) => {
    if (done) return;
    const mark = marks[id];
    if (mark === "escalated") return; // 인계는 불가역 — 선임에게 넘어갔다
    if (mark) {
      // 도장·폐기 해제
      setMarks((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    const joined = lines.find((l) => l.left === id || l.right === id);
    if (joined) {
      // 연결된 카드 클릭 = 선 해제
      setLines((prev) => prev.filter((l) => l !== joined));
      return;
    }
    if (!selected) {
      setSelected({ side, id });
      return;
    }
    if (selected.id === id) {
      setSelected(null);
      return;
    }
    if (selected.side === side) {
      setSelected({ side, id });
      return;
    }
    const l = side === "left" ? id : selected.id;
    const r = side === "right" ? id : selected.id;
    // 카드당 선 1개 — 새 선이 양끝의 기존 선을 대체한다(one_line_per_left 포함 규칙)
    setLines((prev) => [...prev.filter((ln) => ln.left !== l && ln.right !== r), { left: l, right: r }]);
    setSelected(null);
  };

  const matchFloorWine = (wineId: string) => {
    if (done || !activeFloorCustomer || floorMatchFlash) return;
    const usedByOther = lines.some(
      (line) => line.right === wineId && line.left !== activeFloorCustomer.id,
    );
    if (usedByOther) return;

    const nextLines = [
      ...lines.filter((line) => line.left !== activeFloorCustomer.id && line.right !== wineId),
      { left: activeFloorCustomer.id, right: wineId },
    ];
    setLines(nextLines);
    setSelected(null);
    setFloorMatchFlash(true);

    if (floorAdvanceTimer.current !== null) window.clearTimeout(floorAdvanceTimer.current);
    floorAdvanceTimer.current = window.setTimeout(() => {
      const nextUnresolved = displayLeft.findIndex(
        (customer, index) =>
          index !== floorCustomerIndex && !nextLines.some((line) => line.left === customer.id),
      );
      if (nextUnresolved >= 0) setFloorCustomerIndex(nextUnresolved);
      setFloorMatchFlash(false);
      floorAdvanceTimer.current = null;
    }, 650);
  };

  const markSelected = (mark: CardMark) => {
    if (done || !selected) return;
    const id = selected.id;
    setMarks((prev) => ({ ...prev, [id]: mark }));
    setSelected(null);
  };

  const pressStage = (stageId: string) => {
    if (done || stagesDone.includes(stageId)) return;
    if (!customerFloor) {
      const idx = stages.findIndex((s) => s.id === stageId);
      const prevOk = stages.slice(0, Math.max(0, idx)).every((s) => stagesDone.includes(s.id));
      if (!prevOk) setStageViolations((v) => v + 1);
    }
    setStagesDone((prev) => [...prev, stageId]);
  };

  const pressStateEscalate = () => {
    if (done || escalated) return;
    if (!customerFloor) {
      const requires = data.escalate?.requires ?? stages.map((s) => s.id);
      if (requires.some((id) => !stagesDone.includes(id))) setEarlyEscalate(true);
    }
    setEscalated(true);
  };

  const pressForbiddenButton = (id: string) => {
    if (done || pressedForbidden.includes(id)) return;
    setPressedForbidden((prev) => [...prev, id]);
    // 즉각 제지 피드백(2026-07-20 디자이너 확정) — 감점은 기존대로 최종 채점에서 반영되고,
    // 여기서는 '방금 누른 것이 금지행동'임을 그 자리에서 알린다. 문구는 누른 뒤에만 나오므로
    // 정답 사전 유출이 아니다(ms-10 금지 오브젝트 클릭 피드백과 같은 패턴).
    const src =
      (data.forbidden ?? []).find((f) => f.id === id) ??
      (sudden?.forbidden_actions ?? []).find((f) => f.id === id);
    if (!customerFloor) {
      setForbiddenWarning({ id, reason: src?.reason ?? "지금 해서는 안 되는 행동입니다", tick: Date.now() });
    }
  };

  const clickBead = (id: string, kind: "normal" | "outlier" | "decoy") => {
    if (done || beadClicks[id]) return;
    setBeadClicks((prev) => ({ ...prev, [id]: kind === "outlier" ? "caught" : "wrong" }));
  };

  const giveKey = (guest: string, color: string) => {
    if (done) return;
    setKeysGiven((prev) => ({ ...prev, [guest]: color }));
  };

  const changeSupplyCount = (item: SupplyOrderItem, delta: 1 | -1) => {
    if (done || flowPhase !== "picking") return;
    setPickedCounts((current) => ({
      ...current,
      [item.id]:
        delta > 0
          ? Math.min(item.target + 4, (current[item.id] ?? 0) + 1)
          : Math.max(0, (current[item.id] ?? 0) - 1),
    }));
  };

  const showSupplyHint = () => {
    if (done || flowPhase !== "picking") return;
    // 힌트는 총 SUPPLY_HINT_LIMIT회까지만 — 무제한이면 목록을 기억할 이유가 없어져
    // 이 게임의 취지(기억력)가 사라진다. 표시 중 재클릭은 횟수를 더 쓰지 않는다.
    if (supplyHintVisible) return;
    if (supplyHintUsed >= SUPPLY_HINT_LIMIT) return;
    setSupplyHintUsed((n) => n + 1);
    if (supplyHintTimer.current !== null) window.clearTimeout(supplyHintTimer.current);
    setSupplyHintVisible(true);
    supplyHintTimer.current = window.setTimeout(() => {
      setSupplyHintVisible(false);
      supplyHintTimer.current = null;
    }, 3000);
  };

  const startTransport = () => {
    if (done) return;
    setFlowPhase("transport");
    setTransportRemaining(TRANSPORT_SECONDS);
    setTransportRunning(false);
    setTransportPosition(TRANSPORT_START);
    setTransportProgress(0);
    setTransportObstacleProgress(0);
    setTransportObstacleLayout(createTransportObstacleLayout(transportObstacles));
    setTransportComplete(false);
    setTransportHits([]);
    setTransportCollisions(0);
  };

  const startDriving = () => {
    if (done || transportComplete) return;
    setTransportPosition(TRANSPORT_START);
    setTransportProgress(0);
    setTransportObstacleProgress(0);
    setTransportRunning(true);
    window.requestAnimationFrame(() => transportRoadRef.current?.focus());
  };

  const enterCustomerFloor = () => {
    if (done || !transportComplete) return;
    if (data.supply_only) {
      finish();
      return;
    }
    setFlowPhase("customer");
    setSuddenVisible(false);
    setSuddenArrived(false);
    setSuddenFocused(false);
  };

  // ── 표시 도우미 ──
  const stampLabel = data.unmatched_action ? pretty(data.unmatched_action) : "짝 없음";
  const binLabel = data.discard?.bin ?? "휴지통";
  // 컬럼 헤더 — 데이터에 left_label/right_label 이 있으면 그대로, 없으면 중립 라벨(하드코딩 금지).
  const leftHead = data.left_label?.trim() || "왼쪽";
  const rightHead = data.right_label?.trim() || "오른쪽";
  const stateOf = (id: string): string | undefined =>
    marks[id] ?? (linkedSet.has(id) ? "linked" : selected?.id === id ? "selected" : undefined);
  const verdictOf = (id: string) => (done && outcome ? outcome.cardVerdicts[id] : undefined);
  const resolvedCount = Math.min(denominator, lines.length + Object.keys(marks).length + caughtCount);

  // ── 카드 밀도 — 가장 긴 열의 카드 수로 정한다. 카드가 많은 판(kts-02 8·kts-03 7·kts-05 6·
  //    ms-02 15)은 세로 패딩·행 간격·라벨·스프라이트를 조여 한 화면에 더 담고, 남으면 스크롤과
  //    병행한다(스크롤은 전역 처리). 표시 밀도만 바꿀 뿐 셔플·선긋기·판정·채점 계약은 전부 불변. ──
  const tallestColumn = Math.max(left.length, right.length);
  const density = tallestColumn >= 12 ? "dense" : tallestColumn >= 6 ? "compact" : "normal";
  const cardSpriteSize = density === "dense" ? 34 : density === "compact" ? 38 : 46;

  const cardAria = (card: MatchCard, side: Side) => {
    const mark = marks[card.id];
    const state =
      mark === "stamped"
        ? `, ${stampLabel} 도장됨 — 클릭하면 해제`
        : mark === "discarded"
          ? `, ${binLabel}에 버림 — 클릭하면 복구`
          : mark === "escalated"
            ? ", 인계됨"
            : linkedSet.has(card.id)
              ? ", 선 연결됨 — 클릭하면 해제"
              : selected?.id === card.id
                ? ", 선택됨"
                : "";
    return `${side === "left" ? leftHead : rightHead} 카드 ${card.sprite}${card.label ? `, ${card.label}` : ""}${card.detector ? ", 탐지기 반응" : ""
      }${state}`;
  };

  const renderCard = (card: MatchCard, side: Side) => {
    const verdict = verdictOf(card.id);
    const mark = marks[card.id];
    const cue = data.visual_cues?.[card.id];
    return (
      <div key={card.id} className={styles.cardCell}>
        <button
          type="button"
          ref={registerCard(card.id, side)}
          className={styles.card}
          data-state={stateOf(card.id)}
          data-detector={card.detector || undefined}
          data-verdict={verdict}
          aria-pressed={selected?.id === card.id}
          aria-label={cardAria(card, side)}
          disabled={done || mark === "escalated"}
          onClick={() => toggleCard(side, card.id)}
        >
          <PixelSprite id={card.sprite} label={card.sprite} size={cardSpriteSize} fallbackClassName={styles.cardSprite} />
          {card.label ? <span className={styles.cardLabel}>{card.label}</span> : null}
          {cue ? <span className={styles.cardCue}>{pretty(cue)}</span> : null}
          {card.detector ? <span className={styles.lamp} aria-hidden="true" /> : null}
          {mark === "stamped" ? <span className={styles.stampBadge}>{stampLabel}</span> : null}
          {mark === "discarded" ? (
            <span className={styles.stampBadge} data-kind="discard">
              {binLabel}
            </span>
          ) : null}
          {mark === "escalated" ? (
            <span className={styles.stampBadge} data-kind="escalate">
              인계
            </span>
          ) : null}
          {verdict ? (
            <span className={common.mark} data-kind={verdict === "ok" ? "hit" : undefined} aria-hidden="true">
              {verdict === "ok" ? "✓" : "✕"}
            </span>
          ) : null}
        </button>
        {side === "left" && keyDefs.length > 0 && linkedSet.has(card.id) ? (
          <div className={styles.keyRow} role="group" aria-label={`${card.sprite} 객실 키 선택`}>
            <span className={styles.keyHint}>객실 키</span>
            {keyPalette.map((color) => {
              const keySprite = keySpriteOf.get(color);
              return (
                <button
                  key={color}
                  type="button"
                  className={styles.keyDot}
                  style={{ background: KEY_COLORS[color] ?? "#8a93a8" }}
                  data-sprite={keySprite ? "true" : undefined}
                  data-active={keysGiven[card.id] === color}
                  aria-label={`${color} 키 전달`}
                  aria-pressed={keysGiven[card.id] === color}
                  disabled={done}
                  onClick={() => giveKey(card.id, color)}
                >
                  {/* 색 배경(인라인)은 항상 깔린다 — 아트 파일이 없으면 폴백 스팬이 숨어
                      기존 색 원 표시가 그대로 남는다(PixelSprite 폴백 규약). */}
                  {keySprite ? (
                    <PixelSprite id={keySprite} label={color} size={20} fallbackClassName={styles.spriteFallbackHidden} />
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  const renderFloorCustomer = (card: MatchCard) => {
    const verdict = verdictOf(card.id);
    const linkedWineId = lines.find((line) => line.left === card.id)?.right;
    const linkedWine = linkedWineId ? right.find((wine) => wine.id === linkedWineId) : undefined;
    const customerSpeech = card.foreign
      ? floorTranslated
        ? card.translated_speech ?? card.speech
        : card.foreign_speech ?? card.speech
      : card.speech;
    return (
      <article
        key={card.id}
        className={styles.customerFloorCustomer}
        data-state={stateOf(card.id)}
        data-verdict={verdict}
        data-matched={floorMatchFlash && linkedWine ? "true" : undefined}
        aria-label={`${floorCustomerIndex + 1}번 손님 — ${card.label ?? pretty(card.id)}`}
      >
        <span className={styles.customerFloorBubble} data-linked={linkedWine ? "true" : undefined}>
          <span className={styles.customerFloorRequest}>
            <span>{customerSpeech ?? card.label ?? pretty(card.id)}</span>
          </span>
        </span>
        <span
          className={styles.customerFloorCutout}
          data-sprite={card.customer_sprite ?? card.sprite}
        >
          <PixelSprite
            id={card.customer_sprite ?? card.sprite}
            label={`${card.label ?? pretty(card.id)} 손님`}
            size={230}
            smooth
          />
        </span>
        {verdict ? (
          <span className={common.mark} data-kind={verdict === "ok" ? "hit" : undefined} aria-hidden="true">
            {verdict === "ok" ? "✓" : "✕"}
          </span>
        ) : null}
      </article>
    );
  };

  const renderFloorWine = (card: MatchCard) => {
    const verdict = verdictOf(card.id);
    const mark = marks[card.id];
    const cue = data.visual_cues?.[card.id];
    const linkedOwner = lines.find((line) => line.right === card.id)?.left;
    const usedByOtherCustomer = Boolean(
      linkedOwner && activeFloorCustomer && linkedOwner !== activeFloorCustomer.id,
    );
    const wineColor =
      card.accent ??
      (card.kind === "white"
        ? "#0bd01f"
        : card.kind === "sweet"
          ? "#fff019"
          : card.kind === "rose"
            ? "#f235a8"
            : card.kind === "sparkling"
              ? "#c3ff8a"
              : "#9a0450");
    return (
      <button
        key={card.id}
        type="button"
        ref={registerCard(card.id, "right")}
        className={styles.customerFloorWine}
        data-state={stateOf(card.id)}
        data-used={usedByOtherCustomer || undefined}
        data-verdict={verdict}
        data-kind={card.kind}
        data-tier={card.tier}
        data-stock={card.stock}
        data-detail={floorWineDetailId === card.id || undefined}
        style={{ "--wine-color": wineColor } as CSSProperties}
        aria-pressed={selected?.id === card.id}
        aria-label={cardAria(card, "right")}
        disabled={done || mark === "escalated" || floorMatchFlash || usedByOtherCustomer}
        onClick={() => (customerFloor ? setFloorWineDetailId(card.id) : toggleCard("right", card.id))}
      >
        <PixelSprite id={card.sprite} label={card.label ?? card.sprite} size={92} smooth />
        <span className={styles.customerFloorWineInfo}>
          <strong>{card.label ?? pretty(card.id)}</strong>
          {cue ? <small>{pretty(cue)}</small> : null}
        </span>
        {mark === "stamped" ? <em>{stampLabel}</em> : null}
      </button>
    );
  };

  const supplyTargetTotal = supplyOrder.reduce((sum, item) => sum + item.target, 0);
  const supplyPickedTotal = supplyOrder.reduce((sum, item) => sum + (pickedCounts[item.id] ?? 0), 0);
  const supplyStep = flowPhase === "memory" ? 1 : flowPhase === "picking" ? 2 : flowPhase === "transport" ? 3 : 4;
  const supplyStepLabels = data.supply_only
    ? ["목록 확인", "창고 피킹", "안전 운반"]
    : ["목록 확인", "창고 피킹", "안전 운반", "고객 응대"];
  const supplyHudCount =
    flowPhase === "picking"
      ? supplyPickedTotal
      : flowPhase === "transport"
        ? Math.round(transportProgress)
        : supplyStep;
  const supplyHudTotal =
    flowPhase === "picking" ? supplyTargetTotal : flowPhase === "transport" ? 100 : supplyStepLabels.length;
  const warehouseBackground = `${import.meta.env.BASE_URL}assets/minigames/backgrounds/cartoon-day-v3/kts-03-background-wine-warehouse-cartoon-day-v3.webp`;
  const cartRouteBackground = `${import.meta.env.BASE_URL}assets/minigames/backgrounds/cartoon-day-v3/kts-03-background-cart-route-cartoon-day-v1.webp`;
  const wineServiceCart = `${import.meta.env.BASE_URL}assets/minigames/kts-03-wine-service-cart-cartoon-v1.webp`;
  const cartStartMarker = `${import.meta.env.BASE_URL}assets/minigames/ui/kts-03-cart-start-marker-cartoon-v1.webp`;
  const cartDestinationMarker = `${import.meta.env.BASE_URL}assets/minigames/ui/kts-03-cart-destination-marker-cartoon-v1.webp`;
  const supplyBoardStyle = {
    "--supply-background": `url("${flowPhase === "transport" ? cartRouteBackground : warehouseBackground}")`,
  } as CSSProperties;
  const cargoState = transportCollisions > 0 ? "충격 발생" : "안정";

  if (supplyRun && flowPhase !== "customer") {
    return (
      <div className={common.shell} data-supply-flow="true">
        <GameHud
          label={
            flowPhase === "memory"
              ? "출고 목록 확인" // 남은 초는 타이머 바와 원형 카운터가 보여준다(라벨 중복 제거)
              : flowPhase === "picking"
                ? `피킹 수량 ${supplyPickedTotal}병`
                : `카트 운반 ${Math.round(transportProgress)}%`
          }
          count={supplyHudCount}
          total={supplyHudTotal}
          // 암기(10초)·운반(60초)만 제한시간이 있다. 피킹은 제한 없음(타이머 바도 숨김).
          remaining={
            flowPhase === "memory"
              ? memoryRemaining
              : flowPhase === "transport"
                ? transportRemaining
                : null
          }
          timeLimit={
            flowPhase === "memory"
              ? memorySeconds
              : flowPhase === "transport"
                ? TRANSPORT_SECONDS
                : null
          }
          // 라벨이 이미 진행 상황("피킹 수량 n병" 등)을 말해주고, 하단 수량 패널에도
          // 같은 정보가 있어 n/N 카운트는 중복이다.
          showCount={false}
        />

        <div
          className={styles.supplyBoard}
          data-phase={flowPhase}
          data-hint-visible={flowPhase === "picking" && supplyHintVisible ? "true" : undefined}
          style={supplyBoardStyle}
          role="group"
          aria-label={
            flowPhase === "memory"
              ? "출고 목록 기억하기"
              : flowPhase === "picking"
                ? "창고에서 와인 피킹하기"
                : "카트로 와인 안전 운반하기"
          }
        >
          {flowPhase === "memory" ? (
            <>
              <section className={styles.supplyMemoryCard} aria-label="오늘의 출고 목록">
                <header>
                  <strong>List</strong>
                </header>
                <ul>
                  {supplyOrder.map((item) => (
                    <li key={item.id}>
                      <span>{item.display_label ?? item.label}</span>
                      <b>X {item.target}</b>
                    </li>
                  ))}
                </ul>
              </section>
              <p className={styles.supplyMemoryPrompt}>시간내에 외우시오</p>
              <div
                key={memoryRemaining}
                className={styles.supplyMemoryCountdown}
                role="timer"
                aria-live="assertive"
                aria-label={`목록 암기 시간 ${memoryRemaining}초 남음`}
              >
                <strong>{memoryRemaining}</strong>
              </div>
            </>
          ) : null}

          {flowPhase === "picking" ? (
            <>
              <p className={styles.supplyInstruction}>
                와인 상자 클릭 → 좌클릭: 증가 | 우클릭: 감소
              </p>
              <div className={styles.supplyPickScene}>
                {supplyOrder.map((item) => (
                  <div key={item.id} className={styles.supplyPickGroup}>
                    <button
                      type="button"
                      className={styles.supplyPickItem}
                      data-item={item.id}
                      style={{
                        left: `${((item.hit_at ?? item.at)[0] / 960) * 100}%`,
                        top: `${((item.hit_at ?? item.at)[1] / 440) * 100}%`,
                        "--hit-width": `${item.hit_size?.[0] ?? 40}px`,
                        "--hit-height": `${item.hit_size?.[1] ?? 65}px`,
                      } as CSSProperties}
                      disabled={done}
                      aria-label={`${item.label} 상자, 좌클릭으로 한 병 담기, 우클릭으로 한 병 빼기, 현재 ${pickedCounts[item.id] ?? 0}병`}
                      onClick={() => changeSupplyCount(item, 1)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        changeSupplyCount(item, -1);
                      }}
                    >
                      <span className={styles.supplyBoxName}>{item.display_label ?? item.label}</span>
                      {supplyHintVisible ? <b className={styles.supplyBoxCount}>× {item.target}</b> : null}
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className={styles.supplyHintButton}
                aria-label={
                  supplyHintVisible
                    ? "와인 수량 힌트 표시 중"
                    : `필요한 와인 수량 힌트 보기 — ${SUPPLY_HINT_LIMIT - supplyHintUsed}회 남음`
                }
                aria-pressed={supplyHintVisible}
                disabled={supplyHintUsed >= SUPPLY_HINT_LIMIT && !supplyHintVisible}
                onClick={showSupplyHint}
              >
                <span aria-hidden="true">💡</span>
                <small>
                  힌트 {SUPPLY_HINT_LIMIT - supplyHintUsed}/{SUPPLY_HINT_LIMIT}
                </small>
              </button>
              <section className={styles.supplyCounter} aria-label="현재 카트에 담은 와인 수량">
                <div>
                  {supplyOrder.map((item) => (
                    <article key={item.id}>
                      <span>{item.display_label ?? item.label}</span>
                      <b>{pickedCounts[item.id] ?? 0}</b>
                    </article>
                  ))}
                </div>
                <button
                  type="button"
                  className={styles.supplyPrimary}
                  disabled={done || supplyPickedTotal === 0}
                  onClick={startTransport}
                >
                  운반하기
                </button>
              </section>
            </>
          ) : null}

          {flowPhase === "transport" ? (
            <>
              {transportRunning || transportComplete ? (
                <p className={styles.supplyInstruction}>방향키로 한 칸씩 움직여 보세요.</p>
              ) : null}
              <div
                ref={transportRoadRef}
                className={styles.supplyRoad}
                aria-label="카트 운반 통로"
                tabIndex={0}
              >
                <div className={styles.supplyLaneGrid} aria-hidden="true">
                  {Array.from({ length: TRANSPORT_ROW_COUNT * TRANSPORT_COLUMN_COUNT }, (_, index) => (
                    <span key={`transport-cell-${index}`} />
                  ))}
                </div>
                <span
                  className={styles.supplyStartPoint}
                  style={{ left: "0%", top: "100%" }}
                  aria-label="창고 출발지"
                >
                  <img src={cartStartMarker} alt="" draggable={false} />
                </span>
                <span
                  className={styles.supplyFinishLine}
                  style={{ left: "100%", top: "0%" }}
                  aria-label="매장 도착지"
                >
                  <img src={cartDestinationMarker} alt="" draggable={false} />
                </span>
                {transportObstacles.map((obstacle, index) => {
                  const layout = transportObstacleLayout[obstacle.id] ?? {
                    kind: index < 2 ? "dynamic" : "static",
                    x: 24 + index * 11,
                    y: 30 + index * 10,
                    range: index < 2 ? 24 : 0,
                    phase: 0,
                  };
                  const obstaclePosition = transportObstaclePosition(layout, transportObstacleProgress);
                  return (
                    <span
                      key={obstacle.id}
                      className={styles.supplyObstacle}
                      data-kind={layout.kind}
                      data-hit={transportHits.includes(obstacle.id) || undefined}
                      style={{
                        left: `${obstaclePosition.x}%`,
                        top: `${obstaclePosition.y}%`,
                      }}
                      aria-label={obstacle.label}
                    >
                      <PixelSprite id={obstacle.sprite} label="" size={76} smooth />
                      <small>{obstacle.label}</small>
                    </span>
                  );
                })}
                <div
                  className={styles.supplyCart}
                  data-hit={transportCollisions > 0 || undefined}
                  style={{ left: `${transportPosition.x}%`, top: `${transportPosition.y}%` }}
                  aria-label={`와인 카트, 가로 ${Math.round(transportPosition.x)}%, 세로 ${Math.round(transportPosition.y)}%`}
                >
                  <img src={wineServiceCart} alt="" draggable={false} />
                </div>
                {!transportRunning && !transportComplete && transportProgress === 0 ? (
                  <div className={styles.supplyTransportIntro}>
                    <strong>백화점 매장 운반</strong>
                    <p>방향키를 한 번 누를 때마다 상하좌우로 한 칸 이동합니다.</p>
                    <p>7개 통로와 13개 칸을 건너며 움직이는 손님과 적재품을 피해 매장까지 이동하세요.</p>
                    <button type="button" className={styles.supplyPrimary} onClick={startDriving}>
                      운반 시작
                    </button>
                  </div>
                ) : null}
              </div>

              <section className={styles.supplyDrivePanel}>
                <div className={styles.supplyDriveStatus}>
                  <span>
                    적재 상태 <b data-state={cargoState}>{cargoState}</b>
                  </span>
                  <span>
                    충돌 <b>{transportCollisions}</b>회
                  </span>
                </div>
              </section>

              {transportComplete ? (
                <div className={styles.supplyComplete} role="status">
                  <strong>{transportCollisions === 0 ? "매장까지 운반 완료!" : "운반 완료 · 충격 기록 확인"}</strong>
                  <span>
                    {data.supply_only
                      ? "출고 결과를 확인한 뒤 별도의 고객 응대 게임으로 이동합니다."
                      : "이제 손님의 니즈에 맞는 와인을 추천하세요."}
                  </span>
                  <button type="button" className={styles.supplyPrimary} disabled={done} onClick={enterCustomerFloor}>
                    {data.supply_only ? "출고 게임 완료" : "고객 응대 시작 →"}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {done && outcome ? (
          <ResultBar score={outcome.accuracy}>
            출고·운반 <b>{outcome.supplyAccuracy ?? 0}점</b>
            {outcome.incidents > 0 ? <> · 실수 <b>{outcome.incidents}건</b></> : <> · 실수 <b>없음</b></>}
          </ResultBar>
        ) : null}
      </div>
    );
  }

  return (
    <div className={common.shell}>
      <GameHud
        label={
          customerFloor
            ? `추천 ${lines.length} · 확인 필요 ${Math.max(0, pairs.length - lines.length)}`
            : `연결 ${lines.length} · 도장 ${Object.keys(marks).length}`
        }
        count={resolvedCount}
        total={denominator}
        remaining={remaining}
        timeLimit={game.time_limit}
        // 손님 응대(kts-03)는 라벨의 "추천 n · 확인 필요 n"이 곧 진행도라 n/N이 중복이다.
        // 다른 매칭 게임(연결·도장)은 그대로 카운트를 보여준다.
        showCount={!customerFloor}
      />

      <div
        className={styles.board}
        data-density={density}
        data-layout={customerFloor ? "customer-floor" : undefined}
        data-sudden-focused={customerFloor && suddenFocused ? "true" : undefined}
        ref={boardRef}
        role="group"
        aria-label={`매칭 보드 — ${leftHead} 카드와 ${rightHead} 카드를 이으세요`}
        onPointerMove={trackPointer}
        onPointerLeave={() => setCursor(null)}
      >
        <svg className={styles.wires} aria-hidden="true">
          {lines.map((ln) => {
            const a = anchors[ln.left];
            const b = anchors[ln.right];
            if (!a || !b) return null;
            const key = lineKey(ln);
            const color = wireColorOf(ln.left);
            return (
              <g
                key={key}
                className={styles.wireGroup}
                data-verdict={done && outcome ? (outcome.correctLineKeys.includes(key) ? "ok" : "bad") : undefined}
              >
                <line className={styles.wire} stroke={color} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                <circle className={styles.wireDot} fill={color} cx={a.x} cy={a.y} r={4} />
                <circle className={styles.wireDot} fill={color} cx={b.x} cy={b.y} r={4} />
              </g>
            );
          })}
          {!done && selected && cursor && anchors[selected.id] ? (
            <line
              className={styles.wirePreview}
              stroke={selected.side === "left" ? wireColorOf(selected.id) : WIRE_NEUTRAL}
              x1={anchors[selected.id].x}
              y1={anchors[selected.id].y}
              x2={cursor.x}
              y2={cursor.y}
            />
          ) : null}
        </svg>
        {customerFloor ? (
          <>
            <section className={styles.customerFloorWineShelf} aria-label={`${rightHead} 우측 진열대`}>
              <div className={styles.customerFloorLegend} aria-label="와인 색상 범례">
                {[
                  [
                    ["red", "Red wine"],
                    ["white", "White wine"],
                    ["sweet", "Sweet wine"],
                  ],
                  [
                    ["rose", "Rose wine"],
                    ["sparkling", "Sparkling wine"],
                  ],
                ].map((row, rowIndex) => (
                  <div className={styles.customerFloorLegendRow} key={`legend-row-${rowIndex}`}>
                    {row.map(([kind, label]) => (
                      <span key={kind} data-kind={kind}>
                        <i aria-hidden="true" />
                        {label}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
              {[
                ["premium", "Premium Selections"],
                ["favorite", "House Favorites"],
                ["house", "House Wines"],
              ].map(([tier, label]) => (
                <section key={tier} className={styles.customerFloorWineGroup} data-tier={tier}>
                  <div className={styles.customerFloorWineSlots}>
                    {displayRight
                      .filter((wine) => (wine.tier ?? "house") === tier)
                      .sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99))
                      .map(renderFloorWine)}
                  </div>
                  <h3>{label}</h3>
                </section>
              ))}
            </section>
            <section className={styles.customerFloorCast} aria-label={`${leftHead} 손님 한 명씩 응대`}>
              {activeFloorCustomer ? renderFloorCustomer(activeFloorCustomer) : null}
              <aside
                className={styles.customerFloorBrief}
                data-foreign={activeFloorForeign || undefined}
                data-sudden-active={(suddenVisible && !suddenDismissed) || undefined}
                data-returning={suddenDismissed || undefined}
              >
                <strong>{activeFloorForeign ? "외국인 고객 응대" : "손님 응대"}</strong>
                <span>
                  {activeFloorForeign
                    ? "고객의 언어를 이해하기 어렵다면 번역 기능으로 요청을 확인하세요."
                    : "말풍선의 상황·예산·취향을 확인하고 우측 진열대에서 와인을 추천하세요."}
                </span>
                {activeFloorForeign ? (
                  <button
                    type="button"
                    className={styles.customerFloorBriefTranslate}
                    onClick={() => setFloorTranslated((value) => !value)}
                    aria-pressed={floorTranslated}
                  >
                    {floorTranslated ? "원문 보기" : "번역하기"}
                  </button>
                ) : null}
              </aside>
            </section>
            {floorWineDetail ? (
              <aside className={styles.customerFloorWineDetail} role="dialog" aria-label={`${floorWineDetail.label} 상세정보`}>
                <button
                  type="button"
                  className={styles.customerFloorWineDetailClose}
                  onClick={() => setFloorWineDetailId(null)}
                  aria-label="와인 정보 닫기"
                >
                  ×
                </button>
                <PixelSprite
                  id={floorWineDetail.sprite}
                  label={floorWineDetail.label ?? floorWineDetail.sprite}
                  size={188}
                  smooth
                />
                <div className={styles.customerFloorWineDetailInfo}>
                  <span>
                    {floorWineDetail.tier === "premium"
                      ? "Premium Selection"
                      : floorWineDetail.tier === "favorite"
                        ? "House Favorite"
                        : "House Wine"}
                  </span>
                  <h3>{floorWineDetail.label ?? pretty(floorWineDetail.id)}</h3>
                  <dl>
                    <div>
                      <dt>종류</dt>
                      <dd>
                        {floorWineDetail.kind === "red"
                          ? "레드 와인"
                          : floorWineDetail.kind === "white"
                            ? "화이트 와인"
                            : floorWineDetail.kind === "sweet"
                              ? "스위트 와인"
                              : floorWineDetail.kind === "sparkling"
                                ? "스파클링 와인"
                                : pretty(floorWineDetail.kind ?? "와인")}
                      </dd>
                    </div>
                    <div>
                      <dt>가격대</dt>
                      <dd>
                        {floorWineDetail.price === "green"
                          ? "낮은 가격"
                          : floorWineDetail.price === "yellow"
                            ? "중간 가격"
                            : "높은 가격"}
                      </dd>
                    </div>
                    <div>
                      <dt>재고</dt>
                      <dd>{floorWineDetail.stock === "soldout" ? "품절" : "구매 가능"}</dd>
                    </div>
                  </dl>
                </div>
                <button
                  type="button"
                  className={styles.customerFloorWineRecommend}
                  disabled={done || floorMatchFlash || floorWineDetail.stock === "soldout"}
                  onClick={() => {
                    matchFloorWine(floorWineDetail.id);
                    setFloorWineDetailId(null);
                  }}
                >
                  {floorWineDetail.stock === "soldout" ? "현재 품절" : "이 와인 추천하기"}
                </button>
              </aside>
            ) : null}
          </>
        ) : (
          <>
            <section className={styles.columnWrap} data-side="left" aria-label={`${leftHead} 카드 열`}>
              <div className={styles.columnHead}>
                <span>{leftHead}</span>
                <span className={styles.columnCount}>{left.length}장</span>
              </div>
              <div className={styles.column}>{displayLeft.map((card) => renderCard(card, "left"))}</div>
            </section>
            <section className={styles.columnWrap} data-side="right" aria-label={`${rightHead} 카드 열`}>
              <div className={styles.columnHead}>
                <span>{rightHead}</span>
                <span className={styles.columnCount}>{right.length}장</span>
              </div>
              <div className={styles.column}>{displayRight.map((card) => renderCard(card, "right"))}</div>
            </section>
          </>
        )}

        {customerFloor && sudden && suddenVisible && !suddenFocused && !suddenDismissed ? (
          <button
            type="button"
            className={styles.customerFloorIncident}
            data-settled={suddenSettled || undefined}
            data-arrived={suddenArrived || undefined}
            disabled={done || suddenSettled || !suddenArrived}
            onClick={() => setSuddenFocused(true)}
            aria-label={`진상 손님 대응 열기 — ${sudden.label ?? "돌발 상황"}`}
          >
            <span className={styles.customerFloorIncidentTitle}>
              <span className={styles.customerFloorIncidentHeading}>
                <span className={styles.customerFloorIncidentWarning}>
                  <span
                    className={styles.customerFloorIncidentTimer}
                    data-urgent={suddenResponseRemaining <= 10 || undefined}
                  >
                    {suddenResponseRemaining}초
                  </span>
                  <span className={styles.customerFloorIncidentIcon}>!</span>
                </span>
                <span>돌발상황</span>
              </span>
              <span className={styles.customerFloorIncidentDescription}>
                컴플레인이 들어왔습니다.<br />
                30초내 진상손님을 대응하세요.
              </span>
            </span>
            <span className={styles.customerFloorSpeech}>
              야 너 내가 그지인줄 알아??<br />건방지게 잔말 말고 당장 환불해!!
            </span>
            <span className={styles.customerFloorPerson}>
              {sudden.sprite ? (
                <PixelSprite
                  id={sudden.sprite === "손님_개봉상품_고성" ? "kts-03-irate-customer-flipped-v1" : sudden.sprite}
                  label="진상 손님"
                  size={sudden.sprite === "손님_개봉상품_고성" ? 144 : 96}
                  smooth
                />
              ) : null}
              <strong>{suddenSettled ? "조치 완료" : "진상 손님"}</strong>
            </span>
          </button>
        ) : null}

        {customerFloor && sudden && suddenVisible && suddenFocused ? (
          <div className={styles.customerResponse} role="dialog" aria-modal="true" aria-label="진상 손님 대응 선택">
            <div className={styles.customerResponsePanel}>
              <h2 className={styles.customerResponseTitle}>
                <span className={styles.customerResponseTitleIcon} aria-hidden>
                  !
                </span>
                돌발상황
              </h2>
              <div className={styles.customerResponseSpeech}>
                <span>
                  야 너 내가 그지인줄 알아??
                  <br />
                  건방지게 잔말 말고 당장 환불해!!
                </span>
              </div>
              <div className={styles.customerResponsePerson}>
                {sudden.sprite ? <PixelSprite id={sudden.sprite} label="진상 손님" size={176} smooth /> : null}
                <strong>{sudden.label ?? "돌발 손님"}</strong>
              </div>
              <aside className={styles.customerResponseGuide}>
                <h3>Service Guidelines</h3>
                <ol>
                  <li>고객의 말을 차분히 경청합니다.</li>
                  <li>구매 이력과 상품 상태를 확인합니다.</li>
                  <li>환불 규정을 근거와 함께 안내합니다.</li>
                  <li>교환·적립 등 가능한 대안을 제시합니다.</li>
                  <li>고성이 지속되면 매니저에게 인계합니다.</li>
                </ol>
              </aside>
              <button type="button" className={styles.customerResponseBack} onClick={() => setSuddenFocused(false)}>
                돌아가기
              </button>
              <div className={styles.customerResponseActions} role="group" aria-label="진상 손님 대처 방법 6개">
                {displayStages.map((stage) => (
                  <button
                    key={stage.id}
                    type="button"
                    className={styles.customerResponseAction}
                    data-done={stagesDone.includes(stage.id) || undefined}
                    disabled={done || stagesDone.includes(stage.id)}
                    onClick={() => {
                      pressStage(stage.id);
                    }}
                  >
                    {stage.sprite ? <PixelSprite id={stage.sprite} label="" size={34} smooth /> : null}
                    <span>{stage.label ?? pretty(stage.id)}</span>
                  </button>
                ))}
                {(sudden.forbidden_actions ?? []).map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className={styles.customerResponseAction}
                    data-forbidden-pressed={pressedForbidden.includes(action.id) || undefined}
                    disabled={done || pressedForbidden.includes(action.id)}
                    onClick={() => {
                      pressForbiddenButton(action.id);
                    }}
                  >
                    <span>{action.label ?? pretty(action.id)}</span>
                  </button>
                ))}
                {!isItemEscalate && data.escalate ? (
                  <button
                    type="button"
                    className={styles.customerResponseAction}
                    data-kind="escalate"
                    data-done={escalated || undefined}
                    disabled={done || escalated}
                    onClick={() => {
                      pressStateEscalate();
                    }}
                  >
                    <span>{data.escalate.label ?? "호출"}</span>
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {flowBeads.length > 0 ? (
        <div className={styles.streamWrap}>
          <div className={styles.streamHead}>
            <span>흐름 검수 — 색이 튀는 구슬만 클릭</span>
            <span>
              이상치 {caughtCount} / {outliers.length}
            </span>
          </div>
          <div className={styles.streamTrack} role="group" aria-label="데이터 흐름 — 이상치 구슬만 클릭해 걸러내세요">
            {flowBeads.map((bead, i) => {
              const judged =
                beadClicks[bead.id] ?? (done && bead.kind === "outlier" ? ("missed" as const) : undefined);
              return (
                <button
                  key={bead.id}
                  type="button"
                  className={styles.bead}
                  style={{
                    animationDelay: `-${((i * FLOW_SECONDS) / flowBeads.length).toFixed(2)}s`,
                    top: `${8 + (i % 3) * 30}px`,
                  }}
                  data-judged={judged}
                  disabled={done || Boolean(beadClicks[bead.id])}
                  aria-label={`구슬 ${i + 1}`}
                  onClick={() => clickBead(bead.id, bead.kind)}
                >
                  {/* 이상치 판별은 '색'으로만 — sprite id 텍스트(구슬_붉은 vs 구슬_파랑)는 이상치
                      여부를 글자로 유출하므로(규칙 1) 폴백 라벨·aria 모두 중립 문구로 고정한다. */}
                  <PixelSprite id={bead.sprite} label="구슬" size={22} />
                  {judged === "caught" ? <span className={styles.beadMark}>✓</span> : null}
                  {judged === "wrong" ? <span className={styles.beadMark}>✕</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {sudden && suddenVisible && !customerFloor ? (
        <div
          className={styles.sudden}
          role="group"
          aria-label="돌발 상황"
          data-settled={stagesAllDone && (!sudden.persists_after_stages || escalated)}
        >
          <div className={styles.suddenHead}>
            {sudden.sprite ? (
              <PixelSprite
                id={sudden.sprite}
                label={pretty(sudden.sprite)}
                size={56}
                fallbackClassName={styles.suddenSprite}
              />
            ) : null}
            <span className={styles.suddenLabel}>{sudden.label ?? "돌발 상황 발생"}</span>
          </div>
          <div className={styles.suddenActions}>
            {displayStages.map((stage) => (
              <button
                key={stage.id}
                type="button"
                className={styles.stageBtn}
                data-done={stagesDone.includes(stage.id)}
                disabled={done || stagesDone.includes(stage.id)}
                onClick={() => pressStage(stage.id)}
              >
                {stage.sprite ? (
                  <PixelSprite id={stage.sprite} label={pretty(stage.sprite)} size={36} />
                ) : (
                  <span>{pretty(stage.id)}</span>
                )}
                {stage.label ? <span className={styles.stageLabel}>{stage.label}</span> : null}
              </button>
            ))}
            {(sudden.forbidden_actions ?? []).map((action) => (
              <button
                key={action.id}
                type="button"
                className={styles.stageBtn}
                disabled={done || pressedForbidden.includes(action.id)}
                data-forbidden-pressed={pressedForbidden.includes(action.id) || undefined}
                data-done={pressedForbidden.includes(action.id)}
                onClick={() => pressForbiddenButton(action.id)}
              >
                <span>{action.label ?? pretty(action.id)}</span>
              </button>
            ))}
            {!isItemEscalate && data.escalate ? (
              <button
                type="button"
                className={styles.stageBtn}
                data-kind="escalate"
                data-done={escalated}
                disabled={done || escalated}
                onClick={pressStateEscalate}
              >
                <span>{data.escalate.label ?? "호출"}</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!done ? (
        <div className={styles.actions}>
          {!customerFloor ? (
            <button
              type="button"
              className={styles.actionBtn}
              disabled={!selected}
              onClick={() => markSelected("stamped")}
              aria-label={`선택한 카드에 ${stampLabel} 도장`}
            >
              {stampLabel} 도장
            </button>
          ) : null}
          {data.discard ? (
            <button
              type="button"
              className={styles.actionBtn}
              disabled={!selected}
              onClick={() => markSelected("discarded")}
              aria-label={`선택한 카드를 ${binLabel}에 버리기`}
            >
              {/* 도트 아이콘은 표시 전용(stn-01 discard.sprite: 휴지통) — 없거나 파일이 빠지면
                  폴백 스팬이 숨어 기존 텍스트 버튼 그대로다. */}
              {data.discard.sprite ? (
                <PixelSprite
                  id={data.discard.sprite}
                  label={binLabel}
                  size={20}
                  fallbackClassName={styles.spriteFallbackHidden}
                />
              ) : null}
              {binLabel}에 버리기
            </button>
          ) : null}
          {isItemEscalate && data.escalate ? (
            <button
              type="button"
              className={styles.actionBtn}
              disabled={!selected}
              onClick={() => markSelected("escalated")}
              aria-label={`선택한 카드를 인계 — ${data.escalate.label ?? "호출"}`}
            >
              {data.escalate.label ?? "호출"}
            </button>
          ) : null}
          {!isItemEscalate && data.escalate && !sudden ? (
            <button type="button" className={styles.actionBtn} disabled={escalated} onClick={pressStateEscalate}>
              {data.escalate.label ?? "호출"}
            </button>
          ) : null}
          {(data.forbidden ?? []).map((item) => (
            <button
              key={item.id}
              type="button"
              className={styles.actionBtn}
              data-forbidden-pressed={pressedForbidden.includes(item.id) || undefined}
              disabled={pressedForbidden.includes(item.id)}
              onClick={() => pressForbiddenButton(item.id)}
            >
              {pretty(item.id)}
            </button>
          ))}
          <span className={styles.actionsSpacer} />
          {readyToSubmit ? <span className={styles.readyHint}>모든 판정 완료 — 제출을 눌러 채점</span> : null}
          <button
            type="button"
            className={styles.submitBtn}
            data-ready={readyToSubmit || undefined}
            onClick={finish}
            aria-label="제출 — 지금 상태로 채점"
          >
            제출
          </button>
        </div>
      ) : null}

      {forbiddenWarning && !done ? (
        <div key={forbiddenWarning.tick} className={styles.forbiddenAlert} role="alert">
          <span className={styles.forbiddenAlertBadge}>금지행동</span>
          <span>{forbiddenWarning.reason}</span>
        </div>
      ) : null}

      {done && outcome ? (
        <ResultBar score={outcome.accuracy}>
          {supplyRun ? (
            <>
              출고·운반 <b>{outcome.supplyAccuracy ?? 0}점</b> · 고객 응대 <b>{outcome.matchAccuracy}점</b>
            </>
          ) : (
            <>
              판정{" "}
              <b>
                {outcome.numerator}/{outcome.denominator}
              </b>{" "}
              정답
            </>
          )}
          {outcome.incidents > 0 ? (
            <>
              {" · "}실수 <b>{outcome.incidents}건</b>
              {outcome.penalty > 0 ? <> · 고객 응대 감점 −{outcome.penalty}점</> : null}
            </>
          ) : (
            <>
              {" · "}실수 <b>없음</b>
            </>
          )}
        </ResultBar>
      ) : null}
    </div>
  );
}
