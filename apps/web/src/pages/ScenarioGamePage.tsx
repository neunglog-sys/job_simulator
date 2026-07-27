import { SpeakerHigh, SpeakerSlash, UserCircle } from "@phosphor-icons/react";
import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { LogoutConfirmDialog } from "../components/LogoutConfirmDialog";
import { SpaceLoadingScreen } from "../components/SpaceLoadingScreen";
import { AiAvatarStage } from "../components/conversation/AiAvatarStage";
import { AiCoachPanel } from "../components/scenario/AiCoachPanel";
import { BriefingPanel } from "../components/scenario/BriefingPanel";
import { DashboardHeader } from "../components/scenario/DashboardHeader";
import type { ScenarioTheme } from "../components/scenario/DashboardHeader";
import {
  DialogueHistoryPanel,
  type DialogueHistoryEntry,
} from "../components/scenario/DialogueHistoryPanel";
import { GameMapLayer } from "../components/scenario/GameMapLayer";
import { HintPanel } from "../components/scenario/HintPanel";
import { MiniGamePanel } from "../components/scenario/MiniGamePanel";
import { MissionPanel } from "../components/scenario/MissionPanel";
import { MemoPanel, type MemoSaveStatus } from "../components/scenario/MemoPanel";
import { MovementArea, SLOT_SPREAD } from "../components/scenario/MovementArea";
import { canChat, canMove, MODAL_PHASES, TOUR_PHASES, type GamePhase } from "../components/scenario/phase";
import { ReflectionPanel } from "../components/scenario/ReflectionPanel";
import { PLAYER_SIZE } from "../components/scenario/PlayerSprite";
import { ScenarioAudioSettingsDialog } from "../components/scenario/ScenarioAudioSettingsDialog";
import { ScenarioControlPanel } from "../components/scenario/ScenarioControlPanel";
import { TourBanner } from "../components/scenario/TourBanner";
import { WorkflowModal } from "../components/scenario/WorkflowModal";
import type { HintCardData, Position } from "../components/scenario/types";
import { API_BASE_URL } from "../config/endpoints";
import type { MissionView } from "../components/scenario/MissionPanel";
import {
  ApiError,
  createReport,
  createSimulation,
  fetchReport,
  fetchSimulation,
  type GameNpc,
  type GameStep,
  type GameTask,
  type MuseTalkSpeakRequest,
  type Simulation,
} from "../lib/api";
import { logout } from "../lib/auth";
import {
  COACH_PROFILES,
  getStoredCoachId,
  saveCoachId,
  type CoachAvatarId,
} from "../lib/coachPreference";
import {
  SimulationSocket,
  type AdviceCard,
  type CoachCardsFrame,
  type TaskResultFrame,
  type TourFrame,
} from "../lib/simulationSocket";
import type { AvatarStatus } from "../types/conversation";
import styles from "../styles/scenarioGame.module.css";

// 힌트는 백엔드가 주는 것만 쓴다 — 정답은 클라이언트로 내려오지 않는다(대화로 알아내는 게 게임).
//   스텝 시작 → step.guide (이번 업무의 방향·제공 자료)
//   미달할수록 → advice_card 1~3단계 (방향 → 미충족 기준 전부 → 정답 골격)
const ADVICE_CATEGORY: Record<number, string> = {
  1: "조언 · 방향",
  2: "조언 · 미충족 기준",
  3: "조언 · 정답 골격",
};

// 과제 창이 떠 있는 페이즈 — 풀이·채점중·결과가 한 화면(미달해도 닫지 않고 재제출).
const MISSION_PHASES: ReadonlySet<GamePhase> = new Set<GamePhase>([
  "mission",
  "mission_grading",
  "mission_result",
]);

const COACH_SEVERITY: Record<string, string> = {
  critical: "꼭 고칠 것",
  warning: "주의",
  info: "참고",
  success: "잘한 점",
};

function buildHints(
  step: GameStep | null,
  advice: AdviceCard[],
  coach: CoachCardsFrame | null,
  briefed: boolean,
): HintCardData[] {
  const cards: HintCardData[] = [];
  // 사수에게 들은 업무 절차 — 브리핑을 들은 뒤에만 노트에 남는다(안 듣고는 못 본다).
  if (briefed && step?.briefing?.length) {
    cards.push({
      id: "briefing",
      category: "업무 노트 · 사수에게 들은 절차",
      title: step.title || "이번 업무",
      description: step.briefing.map((line, index) => `${index + 1}. ${line}`).join("\n"),
    });
  }
  // 제공자료 본문 — 자료 하나가 카드 하나. guide(이름 나열) 바로 앞에 놓아 먼저 눈에 띄게 한다.
  // 이 자료를 대조해야 답이 나오는 과제(예: 정산 차액 규명)라 브리핑과 무관하게 항상 열어 둔다.
  for (const material of step?.materials ?? []) {
    cards.push({
      id: `material-${material.title}`,
      category: "제공 자료",
      title: material.title,
      description: material.body,
    });
  }
  if (step?.guide) {
    cards.push({
      id: "guide",
      category: "업무 안내",
      title: step.title || "이번 업무",
      description: step.guide,
    });
  }
  for (const card of advice) {
    cards.push({
      id: `advice-${card.level}`,
      category: ADVICE_CATEGORY[card.level] ?? "조언",
      title: card.title,
      description: card.content,
    });
  }
  // 통과 후 AI 코치 사후 리뷰 — 잘한 점·놓친 점을 근거와 함께 되짚어 준다.
  for (const card of coach?.cards ?? []) {
    cards.push({
      id: `coach-${card.card_id}`,
      category: `코치 리뷰 · ${COACH_SEVERITY[card.severity] ?? "참고"}`,
      title: card.title,
      description: card.summary,
    });
  }
  if (cards.length === 0) {
    cards.push({
      id: "empty",
      category: "힌트",
      title: "아직 힌트가 없어요",
      description: "담당자에게 다가가 대화로 업무에 필요한 정보를 먼저 모아보세요.",
    });
  }
  return cards;
}

const DEFAULT_COACH_MESSAGE =
  "첫 번째 미션을 준비하고 있어요. 잠시만 기다려 주세요.";
const DEFAULT_SCENARIO_MAP_IMAGE =
  `${import.meta.env.BASE_URL}assets/scenario/maps/modern-design-video-studio.webp`;

const NPC_STANDING_ILLUSTRATIONS: Readonly<Record<string, string>> = {
  "npc_kts-03_01": `${import.meta.env.BASE_URL}npc/standing/npc_kts-03_01.webp`,
  "npc_kts-03_02": `${import.meta.env.BASE_URL}npc/standing/npc_kts-03_02.webp`,
  "npc_kts-03_03": `${import.meta.env.BASE_URL}npc/standing/npc_kts-03_03.webp`,
  "npc_kts-03_04": `${import.meta.env.BASE_URL}npc/standing/npc_kts-03_04.webp`,
  "npc_sns-01_01": `${import.meta.env.BASE_URL}npc/standing/npc_sns-01_01.webp`,
  "npc_sns-01_02": `${import.meta.env.BASE_URL}npc/standing/npc_sns-01_02.webp`,
  "npc_sns-01_03": `${import.meta.env.BASE_URL}npc/standing/npc_sns-01_03.webp`,
};

// 직접 진입 시 시연 대상인 영업·판매 시나리오를 시작한다.
// 상담 추천·마이페이지에서 slug를 전달하면 해당 사용자의 시나리오를 그대로 이어 간다.
const DEFAULT_SCENARIO_SLUG =
  new URLSearchParams(window.location.search).get("slug") ||
  import.meta.env.VITE_SCENARIO_SLUG?.trim() ||
  "kts-03";

const SCENARIO_MAP_IMAGES: Readonly<Record<string, string>> = {
  "kts-03": `${API_BASE_URL}/maps/kts-03/kts-03.webp`,
  "sns-01": `${API_BASE_URL}/maps/sns-01/sns-01.webp`,
};

const SCENARIO_BGM_TRACKS: Readonly<Record<string, readonly string[]>> = {
  "kts-03": [
    `${import.meta.env.BASE_URL}assets/scenario/bgm/kts-03/golden-hour.mp3`,
    `${import.meta.env.BASE_URL}assets/scenario/bgm/kts-03/velvet-and-vine.mp3`,
  ],
  "sns-01": [
    `${import.meta.env.BASE_URL}assets/scenario/bgm/sns-01/creative-flow.mp3`,
    `${import.meta.env.BASE_URL}assets/scenario/bgm/sns-01/neon-alley-groove.mp3`,
  ],
};

const CONVERSATION_LEARNING_SCENARIOS = new Set(["sns-01", "kts-03"]);

const BGM_VOLUME_KEY = "scenario-bgm-volume";
const COACH_VOLUME_KEY = "scenario-coach-volume";
const DEFAULT_BGM_VOLUME = 0.1;
const DEFAULT_COACH_VOLUME = 0.5;

function savedVolume(key: string, fallback: number): number {
  const stored = localStorage.getItem(key);
  if (stored === null || stored.trim() === "") return fallback;
  const saved = Number(stored);
  return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : fallback;
}

function mapImageForScenario(slug: string) {
  return SCENARIO_MAP_IMAGES[slug] ?? DEFAULT_SCENARIO_MAP_IMAGE;
}

const INITIAL_SCENARIO_MAP_IMAGE = mapImageForScenario(DEFAULT_SCENARIO_SLUG);

// 1:1 상담에서 "체험하기"로 진입할 때만 실려온다 — 있어야 체험 완주를 그 상담의 최종
// 리포트에 반영할 수 있다(없으면 상담 없이 들어온 것이므로 리포트 생성을 건너뜀).
const CONSULTATION_ID_PARAM = new URLSearchParams(window.location.search).get("consultationId");
const CONSULTATION_ID = CONSULTATION_ID_PARAM && /^\d+$/.test(CONSULTATION_ID_PARAM)
  ? Number(CONSULTATION_ID_PARAM)
  : null;

// 플레이어가 담당 NPC 좌표(스테이지 로컬 px)에 이 거리 안으로 들어오면 업무를 건넨다.
const ENCOUNTER_RADIUS = 150;

const NOOP = () => undefined;

// 진행 중이던 시뮬 id를 기억해 이어받는다 — 새로고침할 때마다 새 시뮬을 만들면 투어·인사·미션
// 진행도가 전부 날아가고(서버에 state를 저장해 둔 의미가 없어진다), 버려진 시뮬만 쌓인다.
const RESUME_KEY = `sim:${DEFAULT_SCENARIO_SLUG}`;

async function resumeOrCreate(slug: string): Promise<Simulation> {
  const saved = Number(sessionStorage.getItem(RESUME_KEY));
  if (saved) {
    try {
      const sim = await fetchSimulation(saved);
      // 선택한 시나리오와 같은 세션만 이어받는다. 테스트 중 저장 키가 섞여도
      // 다른 직무의 미션·미니게임·맵을 잘못 재개하지 않게 한다.
      if (sim.status === "active" && sim.scenario_slug === slug) return sim;
    } catch {
      /* 없거나 남의 것 → 새로 만든다 */
    }
    sessionStorage.removeItem(RESUME_KEY);
  }
  // 최초 생성 시 상담 id를 실어 서버 DB에 박아둔다 → 이후 재개(위 fetchSimulation)로 복원된다.
  const sim = await createSimulation(slug, CONSULTATION_ID);
  sessionStorage.setItem(RESUME_KEY, String(sim.id));
  return sim;
}

type ConnectionStatus = "creating" | "open" | "closed" | "error";

type ScenarioScreenStyle = CSSProperties & {
  "--scenario-map-image": string;
};

type ScenarioStageStyle = CSSProperties & {
  "--scenario-stage-scale": number;
  "--scenario-ui-text-scale": number;
};

function getStageScale() {
  return Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
}

// 코치 안내 — 지도에서 담당 NPC에게 다가가라고 유도(첫 유저가 헤매지 않게).
function approachGuide(step: GameStep | null, roster: GameNpc[]): string {
  if (!step?.task && !step?.activity) return DEFAULT_COACH_MESSAGE;
  const name = roster.find((npc) => npc.npc_id === step.npcs?.[0])?.name;
  return name
    ? `지도에서 '!' 표시된 ${name} 님에게 다가가면 업무를 받을 수 있어요.`
    : "지도에서 '!' 표시된 담당 NPC에게 다가가면 업무를 받을 수 있어요.";
}

// 1단계 안내 — 사수에게 다가가면 팀을 한 바퀴 돌며 소개해 준다.
function introGuide(step: GameStep | null, roster: GameNpc[]): string {
  const name = roster.find((npc) => npc.npc_id === step?.npcs?.[0])?.name;
  return name
    ? `첫 출근이에요. '!' 표시된 ${name} 님에게 다가가 인사하면 팀을 소개해 줄 거예요.`
    : "첫 출근이에요. '!' 표시된 사수에게 다가가 인사해보세요.";
}

// 투어 컷신은 사수·플레이어 자리를 좌표 산수(고정 오프셋)로 정하는데, 이 위치는 MovementArea의
// 평소 이동(slide)을 거치지 않아 충돌 박스를 그대로 뚫고 배치될 수 있다 — 옆 동료 책상이 가까우면
// 그 오프셋이 책상 위에 놓여 플레이어가 "책상에 갇힌" 채로 컷신을 시작하게 된다(2026-07-24 확인).
// FOOT_WIDTH/FOOT_HEIGHT는 MovementArea의 collidesAt과 반드시 같은 값이어야 판정이 어긋나지 않는다.
const TOUR_FOOT_WIDTH = 46;
const TOUR_FOOT_HEIGHT = 26;
// tourCollidesAt이 검사하는 발판박스의 '중심'이 넘겨준 좌표에서 얼마나 떨어져 있는지 —
// 사수 좌표는 마커 중심이라 이 차이만큼 집기를 옮겨(tourCollisions) 판정 기준을 맞춘다.
const GUIDE_MARKER_DX = (PLAYER_SIZE.width - TOUR_FOOT_WIDTH) / 2 + TOUR_FOOT_WIDTH / 2; // 38
const GUIDE_MARKER_DY = PLAYER_SIZE.height - TOUR_FOOT_HEIGHT + TOUR_FOOT_HEIGHT / 2; // 83

function tourCollidesAt(
  pos: Position,
  collisions: Array<{ x: number; y: number; w: number; h: number }>,
): boolean {
  const footX = pos.x + (PLAYER_SIZE.width - TOUR_FOOT_WIDTH) / 2;
  const footY = pos.y + PLAYER_SIZE.height - TOUR_FOOT_HEIGHT;
  return collisions.some(
    (c) => footX < c.x + c.w && footX + TOUR_FOOT_WIDTH > c.x && footY < c.y + c.h && footY + TOUR_FOOT_HEIGHT > c.y,
  );
}

// desired 지점이 충돌이면 8방향 링으로 반경을 넓혀가며 가장 가까운 빈 자리를 찾는다.
// 다 막혀 있으면(사실상 없음) target(동료 스폰 지점 — NPC가 서 있는 자리라 항상 비어있다)으로 돌아간다.
function findSafeSpot(
  desired: Position,
  target: Position,
  collisions: Array<{ x: number; y: number; w: number; h: number }>,
): Position {
  if (collisions.length === 0 || !tourCollidesAt(desired, collisions)) return desired;
  const STEP = 12;
  const MAX_RADIUS = 168;
  for (let radius = STEP; radius <= MAX_RADIUS; radius += STEP) {
    const offsets: Array<[number, number]> = [
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius],
      [radius, radius],
      [-radius, radius],
      [radius, -radius],
      [-radius, -radius],
    ];
    for (const [dx, dy] of offsets) {
      const candidate = { x: desired.x + dx, y: desired.y + dy };
      if (!tourCollidesAt(candidate, collisions)) return candidate;
    }
  }
  return target;
}

// 사수가 소개 대상 '바로 옆'에 서는 자리 — 좌·우·아래·위 순으로 한 몸 거리(옆자리)를 먼저 보고,
// 네 자리가 다 막혔을 때만 findSafeSpot의 링 탐색으로 넘어간다. 예전엔 곧장 링 탐색이라
// 옆이 막히면 최대 168px 밖(딴 데)에 서서 "소개는 하는데 정작 멀리 떨어져 있는" 그림이 됐다.
const SIDE_BY_SIDE_GAP = 64;
function besideSpot(
  anchor: Position,
  collisions: Array<{ x: number; y: number; w: number; h: number }>,
): Position {
  const candidates: Position[] = [
    { x: anchor.x - SIDE_BY_SIDE_GAP, y: anchor.y },
    { x: anchor.x + SIDE_BY_SIDE_GAP, y: anchor.y },
    { x: anchor.x, y: anchor.y + SIDE_BY_SIDE_GAP },
    { x: anchor.x, y: anchor.y - SIDE_BY_SIDE_GAP },
  ];
  for (const spot of candidates) {
    if (!tourCollidesAt(spot, collisions)) return spot;
  }
  return findSafeSpot(candidates[0], anchor, collisions);
}

// MovementArea의 guideHopMsRef와 동일한 공식 — 걸음(코너)마다 setTimeout으로 예약할 때 그쪽 CSS
// transition 종료 시점과 맞추기 위해 값을 그대로 복제했다(GUIDE_HOP_MIN/MAX/SPEED와 반드시 동일).
// MAX는 코너~코너 한 직선 구간을 등속(220px/s)으로 활공할 수 있어야 하므로 가장 긴 구간(≈720px,
// 3273ms)을 담게 3600ms로 둔다 — 캡에 걸리면 그 긴 직선만 오히려 빨라져 보이므로 속도에 맞춰 함께 올림.
const TOUR_HOP_MIN_MS = 150;
const TOUR_HOP_MAX_MS = 3600;
// 사수·신입 컷신 이동 체감 속도(px/s). 사용자 피드백 "직진 시 사수가 너무 빠르다" → 260→220으로 살짝 낮춤.
// MovementArea GUIDE_HOP_SPEED_PX_S와 반드시 동일해야 한다(걸음 예약 간격 == CSS 전이시간, 어긋나면 대각선).
const TOUR_HOP_SPEED_PX_S = 220;
function tourHopDurationMs(from: Position, to: Position): number {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.min(TOUR_HOP_MAX_MS, Math.max(TOUR_HOP_MIN_MS, (dist / TOUR_HOP_SPEED_PX_S) * 1000));
}
const GUIDE_GRID = 16; // BFS 격자 간격(px) — 집기(수십 px)보다 촘촘해 그 사이 틈으로 새지 않는다
const GUIDE_ROUTE_MARGIN = 168; // 집기 바깥으로 이만큼 여유 바닥을 탐색에 포함(돌아갈 통로 확보)

// 임의의 점을 '전역 격자(GUIDE_GRID 배수)에 맞춘 가장 가까운 빈 셀'로 스냅한다. 사수 위치를
// 항상 이 격자 위에 두면(첫 배치·매 걸음 끝점) 다음 걸음의 시작점도 격자 위라, 걸음 이음매에
// 비스듬한 오차(≤8px)가 안 생겨 걸음이 딱 상하좌우로만 떨어진다.
function guideSnap(
  p: Position,
  collisions: Array<{ x: number; y: number; w: number; h: number }>,
): Position {
  const x0 = Math.round(p.x / GUIDE_GRID) * GUIDE_GRID;
  const y0 = Math.round(p.y / GUIDE_GRID) * GUIDE_GRID;
  if (collisions.length === 0 || !tourCollidesAt({ x: x0, y: y0 }, collisions)) return { x: x0, y: y0 };
  for (let rad = 1; rad <= 10; rad++)
    for (let dc = -rad; dc <= rad; dc++)
      for (let dr = -rad; dr <= rad; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
        const cand = { x: x0 + dc * GUIDE_GRID, y: y0 + dr * GUIDE_GRID };
        if (!tourCollidesAt(cand, collisions)) return cand;
      }
  return { x: x0, y: y0 };
}

// 사수가 책상·집기를 '상하좌우로 돌아서' 가는 우회 경로를 격자 BFS로 찾는다(꺾는 점 목록).
// 로밍 NPC가 한 축씩만 걸어 절대 대각선으로 관통하지 않는 성질을, 컷신 이동에도 그대로 준다.
// 단순 L자 한 번으론 사무실처럼 집기 많은 맵에서 두 자리 사이가 자주 막혀(sim_guide_hops.py로
// 확인) 여러 번 꺾어야 한다. 격자에 스냅해 항상 상하좌우로만 잇고, 경로가 없으면 null.
// 격자 원점은 GUIDE_GRID 배수로 고정(맵 전역 정렬) — 걸음마다 target을 셀 중심에 맞춰 끝내므로
// 다음 걸음의 start도 같은 격자 위라 이음매에 대각선 오차가 생기지 않는다.
function guideRoute(
  start: Position,
  target: Position,
  collisions: Array<{ x: number; y: number; w: number; h: number }>,
): Position[] {
  if (collisions.length === 0) return [start, target];
  // 탐색 창 = 모든 집기 + 시작/목표를 감싼 사각형에 여유를 더한 것. 창을 넉넉히 잡아야
  // 맵을 크게 우회해야 하는 경로도 찾는다. 원점(minX/minY)은 격자 배수로 내려 전역 정렬.
  let minX = Math.min(start.x, target.x);
  let minY = Math.min(start.y, target.y);
  let maxX = Math.max(start.x, target.x);
  let maxY = Math.max(start.y, target.y);
  for (const c of collisions) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x + c.w > maxX) maxX = c.x + c.w;
    if (c.y + c.h > maxY) maxY = c.y + c.h;
  }
  minX = Math.floor((minX - GUIDE_ROUTE_MARGIN) / GUIDE_GRID) * GUIDE_GRID;
  minY = Math.floor((minY - GUIDE_ROUTE_MARGIN) / GUIDE_GRID) * GUIDE_GRID;
  const cols = Math.ceil((maxX + GUIDE_ROUTE_MARGIN - minX) / GUIDE_GRID) + 1;
  const rows = Math.ceil((maxY + GUIDE_ROUTE_MARGIN - minY) / GUIDE_GRID) + 1;
  const cxOf = (c: number) => minX + c * GUIDE_GRID;
  const cyOf = (r: number) => minY + r * GUIDE_GRID;
  const walkable = (c: number, r: number) =>
    c >= 0 && r >= 0 && c < cols && r < rows && !tourCollidesAt({ x: cxOf(c), y: cyOf(r) }, collisions);
  // 시작/목표는 guideSnap이 이미 '전역 격자 위의 빈 셀'로 맞춰준다 — 창 안 셀 인덱스로 변환.
  const snapStart = guideSnap(start, collisions);
  const snapTarget = guideSnap(target, collisions);
  const sc = Math.round((snapStart.x - minX) / GUIDE_GRID);
  const sr = Math.round((snapStart.y - minY) / GUIDE_GRID);
  const tc = Math.round((snapTarget.x - minX) / GUIDE_GRID);
  const tr = Math.round((snapTarget.y - minY) / GUIDE_GRID);
  const idx = (c: number, r: number) => r * cols + c;
  const seen = new Uint8Array(cols * rows);
  const goal = idx(tc, tr);
  const startIdx = idx(sc, sr);
  let best = startIdx; // 목표에 못 닿을 때를 대비해 '가장 가까이 도달한 셀'을 기억
  let bestD = Math.abs(sc - tc) + Math.abs(sr - tr);
  const queue = [startIdx];
  seen[startIdx] = 1;
  let found = false;
  for (let h = 0; h < queue.length && !found; h++) {
    const cur = queue[h];
    if (cur === goal) {
      found = true;
      break;
    }
    const c = cur % cols;
    const r = (cur - c) / cols;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
      const nc = c + dc;
      const nr = r + dr;
      const ni = idx(nc, nr);
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows || seen[ni] || !walkable(nc, nr)) continue;
      seen[ni] = 1;
      queue.push(ni);
      const d = Math.abs(nc - tc) + Math.abs(nr - tr);
      if (d < bestD) {
        bestD = d;
        best = ni;
      }
    }
  }
  // 목표가 집기로 둘러싸여 못 닿으면(kts-03 카운터 뒤 자리 등) 폴백으로 가로지르지 말고,
  // 도달 가능한 셀 중 목표에 가장 가까운 곳까지만 걸어가 멈춘다 — 절대 집기 관통 없음.
  const end = found ? goal : best;
  // end 지점에서 역방향 BFS로 gdist[셀] = end까지의 최단 걸음 수를 구한다(도달 가능한 셀 위에서만).
  const INF = 1 << 30;
  const gdist = new Int32Array(cols * rows).fill(INF);
  gdist[end] = 0;
  const bq = [end];
  for (let h = 0; h < bq.length; h++) {
    const cur = bq[h];
    const c = cur % cols;
    const r = (cur - c) / cols;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = idx(nc, nr);
      if (gdist[ni] !== INF || !walkable(nc, nr)) continue;
      gdist[ni] = gdist[cur] + 1;
      bq.push(ni);
    }
  }
  // 직진 우선 greedy: end에 가까워지는(gdist가 줄어드는) 한 같은 방향으로 계속 직진하고, 막힐 때만
  // 꺾는다. 로밍 NPC처럼 긴 L자(꺾임 최소) 경로가 되어, 잔톱니 계단이 대각선으로 뭉쳐 보이던 문제를 없앤다.
  const cells: number[] = [startIdx];
  {
    const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let cur = startIdx;
    let curDir = -1;
    let guard = 0;
    while (cur !== end && guard < cols * rows) {
      guard++;
      const c = cur % cols;
      const r = (cur - c) / cols;
      let nxt = -1;
      let nxtDir = -1;
      if (curDir !== -1) {
        const [dc, dr] = dirs[curDir];
        const nc = c + dc;
        const nr = r + dr;
        if (nc >= 0 && nr >= 0 && nc < cols && nr < rows) {
          const ni = idx(nc, nr);
          if (walkable(nc, nr) && gdist[ni] === gdist[cur] - 1) {
            nxt = ni;
            nxtDir = curDir;
          }
        }
      }
      if (nxt === -1) {
        for (let di = 0; di < 4; di++) {
          const [dc, dr] = dirs[di];
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const ni = idx(nc, nr);
          if (walkable(nc, nr) && gdist[ni] === gdist[cur] - 1) {
            nxt = ni;
            nxtDir = di;
            break;
          }
        }
      }
      if (nxt === -1) break;
      cells.push(nxt);
      cur = nxt;
      curDir = nxtDir;
    }
  }
  // 격자 셀 경로에서 '방향이 바뀌는 점'만 남긴다 — 그 사이는 한 축 직선이라 걸음으로 쪼개기 좋다.
  const route: Position[] = [{ x: cxOf(sc), y: cyOf(sr) }];
  for (let i = 1; i < cells.length - 1; i++) {
    const pc = cells[i - 1] % cols;
    const qc = cells[i] % cols;
    const nc = cells[i + 1] % cols;
    const pr = (cells[i - 1] - pc) / cols;
    const qr = (cells[i] - qc) / cols;
    const nr = (cells[i + 1] - nc) / cols;
    if (qc - pc !== nc - qc || qr - pr !== nr - qr) route.push({ x: cxOf(qc), y: cyOf(qr) });
  }
  const ec = end % cols;
  const er = (end - ec) / cols;
  route.push({ x: cxOf(ec), y: cyOf(er) }); // 도달점 격자 셀(목표 or 그에 가장 가까운 열린 자리)
  return route;
}

// 사수·신입이 걸어갈 '걸음(=CSS transition 한 번)' 목록(시작점 제외, 각 코너와 목표점 포함).
// guideRoute의 꺾는 점(코너)들을 그대로 한 걸음씩 쓴다. 예전엔 코너 사이 직선을 96px씩 잘게
// 쪼갰는데, 각 조각이 독립된 ease-in-out이라 96px마다 속도가 0으로 떨어져(가속-감속 반복) 직진
// 중에도 로봇처럼 '멈칫멈칫' 걸었다(leg당 8~19회, .localtest/sim으로 계측). 코너 단위로 이으면
// 직선 한 구간을 한 번의 ease-in-out으로 활공 — 로밍 NPC와 같은 자연스러운 걸음이 된다.
// guideRoute는 항상 직교 경로를 돌려주므로(목표가 막혔으면 가장 가까운 바닥까지) 대각선 폴백은 없다.
function planGuideHops(
  start: Position,
  target: Position,
  collisions: Array<{ x: number; y: number; w: number; h: number }>,
): Position[] {
  return guideRoute(start, target, collisions).slice(1);
}

export function ScenarioGamePage() {
  const [isHintOpen, setIsHintOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isMemoOpen, setIsMemoOpen] = useState(false);
  const [isWorkflowOpen, setIsWorkflowOpen] = useState(false);
  const [isAudioSettingsOpen, setIsAudioSettingsOpen] = useState(false);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [scenarioTheme, setScenarioTheme] = useState<ScenarioTheme>(() => {
    const savedTheme = localStorage.getItem("scenario-theme");
    return savedTheme === "deep-space" || savedTheme === "aurora" ? savedTheme : "nebula";
  });
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [isBgmEnabled, setIsBgmEnabled] = useState(
    () => localStorage.getItem("scenario-bgm-enabled") !== "false",
  );
  const [bgmVolume, setBgmVolume] = useState(() =>
    savedVolume(BGM_VOLUME_KEY, DEFAULT_BGM_VOLUME),
  );
  const [coachVolume, setCoachVolume] = useState(() =>
    savedVolume(COACH_VOLUME_KEY, DEFAULT_COACH_VOLUME),
  );
  const [selectedCoachId, setSelectedCoachId] = useState<CoachAvatarId>(
    () => getStoredCoachId() ?? "male",
  );
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null);
  const bgmEnabledRef = useRef(isBgmEnabled);
  const bgmVolumeRef = useRef(bgmVolume);
  const savedBgmVolumeRef = useRef(bgmVolume);
  const savedCoachVolumeRef = useRef(coachVolume);
  const selectedCoachIdRef = useRef<CoachAvatarId>(selectedCoachId);
  const savedCoachIdRef = useRef<CoachAvatarId>(selectedCoachId);
  const [coachMessage, setCoachMessage] = useState(DEFAULT_COACH_MESSAGE);

  // ── AI 아바타 발화 (LIVE 패널) ──────────────────────────────────────────
  // coachMessage는 연결상태·에러 문구까지 포함해 18곳에서 갱신되지만, 그중
  // "코치가 실제로 하는 말"(안내·팁·피드백)만 아바타가 말해야 한다. speakCoach는
  // 그 구분을 위한 래퍼 — 시스템 문구는 지금처럼 setCoachMessage를 그대로 쓴다.
  const museTalkRequestIdRef = useRef(0);
  const lastSpokenRef = useRef<string | null>(null);
  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus>("idle");
  const [museTalkRequest, setMuseTalkRequest] =
    useState<(MuseTalkSpeakRequest & { id: number }) | null>(null);

  // 코치가 '실질 조언'(대화 TIP·과제 리뷰·피드백)을 한 뒤인가 — 그렇다면 위치 안내 문구로
  // 덮어쓰지 않는다. 스텝이 바뀌면 초기화한다.
  const coachAdvisedRef = useRef(false);

  const speakCoach = useCallback((text: string) => {
    setCoachMessage(text);
    const trimmed = text.trim();
    // 같은 문장이 effect 재실행 등으로 다시 들어와도 중복 재생하지 않는다.
    if (!trimmed || trimmed === lastSpokenRef.current) return;
    lastSpokenRef.current = trimmed;
    setMuseTalkRequest({
      id: ++museTalkRequestIdRef.current,
      text: trimmed,
      avatar_id: selectedCoachIdRef.current,
    });
    setAvatarStatus("speaking");
  }, []);

  const handleAvatarSpeakingEnd = useCallback(() => {
    setMuseTalkRequest(null);
    setAvatarStatus("idle");
  }, []);

  const handleAvatarSpeakingError = useCallback(() => {
    setMuseTalkRequest(null);
    setAvatarStatus("idle");
  }, []);

  const [playerPosition, setPlayerPosition] = useState<Position>({ x: 420, y: 290 });
  const [npcLivePositions, setNpcLivePositions] = useState<Record<string, Position>>({});
  const [stageScale, setStageScale] = useState(getStageScale);

  // 시뮬레이션(게임) 연결 상태
  const [connStatus, setConnStatus] = useState<ConnectionStatus>("creating");
  const [activeStep, setActiveStep] = useState<GameStep | null>(null);
  const [npcs, setNpcs] = useState<GameNpc[]>([]);
  const [gameMap, setGameMap] = useState<Simulation["map"]>(null);
  const [minigame, setMinigame] = useState<Simulation["minigame"]>(null);
  const [minigames, setMinigames] = useState<Simulation["minigames"]>([]);
  const [scenarioSlug, setScenarioSlug] = useState("");
  const [scenarioTitle, setScenarioTitle] = useState("");
  const [stepIds, setStepIds] = useState<string[]>([]); // 본편 미션 순서 (진행률 계산용)
  // 진행 페이즈 — "지금 무엇을 하는 중인지"의 단일 출처. 전이는 아래 handle*/소켓 핸들러에서만.
  const [phase, setPhase] = useState<GamePhase>("loading");
  const [retryKey, setRetryKey] = useState(0);
  const [taskResult, setTaskResult] = useState<TaskResultFrame | null>(null);
  const [quest, setQuest] = useState<{ title: string; task: GameTask; banner?: string } | null>(null);
  const [greetSent, setGreetSent] = useState(false);
  // 투어 인사에서 '그 동료를 눌러 대화를 연' 상태 — 근처에 갔다고 채팅창이 저절로 열리면
  // 입력창이 방향키를 가져가 캐릭터가 멈춘다. 마우스로 누르기 전까지는 열지 않는다.
  const [tourGreetOpened, setTourGreetOpened] = useState(false);
  const [farewell, setFarewell] = useState<{ name: string; text: string } | null>(null); // 통과 격려 배너
  const npcsRef = useRef<GameNpc[]>([]); // 코치 안내 문구용 로스터(핸들러 클로저의 stale 방지)
  const [npcMessage, setNpcMessage] = useState("");
  const [userMessage, setUserMessage] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [dialogueHistory, setDialogueHistory] = useState<DialogueHistoryEntry[]>([]);
  const dialogueSequenceRef = useRef(0);
  const [chatNpcId, setChatNpcId] = useState<string | null>(null); // 대화 상대(마커 클릭). null=미션 담당 NPC
  // 지금 말 거는 NPC와 마지막으로 말 건 시각 — 로밍 중인 NPC를 멈춰 세우는 데 쓴다(5초 무발화면 재개).
  const [talk, setTalk] = useState<{ id: string | null; at: number }>({ id: null, at: 0 });
  // 타이핑 등 대화 활동 — 세션 타임아웃을 리셋해 대화 중엔 NPC가 계속 멈춰 있게 한다.
  const bumpTalk = useCallback(() => {
    setTalk((t) => (t.id ? { id: t.id, at: Date.now() } : t));
  }, []);
  // 대화 세션 자동 종료 — 마지막 활동(클릭·발화·타이핑) 후 5초간 활동이 없고 NPC 응답 중도
  // 아니면 세션을 끝낸다: NPC 정지 해제 + 자유 대화였다면 컷신(입상 일러스트)도 함께 내린다.
  // "대화 중엔 계속 멈춤 / 대화가 끝나 NPC가 움직이면 컷신도 같이 사라짐"을 하나로 맞춘다.
  useEffect(() => {
    if (!talk.id || isStreaming) return;
    const wasFreeChat = chatNpcId !== null;
    const timer = setTimeout(() => {
      setTalk({ id: null, at: 0 });
      if (wasFreeChat) {
        setChatNpcId(null);
        setNpcMessage("");
        setUserMessage("");
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [talk, isStreaming, chatNpcId]);
  const [mapImage, setMapImage] = useState<string>(INITIAL_SCENARIO_MAP_IMAGE);
  // 미달할수록 깊어지는 조언 카드 — 스텝(또는 퀘스트)당 누적, 힌트 패널에 쌓인다.
  const [adviceCards, setAdviceCards] = useState<AdviceCard[]>([]);
  // 미션 통과 후 AI 코치 사후 리뷰 (근거 기반 카드)
  const [coachCards, setCoachCards] = useState<CoachCardsFrame | null>(null);
  const [briefedSteps, setBriefedSteps] = useState<string[]>([]); // 브리핑을 본 스텝 id (스텝당 1회)
  // 대화형 학습 시나리오는 설명 모달 대신 담당 NPC와 업무 과정을 주고받은 뒤 문제를 연다.
  const [processLearningReady, setProcessLearningReady] = useState(false);
  // 1단계 진행도 — 인사를 나눈 동료 목록(서버 state.met_npcs). 전원과 인사해야 업무가 열린다.
  const [, setMetNpcs] = useState<string[]>([]);
  // 1단계 온보딩 투어(컷신) — 사수가 데리고 다니며 팀원을 소개한다. index: 0..stops-1, stops면 마무리.
  const [tour, setTour] = useState<TourFrame | null>(null);
  const [tourIndex, setTourIndex] = useState(0);
  const [tourDone, setTourDone] = useState(false); // 서버 state.tour_done 미러 — 업무 게이트
  const [tourRequestPending, setTourRequestPending] = useState(false);
  // 빠른 연속 클릭은 React가 다시 렌더링하기 전에도 들어올 수 있어 ref로 즉시 잠근다.
  const tourRequestPendingRef = useRef(false);
  // 이미 시작된 투어에 뒤늦은 중복 응답이 도착해 입력 단계를 처음으로 되감지 못하게 한다.
  const tourStartedRef = useRef(false);
  const [reflectionSending, setReflectionSending] = useState(false);
  const [memo, setMemo] = useState("");
  const [memoSaveStatus, setMemoSaveStatus] = useState<MemoSaveStatus>("idle");
  const pendingMemoRef = useRef<string | null>(null);
  // 실무 게임 결과 저장 ACK를 받은 뒤에만 활동 완료를 보내 모달을 닫는다.
  // 저장보다 먼저 다음 활동으로 넘어가 결과가 유실되는 일을 막는다.
  const pendingMinigameActivityRef = useRef<{
    gameId: string;
    engine: string;
  } | null>(null);
  const socketRef = useRef<SimulationSocket | null>(null);
  const simIdRef = useRef<number | null>(null);
  // 이 체험이 붙은 상담 id — 서버가 sim에 실어주면 그걸 쓰고(재개해도 유지), 없으면 URL 값 폴백.
  const consultationIdRef = useRef<number | null>(CONSULTATION_ID);
  // 완주 시 리포트 반영은 1회만 — 서버가 state_updated를 재전송해도 중복 생성하지 않는다.
  const reportSyncStartedRef = useRef(false);
  const [reportSyncStatus, setReportSyncStatus] = useState<"idle" | "pending" | "done" | "error">("idle");

  const appendDialogue = useCallback(
    (speaker: string, role: DialogueHistoryEntry["role"], rawText: string) => {
      const text = rawText.replace(/^\s*\[[^\]]{1,20}\]\s*/, "").trim();
      if (!text) return;
      setDialogueHistory((current) => {
        const previous = current.at(-1);
        if (previous?.speaker === speaker && previous.role === role && previous.text === text) return current;
        dialogueSequenceRef.current += 1;
        return [...current, { id: dialogueSequenceRef.current, speaker, role, text }];
      });
    },
    [],
  );

  // 현재 스텝의 대화 상대 NPC (step.npcs[0]) — 표시정보는 npcs 로스터에서 조회
  const activeNpcId = activeStep?.npcs?.[0] ?? null;
  const activeNpc = npcs.find((npc) => npc.npc_id === activeNpcId) ?? null;
  const activeActivity = activeStep?.activity ?? null;
  const usesConversationLearning =
    CONVERSATION_LEARNING_SCENARIOS.has(scenarioSlug) && Boolean(activeStep?.task) && !quest;
  const activeActivityGame =
    activeActivity?.kind === "minigame"
      ? minigames.find((game) => game.id === activeActivity.game_id) ?? null
      : null;
  // 대화 상대 = 마커로 선택한 NPC(chatNpcId), 없으면 미션 담당 NPC.
  const chatTargetId = chatNpcId ?? activeNpcId;
  const chatNpc = npcs.find((npc) => npc.npc_id === chatTargetId) ?? activeNpc;
  const hints = useMemo(
    () => buildHints(activeStep, adviceCards, coachCards, briefedSteps.includes(activeStep?.id ?? "")),
    [activeStep, adviceCards, coachCards, briefedSteps],
  );
  // 진행률 = 완료한 본편 미션 수 / 전체. 소감문 단계에 도달하면 업무 체험은 100% 완료다.
  // 돌발 퀘스트는 stepIds에 없어 제외된다.
  const progress = phase === "reflection" || phase === "completed"
    ? 100
    : stepIds.length
      ? Math.round((Math.max(0, stepIds.indexOf(activeStep?.id ?? "")) / stepIds.length) * 100)
      : 0;
  // 미션 패널에 띄울 대상 — 돌발 퀘스트가 있으면 우선, 없으면 현재 스텝 미션.
  const activeMission: MissionView | null = quest
    ? { title: quest.title, task: quest.task, banner: quest.banner }
    : activeStep?.task
      ? // 제공자료를 과제 창 안에서 바로 펼쳐볼 수 있게 넘긴다 — 자료를 대조해야 푸는 과제라
        // 창을 닫고 힌트 패널을 열었다 돌아오면 작성 흐름이 끊긴다.
        { title: activeStep.title, task: activeStep.task, materials: activeStep.materials }
      : null;

  // 현재 미션 담당 NPC의 맵 좌표(로컬) — 근접 판정·마커 강조에 사용.
  const activeNpcMarker = useMemo(() => {
    if (activeNpc?.npc_id && npcLivePositions[activeNpc.npc_id]) {
      return npcLivePositions[activeNpc.npc_id];
    }
    const geo = gameMap?.geometry;
    const origin = geo?.walkable?.[0];
    const spot = geo?.spawns?.find((spawn) => spawn.id === activeNpc?.spawn);
    if (!geo || !origin || !spot) return null;
    const members = npcs.filter((npc) => npc.spawn === activeNpc?.spawn);
    const index = members.findIndex((npc) => npc.npc_id === activeNpc?.npc_id);
    const spread = Math.ceil(index / 2) * SLOT_SPREAD * (index % 2 === 1 ? 1 : -1);
    return { x: spot.x - origin.x + spread, y: spot.y - origin.y };
  }, [gameMap, activeNpc, npcs, npcLivePositions]);

  const isNearActiveNpc =
    activeNpcMarker != null &&
    Math.hypot(
      playerPosition.x + PLAYER_SIZE.width / 2 - activeNpcMarker.x,
      playerPosition.y + PLAYER_SIZE.height / 2 - activeNpcMarker.y,
    ) < ENCOUNTER_RADIUS;

  // 1단계 — 사수에게 다가가 인사를 청하면 투어가 시작되고, 투어를 마쳐야 업무가 열린다.
  // (투어가 각 동료에게 직접 인사를 시키므로 '전원과 인사'는 투어 완료로 보장된다)
  const isFirstStep = Boolean(activeStep && stepIds.length > 0 && activeStep.id === stepIds[0]);
  const needsTour = isFirstStep && !tourDone;

  // 담당 NPC 근처 + 미션 미진행일 때만 업무 배너 표시 (순차 진행 — 현재 스텝 NPC에게만 뜬다).
  // 자유 이동 중(exploring) 담당 NPC 근처일 때만 업무 배너 — 컷신·모달 중에는 뜨지 않는다.
  const showEncounter =
    phase === "exploring" &&
    !tourRequestPending &&
    isNearActiveNpc &&
    !farewell && // 격려 배너가 떠 있는 동안은 업무 배너 숨김
    Boolean(activeStep?.task || activeActivity);

  // ── 1단계 온보딩 투어(컷신) ──
  // 사수가 앞장서고 신입이 따라붙는다. 각 동료의 spawn 옆에 멈춰 사수가 소개하고, 마지막에
  // 오늘 업무 흐름을 짚어준 뒤 끝난다. 좌표는 geometry.spawns 기준(로컬 = spawn - walkable 원점).
  const spawnPos = useCallback(
    (npcId: string): Position | null => {
      const geo = gameMap?.geometry;
      const origin = geo?.walkable?.[0];
      const slot = npcs.find((npc) => npc.npc_id === npcId)?.spawn;
      const spot = geo?.spawns?.find((s) => s.id === slot);
      if (!geo || !origin || !spot) return null;
      // 자리가 3개뿐이라 여러 명이 같은 자리를 쓴다 — MovementArea와 같은 규칙으로 벌린 위치를
      // 계산해야 사수가 그 사람 앞에 정확히 선다(마커와 어긋나면 엉뚱한 데서 소개하게 됨).
      const members = npcs.filter((npc) => npc.spawn === slot);
      const index = members.findIndex((npc) => npc.npc_id === npcId);
      const step = Math.ceil(index / 2) * SLOT_SPREAD * (index % 2 === 1 ? 1 : -1);
      return { x: spot.x - origin.x + step, y: spot.y - origin.y };
    },
    [gameMap, npcs],
  );

  const tourStop = tour && tourIndex < tour.stops.length ? tour.stops[tourIndex] : null;
  const tourActive = TOUR_PHASES.has(phase);

  // 투어 인사(tour_greet) — 신입이 그 동료 '옆까지 걸어가야' 인사를 보낼 수 있다.
  // (멀리 떨어진 자리에서 인사가 성립하면 소개 장면 자체가 성립하지 않는다.)
  const tourStopMarker = useMemo(() => {
    const npcId = tourStop?.npc;
    if (!npcId) return null;
    // 동료는 투어가 시작되면 '그 자리에서' 멈춘다(MovementArea) — 그 좌표가 npcLivePositions로
    // 올라오므로 여기서도 그걸 쓴다. 사수가 찾아갈 목표(tourAnchor)·카메라·근접 판정이 모두 같은
    // 좌표를 봐야 실제로 서 있는 사람 옆에서 소개하고 인사할 수 있다(로밍 경로가 없으면 spawn).
    return npcLivePositions[npcId] ?? spawnPos(npcId);
  }, [tourStop, npcLivePositions, spawnPos]);
  const isNearTourStop =
    tourStopMarker != null &&
    Math.hypot(
      playerPosition.x + PLAYER_SIZE.width / 2 - tourStopMarker.x,
      playerPosition.y + PLAYER_SIZE.height / 2 - tourStopMarker.y,
    ) < ENCOUNTER_RADIUS;
  // 투어 자막과 하단 대화창이 서로 다른 상태를 보지 않도록 현재 발화자와 대사를 한곳에서 계산한다.
  // 인사를 입력하기 전까지는 직전에 말한 사수의 소개를 유지하고, 전송한 순간부터
  // 작성 중 말풍선과 스탠딩의 화자를 인사받는 동료로 전환한다.
  const tourReplyStarted =
    phase === "tour_reply" ||
    (phase === "tour_greet" &&
      (userMessage.trim().length > 0 || npcMessage.trim().length > 0 || isStreaming));
  const tourDialogueSpeaker =
    phase === "tour_closing" || !tourReplyStarted
      ? tour?.guide ?? tourStop
      : tourStop ?? tour?.guide;
  const tourDialogueMessage =
    phase === "tour_opening"
      ? tour?.opening ?? "" // 사수 자기소개
      : phase === "tour_closing"
        ? tour?.closing ?? ""
        : tourReplyStarted
          ? npcMessage
          : tourStop?.line ?? "";
  const visibleChatNpc = tourActive ? tourDialogueSpeaker ?? chatNpc : chatNpc;
  const visibleNpcMessage = tourActive ? tourDialogueMessage : npcMessage;
  const visibleChatNpcId = tourActive
    ? tourDialogueSpeaker?.npc ?? chatNpc?.npc_id
    : chatNpc?.npc_id;
  const standingIllustrationSrc = visibleChatNpcId
    ? NPC_STANDING_ILLUSTRATIONS[visibleChatNpcId]
    : undefined;
  const npcPortraitSrcBySpeaker = useMemo(() => {
    const portraitEntries: Array<[string, string]> = [];

    for (const npc of npcs) {
      const portraitSrc = NPC_STANDING_ILLUSTRATIONS[npc.npc_id];
      if (npc.name.trim() && portraitSrc) {
        portraitEntries.push([npc.name.trim(), portraitSrc]);
      }
    }

    if (tour?.guide) {
      const portraitSrc = NPC_STANDING_ILLUSTRATIONS[tour.guide.npc];
      if (tour.guide.name.trim() && portraitSrc) {
        portraitEntries.push([tour.guide.name.trim(), portraitSrc]);
      }
    }

    for (const stop of tour?.stops ?? []) {
      const portraitSrc = NPC_STANDING_ILLUSTRATIONS[stop.npc];
      if (stop.name.trim() && portraitSrc) {
        portraitEntries.push([stop.name.trim(), portraitSrc]);
      }
    }

    return Object.fromEntries(portraitEntries);
  }, [npcs, tour]);
  const showStandingIllustration = Boolean(
    standingIllustrationSrc &&
      !MODAL_PHASES.has(phase) &&
      !isHistoryOpen &&
      !isMemoOpen &&
      !isWorkflowOpen &&
      (tourActive ||
        chatNpcId !== null ||
        isStreaming ||
        visibleNpcMessage.trim().length > 0 ||
        userMessage.trim().length > 0),
  );

  // 위 자막에서 지나간 사수의 소개와 마무리도 이전 대화 목록에 남긴다.
  // 동료 답변은 onNpcReply에서 완성된 문장으로 별도 기록한다.
  useEffect(() => {
    if (!tour?.guide) return;
    if (phase === "tour_opening" && tour.opening) {
      appendDialogue(tour.guide.name || "사수", "npc", tour.opening);
    } else if (phase === "tour_intro" && tourStop?.line) {
      appendDialogue(tour.guide.name || "사수", "npc", tourStop.line);
    } else if (phase === "tour_closing" && tour.closing) {
      appendDialogue(tour.guide.name || "사수", "npc", tour.closing);
    }
  }, [appendDialogue, phase, tour, tourStop]);

  // 투어 컷신 자리 배치가 책상 위에 놓이지 않게 검증할 충돌 박스(로컬 좌표) — MovementArea와 같은
  // origin(walkable[0]) 기준으로 옮겨야 tourAnchor(=spawnPos, 이미 로컬 좌표)와 좌표계가 맞는다.
  const tourCollisions = useMemo(() => {
    const geo = gameMap?.geometry;
    const origin = geo?.walkable?.[0];
    if (!geo?.collision || !origin) return [];
    // 좌표계 보정: 사수 컷신 좌표(guidePosition)는 '마커 중심'인데 tourCollidesAt은 좌표를
    // '플레이어 박스 좌상단'으로 보고 발판박스를 (+38,+83) 위치에서 검사한다. 그대로 두면 사수의
    // 실제 발밑이 아니라 그보다 83px 아래를 판정해, 옆자리가 비었는데도 막힌 줄 알고 엉뚱한 데
    // (예: 바 건너편) 가서 서는 문제가 생긴다. 집기를 같은 벡터만큼 옮겨 두면 겹침 판정이
    // 정확히 마커 중심 기준이 된다(두 사각형을 같은 방향으로 옮기면 겹침 여부는 그대로).
    return geo.collision.map((c) => ({
      x: c.x - origin.x + GUIDE_MARKER_DX,
      y: c.y - origin.y + GUIDE_MARKER_DY,
      w: c.w,
      h: c.h,
    }));
  }, [gameMap]);

  // 투어 중 사수·플레이어가 서 있을 자리 — 소개 대상 옆(마무리 때는 사수 자리로 돌아온다).
  const tourAnchor = useMemo(() => {
    if (!tour) return null;
    // 자기소개(tour_opening) 동안엔 사수가 첫 동료에게 걸어가지 않고 제 자리에 머문다.
    if (phase === "tour_opening") {
      const guideNpc = tour.guide?.npc;
      return guideNpc ? spawnPos(guideNpc) : null; // 사수 본인은 컷신 좌표가 권한이라 제 자리 기준
    }
    // 소개 대상은 투어가 시작될 때 '그 자리에서' 멈춘 좌표로 찾아간다(로밍 경로가 없으면 spawn).
    return tourStopMarker ?? (tour.guide?.npc ? spawnPos(tour.guide.npc) : null);
  }, [tour, tourStopMarker, spawnPos, phase]);
  // 다음 스톱으로 넘어갈 때 사수는 로밍 NPC처럼 상하좌우로 걸어간다(대각선 금지).
  // planGuideHops가 만든 걸음 목록(코너 단위)을 순서대로 setTimeout으로 재생 — 걸음(코너~코너 직선)
  // 하나가 CSS transition 한 번(= MovementArea guideHopMsRef, 같은 공식)이라 예약 간격을 그 시간과 맞춘다.
  const [guidePosition, setGuidePosition] = useState<Position | null>(null);
  const guidePosRef = useRef<Position | null>(null);
  guidePosRef.current = guidePosition;
  const guideHopTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    guideHopTimersRef.current.forEach(clearTimeout);
    guideHopTimersRef.current = [];
    if (!tourActive) {
      // 투어 종료 — 사수는 자기 자리(원위치)로 '걸어서' 복귀한 뒤에야 컷신 좌표를 해제한다.
      // 예전엔 여기서 곧장 setGuidePosition(null)이라, 마커가 마지막 스톱에서 자기 책상까지
      // (최대 ~1320px) 순식간에 튀어 텔레포트처럼 보였다. 이제 planGuideHops 직교 경로를 걸어
      // 복귀하고(로밍 NPC와 동일 활공), 도착 후 좌표를 해제해 spawn 렌더로 매끄럽게 이어붙인다.
      const start = guidePosRef.current;
      const guideNpc = tour?.guide?.npc;
      const home = guideNpc ? spawnPos(guideNpc) : null;
      if (!start || !home) {
        setGuidePosition(null);
        return;
      }
      const hops = planGuideHops(start, home, tourCollisions);
      let prev = start;
      let i = 0;
      const walkHome = () => {
        if (i >= hops.length) {
          // 도착 — 마지막 hop은 격자 스냅이라 home(=spawn 렌더 좌표)과 오차 <16px. 여기서 컷신
          // 좌표를 풀면 마커는 같은 좌표의 spawn 렌더로 이어져 순간이동 없이 자연스럽게 정지한다.
          setGuidePosition(null);
          return;
        }
        const hop = hops[i];
        const d = tourHopDurationMs(prev, hop);
        setGuidePosition(hop);
        prev = hop;
        i += 1;
        guideHopTimersRef.current = [setTimeout(walkHome, d)];
      };
      walkHome();
      return () => {
        guideHopTimersRef.current.forEach(clearTimeout);
      };
    }
    if (!tourAnchor) {
      setGuidePosition(null);
      return;
    }
    // 소개 대상 바로 옆에 선다 — 옆자리가 막혔을 때만 근처 빈자리로 물러난다.
    const target = besideSpot(tourAnchor, tourCollisions);
    // 첫 등장(guidePosition이 아직 null)엔 좌표만 콕 찍어 두면 안 된다 — 마커가 직전 렌더 위치
    // (자기 spawn)에서 이 좌표까지 CSS transition으로 '대각선 활공'하며 맵을 가로지른다(사수 대각선의
    // 진짜 원인). 대신 자기 spawn을 출발점으로 삼아 planGuideHops로 상하좌우로 '걸어서' 첫 동료에게
    // 간다 — 첫 걸음도 한 축(직교)이라 대각선이 사라지고, 순간이동 없이 자연스럽게 등장한다.
    const guideNpc = tour?.guide?.npc;
    const firstAppearance = !guidePosRef.current;
    const start = guidePosRef.current ?? (guideNpc ? spawnPos(guideNpc) : null);
    if (!start) {
      setGuidePosition(guideSnap(target, tourCollisions));
      return;
    }
    const hops = planGuideHops(start, target, tourCollisions);
    if (firstAppearance && hops.length > 0) {
      // spawn은 격자(16px)에 안 맞을 수 있어, 격자 코너인 첫 hop으로 곧장 가면 첫 걸음이 미세하게
      // 비스듬(≤8px)해진다. 그 대신 '한 축만' 먼저 맞추는 정렬 걸음을 앞에 끼운다 — spawn의 실제
      // 좌표 하나를 유지한 채 다른 축만 코너로 옮기면, 남은 잔차는 바로 다음(역시 한 축) 걸음에서
      // 흡수돼, 모든 걸음이 정확히 상하좌우가 된다(sim first-appear leg가 이 불변식을 강제 검증).
      const f = hops[0];
      const aligned =
        Math.abs(f.x - start.x) >= Math.abs(f.y - start.y)
          ? { x: f.x, y: start.y } // 첫 코너가 주로 가로 이동 → 세로(y)는 spawn 값 유지 = 순수 가로 걸음
          : { x: start.x, y: f.y }; // 첫 코너가 주로 세로 이동 → 가로(x)는 spawn 값 유지 = 순수 세로 걸음
      hops.unshift(aligned);
    }
    // 걸음을 미리 절대시각으로 몽땅 예약하지 않고 "이 걸음이 끝나면 다음 걸음"으로 이어 예약한다.
    // 미리 예약하면 스레드가 잠깐 멈춰 타이머가 밀릴 때 밀린 걸음들이 한꺼번에 실행돼 여러 코너를
    // 건너뛰며 순간이동처럼 튄다 — 순차 예약이면 각 걸음이 실제 시작 시점 기준으로 제 시간을 받는다.
    let prev = start;
    let i = 0;
    const walk = () => {
      if (i >= hops.length) return;
      const hop = hops[i];
      const d = tourHopDurationMs(prev, hop);
      setGuidePosition(hop);
      prev = hop;
      i += 1;
      if (i < hops.length) guideHopTimersRef.current = [setTimeout(walk, d)];
    };
    walk();
    return () => {
      guideHopTimersRef.current.forEach(clearTimeout);
    };
  }, [tourActive, tourAnchor, tourCollisions, tour, spawnPos]);

  // 투어(컷신) 동안 신입은 사수를 자동으로 따라가지 않는다 — 사수만 팀원에게 걸어가 소개하고
  // 신입은 제자리(개방된 시작 자리)에 머문다. 대사는 배너·버튼으로 진행한다.
  // (예전엔 신입을 사수 옆으로 자동 이동시켰는데, 마지막 스톱이 계산대-바 사이 좁은 자리면
  //  거기 처박혀 '끼여서 안 움직이는' 문제가 있었다.) 투어 중엔 카메라가 사수를 비추고
  //  (아래 MovementArea cameraFocus), 투어가 끝나면 신입이 직접 걸어 미션 NPC에게 간다.

  // 투어 전이: 사수 소개(tour_intro) → 신입이 직접 인사(tour_greet) → 동료 응답(tour_reply)
  //          → 다음 동료 / 마지막이면 사수 마무리(tour_closing) → exploring
  const handleTourNext = useCallback(() => {
    if (!tour) return;
    if (phase === "tour_opening") {
      // 사수 자기소개를 들었으면 이제 동료 소개로 넘어간다.
      setPhase("tour_intro");
      return;
    }
    if (phase === "tour_intro") {
      // 소개를 들었으면 이제 신입이 직접 인사한다 — 여기서 화법(호감도)이 평가된다.
      setChatNpcId(tour.stops[tourIndex]?.npc ?? null);
      setNpcMessage("");
      setUserMessage("");
      setTourGreetOpened(false); // 아직 안 눌렀다 — 그 동료를 눌러야 채팅창이 열린다
      setPhase("tour_greet");
      return;
    }
    if (phase === "tour_reply") {
      const next = tourIndex + 1;
      setNpcMessage("");
      setUserMessage("");
      if (next < tour.stops.length) {
        setTourIndex(next);
        setPhase("tour_intro");
      } else {
        setPhase("tour_closing");
      }
      return;
    }
    if (phase === "tour_closing") {
      socketRef.current?.sendTourDone(); // 투어 완료 기록(새로고침해도 다시 안 틀게)
      setTourDone(true);
      setChatNpcId(null);
      setPhase("exploring");
    }
  }, [tour, tourIndex, phase]);

  // 1단계 안내 — 인사가 남았으면 누구를 만나야 하는지, 다 만났으면 업무를 받으러 가라고 안내한다.
  // 스트리밍 중에는 건드리지 않는데, 그것만으로는 부족했다: isStreaming이 deps에 있어서 대화가
  // '끝나는 순간' 이 effect가 다시 돌며 방금 받은 코치 TIP·리뷰를 안내 문구로 덮어썼다
  // (코치가 조언을 해도 화면엔 "…님에게 다가가면 업무를 받을 수 있어요"만 남던 원인).
  // 그래서 코치가 실질 조언을 한 뒤에는 이 안내를 다시 말하지 않는다 — 스텝이 바뀌면 초기화된다.
  useEffect(() => {
    if (phase !== "exploring" || isStreaming || npcs.length === 0) return;
    if (coachAdvisedRef.current) return;
    speakCoach(
      needsTour ? introGuide(activeStep, npcsRef.current) : approachGuide(activeStep, npcsRef.current),
    );
  }, [phase, needsTour, npcs.length, isStreaming, activeStep]);

  // 스텝이 바뀌면 이전 스텝의 조언은 지나간 것 — 새 업무 안내를 다시 해준다.
  useEffect(() => {
    coachAdvisedRef.current = false;
  }, [activeStep?.id]);

  // 담당 NPC에게 처음 다가가면 실시간 인사를 1회 요청 (스텝당 1회, 응답 오면 채팅창에 표시).
  // 담당 NPC 인사는 업무를 건네는 대사다 — 팀 소개(투어)를 받기 전에 다가갔다고 해서
  // "왔어? 이것부터 점검해 줘"가 튀어나오면 안 된다. 투어를 마친 뒤부터 요청한다.
  useEffect(() => {
    // 대화형 업무 학습은 업무 받기 시점에 프로세스 안내를 직접 시작한다.
    // 별도 인사를 함께 요청하면 늦게 도착한 응답이 안내 아래에 붙어 순서가 뒤집힌다.
    if (CONVERSATION_LEARNING_SCENARIOS.has(scenarioSlug)) return;
    if (showEncounter && !needsTour && !greetSent && socketRef.current?.sendGreet()) {
      setGreetSent(true);
    }
  }, [scenarioSlug, showEncounter, needsTour, greetSent]);

  // 격려('고생했다') 배너는 약 3초 뒤 자동으로 닫힌다.
  useEffect(() => {
    if (!farewell) return;
    const timer = window.setTimeout(() => setFarewell(null), 3000);
    return () => window.clearTimeout(timer);
  }, [farewell]);

  useEffect(() => {
    const handleResize = () => setStageScale(getStageScale());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    localStorage.setItem("scenario-theme", scenarioTheme);
  }, [scenarioTheme]);

  // 시나리오별 BGM 두 곡 중 첫 곡은 무작위로 고르고, 한 곡이 끝나면 다른 곡으로 교대한다.
  // 브라우저 자동재생 정책에 막히면 첫 클릭/키 입력에서 즉시 재생을 다시 시도한다.
  useEffect(() => {
    const tracks = SCENARIO_BGM_TRACKS[scenarioSlug];
    if (!tracks?.length) return;

    let disposed = false;
    let trackIndex = Math.floor(Math.random() * tracks.length);
    let unlockArmed = false;
    const audio = new Audio();
    bgmAudioRef.current = audio;
    audio.preload = "auto";
    // 저장된 음량이 없으면 공통 기본값(BGM 10%, 코치 TTS 50%)을 적용한다.
    audio.volume = bgmVolumeRef.current;

    const disarmUnlock = () => {
      if (!unlockArmed) return;
      unlockArmed = false;
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };

    const unlockAudio = () => {
      if (disposed || !bgmEnabledRef.current) return;
      void audio.play().then(disarmUnlock).catch(() => undefined);
    };

    const armUnlock = () => {
      if (unlockArmed || disposed) return;
      unlockArmed = true;
      window.addEventListener("pointerdown", unlockAudio);
      window.addEventListener("keydown", unlockAudio);
    };

    const playTrack = () => {
      audio.src = tracks[trackIndex];
      audio.currentTime = 0;
      if (bgmEnabledRef.current) {
        void audio.play().then(disarmUnlock).catch(armUnlock);
      } else {
        audio.load();
      }
    };

    const handleEnded = () => {
      trackIndex = (trackIndex + 1) % tracks.length;
      playTrack();
    };

    audio.addEventListener("ended", handleEnded);
    playTrack();

    return () => {
      disposed = true;
      disarmUnlock();
      audio.removeEventListener("ended", handleEnded);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if (bgmAudioRef.current === audio) bgmAudioRef.current = null;
    };
  }, [scenarioSlug]);

  const handleBgmToggle = useCallback(() => {
    const nextEnabled = !bgmEnabledRef.current;
    bgmEnabledRef.current = nextEnabled;
    setIsBgmEnabled(nextEnabled);
    localStorage.setItem("scenario-bgm-enabled", String(nextEnabled));

    const audio = bgmAudioRef.current;
    if (!audio) return;
    if (nextEnabled) {
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }, []);

  const handleAudioSettingsPreview = useCallback(
    (settings: {
      bgmVolume: number;
      coachVolume: number;
      coachId: CoachAvatarId;
    }) => {
      const nextBgmVolume = Math.min(1, Math.max(0, settings.bgmVolume));
      const nextCoachVolume = Math.min(1, Math.max(0, settings.coachVolume));

      bgmVolumeRef.current = nextBgmVolume;
      setBgmVolume(nextBgmVolume);
      setCoachVolume(nextCoachVolume);
      if (settings.coachId !== selectedCoachIdRef.current) {
        selectedCoachIdRef.current = settings.coachId;
        setSelectedCoachId(settings.coachId);
        setMuseTalkRequest(null);
        setAvatarStatus("idle");
        lastSpokenRef.current = null;
      }

      const audio = bgmAudioRef.current;
      if (!audio) return;
      audio.volume = nextBgmVolume;
      // 슬라이더 입력은 사용자 제스처이므로 자동재생이 막혀 있던 경우에도 이때 미리듣기를 시도한다.
      // 빠른 음소거 상태는 바꾸지 않고, 팝업을 닫을 때 원래 상태로 복구한다.
      if (audio.paused) void audio.play().catch(() => undefined);
    },
    [],
  );

  const handleAudioSettingsCancel = useCallback(() => {
    const previousBgmVolume = savedBgmVolumeRef.current;
    const previousCoachVolume = savedCoachVolumeRef.current;
    const previousCoachId = savedCoachIdRef.current;

    bgmVolumeRef.current = previousBgmVolume;
    setBgmVolume(previousBgmVolume);
    setCoachVolume(previousCoachVolume);
    if (previousCoachId !== selectedCoachIdRef.current) {
      selectedCoachIdRef.current = previousCoachId;
      setSelectedCoachId(previousCoachId);
      setMuseTalkRequest(null);
      setAvatarStatus("idle");
      lastSpokenRef.current = null;
    }
    if (bgmAudioRef.current) {
      bgmAudioRef.current.volume = previousBgmVolume;
      if (!bgmEnabledRef.current) bgmAudioRef.current.pause();
    }
    setIsAudioSettingsOpen(false);
  }, []);

  const handleAudioSettingsSave = useCallback(
    (settings: {
      bgmVolume: number;
      coachVolume: number;
      coachId: CoachAvatarId;
    }) => {
      const nextBgmVolume = Math.min(1, Math.max(0, settings.bgmVolume));
      const nextCoachVolume = Math.min(1, Math.max(0, settings.coachVolume));

      bgmVolumeRef.current = nextBgmVolume;
      savedBgmVolumeRef.current = nextBgmVolume;
      savedCoachVolumeRef.current = nextCoachVolume;
      selectedCoachIdRef.current = settings.coachId;
      savedCoachIdRef.current = settings.coachId;
      setBgmVolume(nextBgmVolume);
      setCoachVolume(nextCoachVolume);
      setSelectedCoachId(settings.coachId);
      localStorage.setItem(BGM_VOLUME_KEY, String(nextBgmVolume));
      localStorage.setItem(COACH_VOLUME_KEY, String(nextCoachVolume));
      saveCoachId(settings.coachId);
      if (bgmAudioRef.current) {
        bgmAudioRef.current.volume = nextBgmVolume;
        if (!bgmEnabledRef.current) bgmAudioRef.current.pause();
      }
      setIsAudioSettingsOpen(false);
    },
    [],
  );

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      setStageScale(getStageScale());
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // 시뮬레이션 생성 → NPC 대화 WebSocket 연결 (마운트 시 1회)
  useEffect(() => {
    let cancelled = false;
    let socket: SimulationSocket | null = null;

    const applySim = (sim: Simulation) => {
      simIdRef.current = sim.id;
      // 새 판을 붙였으면 리포트도 다시 만들어야 한다. 이 플래그를 안 풀면 2회차 완주
      // 결과가 리포트로 넘어가지 않는다(1회차에 true가 된 채 남아 있어서).
      reportSyncStartedRef.current = false;
      setReportSyncStatus("idle");
      // 서버가 저장해둔 상담 연결을 우선 사용 — 이어하기로 URL 파라미터가 없어도 복원된다.
      if (sim.consultation_id != null) consultationIdRef.current = sim.consultation_id;
      setActiveStep(sim.step);
      setNpcs(sim.npcs);
      // 1단계 진행도 복원 — 새로고침해도 인사한 동료·투어 완료는 기억된다(서버 state).
      setMetNpcs((sim.state?.met_npcs as string[] | undefined) ?? []);
      setMemo(typeof sim.state?.memo === "string" ? sim.state.memo : "");
      setMemoSaveStatus("idle");
      pendingMemoRef.current = null;
      setProcessLearningReady(false);
      // 후속 활동까지 마치고 소감문을 기다리는 세션은 그 단계 그대로 복원한다.
      // 그 외에는 자유 이동부터 — 투어는 플레이어가 사수에게 다가가 시작한다.
      setTourDone(Boolean(sim.state?.tour_done));
      tourRequestPendingRef.current = false;
      setTourRequestPending(false);
      tourStartedRef.current = Boolean(sim.state?.tour_done);
      setPhase(sim.state?.workflow_stage === "reflection" ? "reflection" : "exploring");
      npcsRef.current = sim.npcs;
      setGameMap(sim.map);
      setMinigame(sim.minigame ?? null);
      setMinigames(sim.minigames?.length ? sim.minigames : sim.minigame ? [sim.minigame] : []);
      setScenarioSlug(sim.scenario_slug);
      setScenarioTitle(sim.scenario_title);
      setStepIds(sim.step_ids ?? []);
      // 여기서 직접 speakCoach를 부르지 않는다 — phase/npcs/activeStep을 세팅하면
      // 아래 반응형 useEffect(520-527행 부근)가 이어서 실행되며 같은 안내를 speakCoach로
      // 내보낸다. 예전엔 여기서도 직접 불러 **같은 접속에 두 번** 발화가 발동됐는데,
      // 이 함수 안에서 읽는 needsTour는 방금 세팅 중인 tourDone을 반영하지 못한 stale
      // 값이라 항상 approachGuide만 나갔다. 반면 아래 effect는 커밋된 새 값으로
      // introGuide/approachGuide를 정확히 분기한다 — 첫 출근(needsTour=true) 유저는
      // 두 호출이 서로 다른 문장을 발화해 중복방지에 안 걸리고, 두 번째 발화 요청이
      // 첫 번째 WS 연결을 끊어버렸다(2026-07-24 관측: ws_error 반복).
      const scenarioMapFallback = mapImageForScenario(sim.scenario_slug);
      setMapImage(scenarioMapFallback);
      // 플레이어 시작 위치 = geometry의 player spawn(발밑 기준). geometry는 스테이지 좌표라 walkable 원점만큼 뺀다.
      const origin = sim.map?.geometry?.walkable?.[0];
      const playerSpawn = sim.map?.geometry?.spawns?.find((spot) => spot.id === "player");
      if (origin && playerSpawn) {
        setPlayerPosition({
          x: playerSpawn.x - origin.x - PLAYER_SIZE.width / 2,
          y: playerSpawn.y - origin.y - PLAYER_SIZE.height,
        });
      }
      // 배경: 백엔드 맵 이미지가 실제로 로드되면 그것으로 교체한다.
      // 로드 전·실패 시에도 선택한 시나리오의 고정 맵을 유지해 다른 직무 맵이 섞이지 않게 한다.
      const bg = sim.map?.background;
      if (bg) {
        const absolute = `${API_BASE_URL}${bg}`;
        const probe = new Image();
        probe.onload = () => {
          if (!cancelled) setMapImage(absolute);
        };
        probe.onerror = () => {
          if (!cancelled) setMapImage(scenarioMapFallback);
        };
        probe.src = absolute;
      }
    };

    (async () => {
      setConnStatus("creating");
      try {
        const sim = await resumeOrCreate(DEFAULT_SCENARIO_SLUG);
        if (cancelled) return;
        applySim(sim);

        socket = new SimulationSocket(sim.id, {
          onOpen: () => !cancelled && setConnStatus("open"),
          onClose: () => {
            if (cancelled) return;
            setConnStatus("closed");
            pendingMinigameActivityRef.current = null;
            tourRequestPendingRef.current = false;
            setTourRequestPending(false);
            if (pendingMemoRef.current !== null) {
              pendingMemoRef.current = null;
              setMemoSaveStatus("error");
            }
          },
          onError: (detail) => {
            if (cancelled) return;
            setConnStatus("error");
            pendingMinigameActivityRef.current = null;
            tourRequestPendingRef.current = false;
            setTourRequestPending(false);
            setCoachMessage(detail);
            setIsStreaming(false);
            setReflectionSending(false);
            if (pendingMemoRef.current !== null) {
              pendingMemoRef.current = null;
              setMemoSaveStatus("error");
            }
            // 채점 중 오류면 과제 창을 유지한 채 다시 제출할 수 있게 되돌린다.
            setPhase((current) => (current === "mission_grading" ? "mission" : current));
          },
          onToken: (text) => !cancelled && setNpcMessage((prev) => prev + text),
          onNpcReply: (reply) => {
            if (cancelled) return;
            setNpcMessage(reply.content);
            setIsStreaming(false);
            setProcessLearningReady(true);
            appendDialogue(reply.name || "NPC", "npc", reply.content);
            const met = reply.state?.met_npcs as string[] | undefined;
            if (met) setMetNpcs(met); // 방금 인사한 동료 반영 → 1단계 진행도 갱신
            // 투어 중이었다면 그 동료가 인사를 받아준 것 → '다음' 버튼이 열린다.
            setPhase((current) => (current === "tour_greet" ? "tour_reply" : current));
          },
          onTaskResult: (taskResultFrame) => {
            if (cancelled) return;
            setTaskResult(taskResultFrame);
            setPhase("mission_result");
            // 돌발 퀘스트(onQuestResult)는 결과 피드백을 코치 패널에도 띄우는데 본편 미션은 안 그래서
            // "퀴즈 풀었는데 코치가 조언을 안 해준다"는 오인을 낳았다 — 같은 방식으로 맞춘다(2026-07-24).
            if (taskResultFrame.feedback) { coachAdvisedRef.current = true; speakCoach(taskResultFrame.feedback); }
            // 미달 → 조언 카드 누적 (같은 단계는 한 번만). 힌트 패널에서 계속 볼 수 있게.
            const advice = taskResultFrame.advice_card;
            if (advice) {
              setAdviceCards((current) =>
                current.some((card) => card.level === advice.level) ? current : [...current, advice],
              );
              setIsHintOpen(true); // 도움이 도착했음을 바로 보이게
            }
            if (taskResultFrame.passed) {
              // 통과 → 과제 창 닫고 자유 행동으로. 다음 미션은 step_changed가 알려준다.
              setPhase("exploring");
              setFarewell({
                name: taskResultFrame.farewell?.name || "",
                text: taskResultFrame.farewell?.text || "고생하셨어요. 잘 마무리했네요.",
              });
            }
          },
          onNpcGreeting: (greeting) => {
            if (cancelled || !greeting.text) return;
            setChatNpcId(null); // 인사는 미션 담당 NPC 것 — 대화창을 그 NPC로 맞춤
            setNpcMessage(greeting.text); // 인사·업무 문구는 채팅창(NPC 대화창)에만 표시 (배너엔 '오늘의 업무')
            appendDialogue(greeting.name || "NPC", "npc", greeting.text);
          },
          onSuddenQuest: (questFrame) => {
            if (cancelled) return;
            // 돌발 퀘스트 발동 — 별도 미션처럼 미션 패널에 띄운다.
            setQuest({
              title: "돌발 상황!",
              task: questFrame.task,
              banner: [questFrame.npc_name, questFrame.intro].filter(Boolean).join(" — "),
            });
            setTaskResult(null);
            setPhase("mission"); // 돌발 과제도 같은 과제 창을 재사용
          },
          onQuestResult: (questResult) => {
            if (cancelled) return;
            if (questResult.feedback) { coachAdvisedRef.current = true; speakCoach(questResult.feedback); }
            // 결과는 통과·미달 어느 쪽이든 보여준다. 예전엔 퀘스트가 끝날 때 quest와
            // taskResult를 함께 지워서, 결과 화면인데 보여줄 결과가 없고 본편 미션
            // 폼이 대신 떴다(activeMission이 현재 스텝으로 되돌아가므로).
            setTaskResult(questResult);
            if (questResult.quest_status === "active") {
              setPhase("mission_result"); // 1차 미달 — 재시도
              return;
            }
            // 통과 또는 2회 미달로 퀘스트 종료 → 본편 미션 통과와 같은 흐름으로 복귀한다.
            setQuest(null);
            setPhase("exploring");
            setFarewell({
              name: questResult.farewell?.name || "",
              text:
                questResult.farewell?.text ||
                (questResult.passed
                  ? "급한 불은 껐네요. 고생하셨어요."
                  : "여기까지 하죠. 원래 하던 일 마저 봅시다."),
            });
          },
          onCoachTip: (text) => {
            if (cancelled) return;
            coachAdvisedRef.current = true; // 조언이 나왔으면 위치 안내로 덮지 않는다
            speakCoach(text);
          },
          onTour: (frame) => {
            if (cancelled) return;
            // 같은 요청이 여러 번 큐에 쌓였더라도 첫 응답만 사용한다.
            if (tourStartedRef.current) return;
            tourStartedRef.current = true;
            tourRequestPendingRef.current = false;
            setTourRequestPending(false);
            setTour(frame);
            setTourIndex(0);
            setNpcMessage("");
            setUserMessage("");
            setIsStreaming(false);
            // 소개할 동료가 없으면(1인 시나리오 등) 투어를 건너뛴다.
            if (frame.stops.length === 0) {
              socketRef.current?.sendTourDone();
              setTourDone(true);
              setPhase("exploring");
            } else {
              // 팀 소개 전에 사수가 먼저 자기소개(tour_opening) → 이후 동료 소개(tour_intro).
              setPhase(frame.opening ? "tour_opening" : "tour_intro");
            }
          },
          onStateUpdated: (state) => {
            if (cancelled) return;
            const met = state.met_npcs as string[] | undefined;
            if (met) setMetNpcs(met);
            if (typeof state.memo === "string") {
              setMemo(state.memo);
              if (pendingMemoRef.current === state.memo) {
                pendingMemoRef.current = null;
                setMemoSaveStatus("saved");
              }
            }
            if (state.tour_done) setTourDone(true);
            if (state.tour_done) tourStartedRef.current = true;
            const pendingGame = pendingMinigameActivityRef.current;
            const savedMinigame =
              state.minigame && typeof state.minigame === "object"
                ? (state.minigame as Record<string, unknown>)
                : null;
            if (pendingGame && savedMinigame?.engine === pendingGame.engine) {
              if (socketRef.current?.sendActivityComplete({ game_id: pendingGame.gameId })) {
                pendingMinigameActivityRef.current = null;
                setPhase("exploring");
              } else {
                setCoachMessage("게임 결과는 저장됐지만 다음 단계 연결에 실패했어요. 잠시 후 다시 시도해주세요.");
              }
            }
            if (state.workflow_stage === "reflection" && !state.reflection) {
              setPhase("reflection");
            }
            if (state.reflection) {
              // 5단계 소감문 저장 완료 → 완주 화면 (점수는 게임에서 공개하지 않는다)
              setReflectionSending(false);
              setPhase("completed");
              if (!reportSyncStartedRef.current && consultationIdRef.current && simIdRef.current) {
                reportSyncStartedRef.current = true;
                setReportSyncStatus("pending");
                (async () => {
                  try {
                    let report = await createReport(consultationIdRef.current!, simIdRef.current!);
                    while (!cancelled && report.status === "pending") {
                      await new Promise((resolve) => window.setTimeout(resolve, 1500));
                      if (cancelled) return;
                      report = await fetchReport(report.id);
                    }
                    if (!cancelled) setReportSyncStatus(report.status === "done" ? "done" : "error");
                  } catch {
                    if (!cancelled) setReportSyncStatus("error");
                  }
                })();
              }
            }
          },
          onCoachCards: (frame) => {
            if (cancelled) return;
            // 통과한 제출물에 대한 AI 코치 사후 리뷰 (근거 기반 카드 최대 3장)
            setCoachCards(frame);
            if (frame.coach_message) { coachAdvisedRef.current = true; speakCoach(frame.coach_message); }
            if (frame.cards?.length) setIsHintOpen(true); // 리뷰가 왔음을 바로 보이게
          },
          onStepChanged: (step) => {
            if (cancelled || !step) return;
            setActiveStep(step);
            setQuest(null);
            setChatNpcId(null); // 다음 미션 담당 NPC로 대화 상대 리셋
            setNpcMessage("");
            setUserMessage("");
            setTaskResult(null); // 다음 미션으로 넘어가며 채점 결과 초기화
            setProcessLearningReady(false);
            setGreetSent(false); // 다음 담당 NPC 인사를 새로 요청
            setAdviceCards([]); // 조언 카드는 미션별 — 다음 미션으로 넘기지 않는다
            setCoachCards(null);
            speakCoach(approachGuide(step, npcsRef.current));
            setPhase((current) => (current === "minigame_debrief" ? "exploring" : current));
          },
          onActivityMessage: (message) => {
            if (cancelled || !message.text) return;
            setFarewell({ name: message.name, text: message.text });
            appendDialogue(message.name || "NPC", "npc", message.text);
          },
          onReflectionReady: () => {
            if (cancelled) return;
            setPhase("reflection");
          },
          onCompleted: () => {
            if (cancelled) return;
            // 업무를 다 마쳤다 → 4단계 실무 미니게임 → 5단계 소감문 → 완주
            setPhase("minigame");
          },
        });
        socketRef.current = socket;
        socket.connect();
      } catch (err) {
        if (cancelled) return;
        setConnStatus("error");
        setCoachMessage(
          err instanceof ApiError ? err.message : "게임을 시작하지 못했어요. 백엔드가 켜져 있는지 확인해주세요.",
        );
      }
    })();

    return () => {
      cancelled = true;
      socket?.close();
      socketRef.current = null;
    };
    // retryKey가 바뀌면(리트라이) 이전 시뮬을 정리하고 새 시뮬을 처음부터 다시 생성한다.
  }, [retryKey, appendDialogue]);

  const handleSendToNpc = useCallback(
    (message: string) => {
      const socket = socketRef.current;
      if (!socket || !chatTargetId) return;
      setTalk({ id: chatTargetId, at: Date.now() }); // 발화할 때마다 갱신 — 대화 중엔 계속 멈춤
      if (phase === "minigame_debrief" && activeActivity?.kind === "debrief") {
        const sent = socket.sendActivityComplete({ content: message });
        if (!sent) {
          setCoachMessage("게임 서버에 연결 중이에요. 잠시 후 다시 보내주세요.");
          return;
        }
        setUserMessage(message);
        setNpcMessage("");
        appendDialogue("나", "user", message);
        setPhase("exploring");
        return;
      }
      const sent = socket.sendChat(
        chatTargetId,
        message,
        phase === "process_learning" ? "process_learning" : "work",
      );
      if (!sent) {
        setIsStreaming(false);
        setCoachMessage("게임 서버에 연결 중이에요. 잠시 후 다시 보내주세요.");
        return;
      }
      setUserMessage(message);
      setNpcMessage("");
      setIsStreaming(true);
      appendDialogue("나", "user", message);
    },
    [activeActivity, appendDialogue, chatTargetId, phase],
  );

  // NPC 마커 클릭 → 그 NPC와 대화 (미션 진행과 무관한 자유 대화). 대화창 초기화.
  const handleNpcClick = useCallback(
    (npcId: string) => {
      // 투어 인사: 이 클릭(=그 동료에게 도착)으로 비로소 채팅창을 연다.
      if (phase === "tour_greet") setTourGreetOpened(true);
      setChatNpcId(npcId);
      setNpcMessage("");
      setUserMessage("");
      setIsStreaming(false);
      setTalk({ id: npcId, at: Date.now() }); // 말 건 NPC는 멈춘다(로밍 중이면)
    },
    [phase],
  );

  const handleMemoSave = useCallback((content: string) => {
    const nextMemo = content.slice(0, 4000);
    pendingMemoRef.current = nextMemo;
    setMemoSaveStatus("saving");
    if (!socketRef.current?.sendMemo(nextMemo)) {
      pendingMemoRef.current = null;
      setMemoSaveStatus("error");
      setCoachMessage("메모를 저장하려면 게임 서버 연결이 필요해요.");
    }
  }, []);

  const handleHistoryToggle = useCallback(() => {
    setIsHistoryOpen((current) => !current);
    setIsWorkflowOpen(false);
    setIsHintOpen(false);
  }, []);

  const handleMemoToggle = useCallback(() => {
    setIsMemoOpen((current) => !current);
    setIsHintOpen(false);
  }, []);

  const handleWorkflowToggle = useCallback(() => {
    setIsWorkflowOpen((current) => !current);
    setIsHistoryOpen(false);
    setIsHintOpen(false);
  }, []);

  const handleHistoryClose = useCallback(() => setIsHistoryOpen(false), []);
  const handleMemoOpen = useCallback(() => {
    setIsMemoOpen(true);
    setIsHintOpen(false);
  }, []);
  const handleMemoClose = useCallback(() => setIsMemoOpen(false), []);
  const handleWorkflowClose = useCallback(() => setIsWorkflowOpen(false), []);

  // 테스트용 — 현재 미션을 채점 없이 통과 처리하고 다음 미션으로 (WS skip_step). 마지막이면 완료 오버레이.
  const handleSkip = useCallback(() => {
    const socket = socketRef.current;
    setNpcMessage("");
    setUserMessage("");
    // 돌발 퀘스트 표시 중 스킵하면 서버는 퀘스트를 통과 처리(프레임 없음)하므로 로컬도 함께 정리.
    setQuest(null);
    setTaskResult(null);
    setPhase("exploring"); // 다음 미션은 step_changed가, 마지막이면 simulation_completed가 알려준다
    if (!socket || !socket.sendSkipStep()) {
      setCoachMessage("게임 서버에 연결 중이에요. 잠시 후 다시 시도해주세요.");
    }
  }, []);

  // 리트라이 — 현재 시뮬을 닫고 첫 미션부터 새로 시작한다.
  const handleRetry = useCallback(() => {
    // 새 시뮬을 처음부터 — 투어·브리핑·인사 진행도까지 전부 초기화(1단계부터 다시).
    sessionStorage.removeItem(RESUME_KEY); // 이어받지 말고 새로 만들게
    setPhase("loading");
    setQuest(null);
    setTaskResult(null);
    setGreetSent(false);
    setFarewell(null);
    setChatNpcId(null);
    setNpcMessage("");
    setUserMessage("");
    setIsStreaming(false);
    setDialogueHistory([]);
    dialogueSequenceRef.current = 0;
    setIsHistoryOpen(false);
    setIsMemoOpen(false);
    setIsWorkflowOpen(false);
    setReflectionSending(false);
    setMemo("");
    setMemoSaveStatus("idle");
    pendingMemoRef.current = null;
    pendingMinigameActivityRef.current = null;
    setAdviceCards([]);
    setCoachCards(null);
    setBriefedSteps([]);
    setProcessLearningReady(false);
    setTour(null);
    setTourIndex(0);
    setTourDone(false);
    setTourRequestPending(false);
    setNpcLivePositions({});
    tourRequestPendingRef.current = false;
    tourStartedRef.current = false;
    setMetNpcs([]);
    setConnStatus("creating");
    setRetryKey((key) => key + 1);
  }, []);

  // 업무 받기 — 1단계(전원과 인사)가 안 끝났으면 아직 업무를 받을 수 없다.
  // 끝났으면: 브리핑을 아직 안 들었으면 사수 설명부터(1·3단계), 들었으면 바로 과제(2단계).
  const handleOpenMission = useCallback(() => {
    // 아직 팀 소개를 못 받았으면, 업무 대신 사수의 인솔 투어부터 시작한다(1단계).
    if (needsTour) {
      // 투어가 준비 중이거나 이미 시작됐다면 추가 요청을 보내지 않는다.
      if (tourRequestPendingRef.current || tourStartedRef.current || tourActive) return;
      tourRequestPendingRef.current = true;
      setTourRequestPending(true);
      // 투어 대사는 LLM이 생성해 몇 초 걸린다 — 누르고 멈춘 것처럼 보이지 않게 안내.
      setCoachMessage("사수가 팀을 소개해 주려고 해요. 잠시만요…");
      if (!socketRef.current?.requestTour()) {
        tourRequestPendingRef.current = false;
        setTourRequestPending(false);
        setCoachMessage("게임 서버에 연결 중이에요. 잠시 후 다시 시도해주세요.");
      }
      return;
    }
    if (activeActivity?.kind === "minigame") {
      setTaskResult(null);
      setPhase("minigame");
      return;
    }
    if (activeActivity?.kind === "debrief") {
      const prompt = activeActivity.prompt || "진행하면서 느낀 점을 이야기해 주세요.";
      setChatNpcId(null);
      setNpcMessage(prompt);
      setUserMessage("");
      appendDialogue(activeNpc?.name || "NPC", "npc", prompt);
      setPhase("minigame_debrief");
      return;
    }
    setTaskResult(null);
    const stepId = activeStep?.id;
    // 이 업무의 절차를 아직 안 들었으면 브리핑부터 → 들었으면 바로 과제
    const needsBriefing =
      Boolean(stepId) && !quest && !briefedSteps.includes(stepId!) && (activeStep?.briefing?.length ?? 0) > 0;
    if (needsBriefing && usesConversationLearning) {
      const process = activeStep?.briefing
        ?.map((line, index) => `${index + 1}. ${line}`)
        .join("\n");
      const explanation = process
        ? `이번 업무는 이런 순서로 진행해요.\n${process}\n\n설명을 듣고 궁금하거나 확인하고 싶은 점을 말해보세요.`
        : "이번 업무에서 무엇부터 확인해야 할지 함께 이야기해 볼까요? 궁금한 점을 말해보세요.";
      setChatNpcId(null);
      setNpcMessage(explanation);
      setUserMessage("");
      setProcessLearningReady(false);
      appendDialogue(activeNpc?.name || "NPC", "npc", explanation);
      setPhase("process_learning");
      return;
    }
    setPhase(needsBriefing ? "briefing" : "mission");
  }, [
    activeActivity,
    activeNpc,
    activeStep,
    appendDialogue,
    briefedSteps,
    quest,
    needsTour,
    tourActive,
    usesConversationLearning,
  ]);

  // 브리핑을 다 들으면 그 스텝은 들은 것으로 기록하고 과제로 넘어간다.
  const handleBriefingDone = useCallback(() => {
    if (activeStep?.id) setBriefedSteps((current) => [...current, activeStep.id]);
    setPhase("mission");
  }, [activeStep]);

  const handleProcessLearningDone = useCallback(() => {
    if (!processLearningReady) return;
    if (activeStep?.id) {
      setBriefedSteps((current) =>
        current.includes(activeStep.id) ? current : [...current, activeStep.id],
      );
    }
    setProcessLearningReady(false);
    setPhase("mission");
  }, [activeStep, processLearningReady]);

  // 5단계 — 소감문 전송(채점 없음). 서버 저장 후 완주 화면으로.
  const handleReflectionSubmit = useCallback((content: string) => {
    setReflectionSending(true);
    if (!socketRef.current?.sendReflection(content)) {
      setReflectionSending(false);
      setCoachMessage("게임 서버에 연결 중이에요. 잠시 후 다시 보내주세요.");
    }
  }, []);

  // 미션(과제) 제출 — WS task_submit. 통과 시 step_changed로 다음 미션, 마지막이면 완료.
  const handleTaskSubmit = useCallback((content: string | string[]) => {
    const socket = socketRef.current;
    setTaskResult(null);
    setPhase("mission_grading");
    if (!socket || !socket.sendTaskSubmit(content)) {
      setPhase("mission");
      setCoachMessage("게임 서버에 연결 중이에요. 잠시 후 다시 시도해주세요.");
    }
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      setCoachMessage("브라우저에서 전체화면 전환을 허용하지 않았어요. F11 키로도 전환할 수 있습니다.");
    }
  };

  const screenStyle: ScenarioScreenStyle = {
    "--scenario-map-image": `url("${mapImage}")`,
  };

  const stageStyle: ScenarioStageStyle = {
    "--scenario-stage-scale": stageScale,
    "--scenario-ui-text-scale": Math.min(1.5, Math.max(1, 1 / stageScale)),
  };

  if (connStatus === "creating") {
    return (
      <SpaceLoadingScreen
        message="가상 회사로 이동하고 있어요."
        detail="시나리오와 게임 환경을 준비하는 중이에요."
      />
    );
  }

  return (
    <main className={styles.gameScreen} style={screenStyle}>
      <div className={styles.mapBackdrop} aria-hidden="true" />
      <div
        className={styles.designStage}
        style={stageStyle}
        data-debug="false"
        data-scenario-theme={scenarioTheme}
      >
        <GameMapLayer imageUrl={mapImage} />
        <MovementArea
          position={playerPosition}
          // 컷신·모달 중에는 조작을 뺏지 않는다 — 이동은 exploring에서만.
          // isStreaming(동료가 답변 중)도 잠가야 한다 — exploring은 대화창이 떠 있어도 유지되는
          // 페이즈라, 안 잠그면 답변 스트리밍 중에도 캐릭터가 맵을 돌아다닐 수 있었다.
          onPositionChange={
            canMove(phase) && !isMemoOpen && !isWorkflowOpen && !isStreaming ? setPlayerPosition : NOOP
          }
          onCoachMessage={speakCoach}
          geometry={gameMap?.geometry ?? null}
          mapImage={mapImage}
          npcs={npcs}
          activeNpcId={activeNpcId}
          // 스페이스바로 말을 걸 상대 — 투어 인사 중엔 지금 인사할 동료, 그 외에는 현재 스텝
          // 담당 NPC. 근처에 다른 사람이 있어도 '지금 대화해야 하는 상대'가 먼저 열린다.
          talkTargetNpcId={phase === "tour_greet" ? tourStop?.npc ?? null : activeNpcId}
          // 컷신 중엔 마커 클릭을 막지만, 인사(tour_greet)만은 예외 — 신입이 그 동료를 눌러
          // 다가가서 대화를 여는 단계라 클릭이 필요하다.
          onNpcClick={
            MODAL_PHASES.has(phase) ||
            (tourActive && phase !== "tour_greet") ||
            isMemoOpen ||
            isWorkflowOpen
              ? undefined
              : handleNpcClick
          }
          onNpcPositionsChange={setNpcLivePositions}
          guideNpcId={tour?.guide?.npc ?? null}
          guidePosition={guidePosition}
          // 카메라는 기본적으로 신입에게 고정한다. 사수가 소개하는 동안(tour_intro)만 '소개받는
          // 그 동료'를 잠깐 비추고(걷는 사수를 쫓아다니지 않는다), 소개가 끝나면 다시 신입에게
          // 돌아온다 — 이후 인사·응답·마무리는 신입이 직접 걸어가서 진행하기 때문.
          // 마커 좌표를 화면 중앙에 두려면 cameraFocus가 기대하는 '플레이어 박스 좌상단'으로 바꿔 넘긴다.
          cameraFocus={
            phase === "tour_intro" && tourStopMarker
              ? {
                  x: tourStopMarker.x - PLAYER_SIZE.width / 2,
                  y: tourStopMarker.y - PLAYER_SIZE.height / 2,
                }
              : null
          }
          tourActive={tourActive}
          talkingNpcId={talk.id}
          roamingPaused={tourActive}
        />
        <button
          className={styles.bgmToggleButton}
          type="button"
          data-enabled={isBgmEnabled}
          aria-label={isBgmEnabled ? "배경 음악 끄기" : "배경 음악 켜기"}
          aria-pressed={isBgmEnabled}
          title={isBgmEnabled ? "배경 음악 끄기" : "배경 음악 켜기"}
          onClick={handleBgmToggle}
        >
          {isBgmEnabled ? (
            <SpeakerHigh weight="fill" aria-hidden="true" />
          ) : (
            <SpeakerSlash weight="bold" aria-hidden="true" />
          )}
        </button>
        {showStandingIllustration && standingIllustrationSrc ? (
          <div className={styles.npcStandingStage} aria-hidden="true">
            <img
              src={standingIllustrationSrc}
              alt=""
              decoding="async"
              draggable={false}
            />
            <div className={styles.npcStandingNameplate}>
              <strong>{visibleChatNpc?.name ?? "NPC"}</strong>
              <small>{visibleChatNpc?.role || "직급 정보 없음"}</small>
            </div>
          </div>
        ) : null}
        <DashboardHeader
          progress={progress}
          theme={scenarioTheme}
          isHintOpen={isHintOpen}
          isFullscreen={isFullscreen}
          onThemeChange={setScenarioTheme}
          onHintToggle={() => setIsHintOpen((current) => !current)}
          onFullscreenToggle={toggleFullscreen}
          onLogout={() => setIsLogoutConfirmOpen(true)}
          onSettingsOpen={() => setIsAudioSettingsOpen(true)}
          onHome={() => window.location.assign("/")}
          onBack={() => {
            if (window.history.length > 1) window.history.back();
            else window.location.assign("/");
          }}
          onRestart={handleRetry}
          onMission={handleOpenMission}
          missionDisabled={connStatus !== "open" || tourRequestPending || tourActive}
          missionPending={tourRequestPending}
        />
        <HintPanel isOpen={isHintOpen} hints={hints} onClose={() => setIsHintOpen(false)} />
        <DialogueHistoryPanel
          isOpen={isHistoryOpen}
          isCompanion={isMemoOpen}
          entries={dialogueHistory}
          onClose={handleHistoryClose}
        />
        <MemoPanel
          isOpen={isMemoOpen}
          memo={memo}
          saveStatus={memoSaveStatus}
          canSave={connStatus === "open"}
          isEscapeBlocked={isHistoryOpen || isWorkflowOpen}
          onSave={handleMemoSave}
          onClose={handleMemoClose}
        />
        <WorkflowModal
          isOpen={isWorkflowOpen}
          missionTitle={activeStep?.title ?? ""}
          missionDescription={activeStep?.mission ?? ""}
          steps={activeStep?.briefing ?? []}
          isUnlocked={Boolean(activeStep && briefedSteps.includes(activeStep.id))}
          isCompanion={isMemoOpen}
          onMemoOpen={handleMemoOpen}
          onClose={handleWorkflowClose}
        />

        {/* 1단계 컷신 — 사수가 팀원을 소개하는 동안 자막. 이동은 자동. */}
        {tourRequestPending ? (
          <TourBanner
            speakerName={activeNpc?.name ?? "사수"}
            line="팀 소개 내용을 준비하고 있어요. 잠시만 기다려주세요."
            stepLabel="준비 중"
            mode="loading"
            onNext={NOOP}
          />
        ) : tourActive && tour ? (
          <TourBanner
            speakerName={
              phase === "tour_opening" || phase === "tour_closing" || phase === "tour_intro"
                ? tour.guide?.name ?? "사수"
                : tourStop?.name ?? ""
            }
            line={
              phase === "tour_opening"
                ? tour.opening
                : phase === "tour_closing"
                  ? tour.closing
                  : phase === "tour_intro"
                    ? tourStop?.line ?? ""
                    : phase === "tour_greet"
                      ? tourGreetOpened
                        ? `${tourStop?.name ?? "동료"} 님에게 직접 인사를 건네보세요. (아래 채팅창)`
                        : `${tourStop?.name ?? "동료"} 님에게 걸어가서(WASD) 클릭 또는 스페이스바로 대화를 여세요.`
                      : npcMessage || "…"
            }
            stepLabel={
              phase === "tour_opening"
                ? "자기소개"
                : phase === "tour_closing"
                  ? "마무리"
                  : `${tourIndex + 1}/${tour.stops.length}`
            }
            mode={
              phase === "tour_opening" || phase === "tour_intro"
                ? "intro"
                : phase === "tour_greet"
                  ? "greet"
                  : phase === "tour_reply"
                    ? "reply"
                    : "closing"
            }
            onNext={handleTourNext}
          />
        ) : null}

        {showEncounter ? (
          <div className={styles.encounterBanner}>
            <span className={styles.encounterAvatar} aria-hidden="true">
              <UserCircle weight="duotone" />
            </span>
            <div className={styles.encounterBody}>
              <strong>
                {activeNpc?.name ?? "NPC"}
                {activeNpc?.role ? ` · ${activeNpc.role}` : ""}
              </strong>
              {/* 첫 출근이면 업무 대신 팀 소개부터 — 사수가 데리고 다니며 인사시켜 준다 */}
              <p>
                {needsTour
                  ? "첫 출근 — 팀 소개받기"
                  : activeActivity?.label || "오늘의 업무"}
              </p>
            </div>
            <button
              className={styles.encounterButton}
              type="button"
              onClick={handleOpenMission}
              disabled={tourRequestPending}
              aria-busy={tourRequestPending}
            >
              {tourRequestPending
                ? "준비 중…"
                : needsTour
                  ? "인사하러 가기 →"
                  : activeActivity?.kind === "debrief"
                    ? "이야기하기 →"
                    : "업무 받기 →"}
            </button>
          </div>
        ) : null}

        {phase === "process_learning" && processLearningReady && !isStreaming ? (
          <div className={styles.encounterBanner}>
            <span className={styles.encounterAvatar} aria-hidden="true">
              <UserCircle weight="duotone" />
            </span>
            <div className={styles.encounterBody}>
              <strong>{activeNpc?.name ?? "담당 NPC"}에게 업무 과정을 배웠어요</strong>
              <p>대화를 더 이어가도 되고, 준비됐으면 문제로 확인해 보세요.</p>
            </div>
            <button
              className={styles.encounterButton}
              type="button"
              onClick={handleProcessLearningDone}
            >
              문제 풀기 →
            </button>
          </div>
        ) : null}

        {farewell ? (
          <div className={`${styles.encounterBanner} ${styles.farewellBanner}`}>
            <span className={styles.encounterAvatar} aria-hidden="true">
              <UserCircle weight="duotone" />
            </span>
            <div className={styles.encounterBody}>
              <strong>{farewell.name ? `${farewell.name} · 고생했어요!` : "고생했어요!"}</strong>
              <p>{farewell.text}</p>
            </div>
          </div>
        ) : null}
        <div className={styles.bottomHud}>
          <ScenarioControlPanel
            npcName={visibleChatNpc?.name ?? "NPC"}
            npcPortraitSrc={standingIllustrationSrc}
            npcPortraitSrcBySpeaker={npcPortraitSrcBySpeaker}
            npcMessage={visibleNpcMessage}
            userMessage={userMessage}
            dialogueEntries={dialogueHistory}
            isStreaming={isStreaming}
            isHistoryOpen={isHistoryOpen}
            isMemoOpen={isMemoOpen}
            isWorkflowOpen={isWorkflowOpen}
            // 자유 대화, 투어 인사, 대화형 업무 학습·회고 단계에서 입력을 받는다.
            // 투어 인사는 그 동료 옆까지 걸어가야 보낼 수 있다 — 멀리서 인사가 성립하지 않게.
            disabled={
              connStatus !== "open" ||
              !canChat(phase) ||
              (phase === "tour_greet" && !(isNearTourStop && tourGreetOpened))
            }
            // 투어 인사(tour_greet)에서는 자동 포커스하지 않는다 — 동료 근처에 가는 순간 입력창이
            // 포커스를 가져가면 방향키가 채팅으로 먹혀 캐릭터가 멈춘다. 마우스로 그 동료를 눌러
            // 대화를 열었을 때만 포커스한다.
            focusInput={
              (phase === "tour_greet" && tourGreetOpened) ||
              phase === "process_learning" ||
              phase === "minigame_debrief"
            }
            placeholder={
              phase === "minigame_debrief"
                ? "진행하면서 느낀 점과 이유를 입력하세요"
                : phase === "process_learning"
                  ? "업무 과정에서 궁금하거나 확인할 점을 입력하세요"
                : "NPC에게 보낼 답변을 입력하세요"
            }
            // 막힌 이유를 구분해서 보여준다 — 서버 문제가 아닌데 '연결 중'이라고 하면 장애로 오해한다.
            disabledHint={
              connStatus !== "open"
                ? "게임 서버에 연결 중이에요…"
                  : TOUR_PHASES.has(phase)
                    ? "사수가 팀을 소개하는 중이에요. 인사할 차례가 되면 여기에 입력할 수 있어요."
                    : phase === "process_learning"
                      ? "담당 NPC와 업무 과정을 이야기하는 중이에요."
                    : "지금은 대화할 수 없어요."
            }
            onSend={handleSendToNpc}
            onActivity={bumpTalk}
            onHistoryToggle={handleHistoryToggle}
            onMemoOpen={handleMemoToggle}
            onWorkflowOpen={handleWorkflowToggle}
          />
          <AiCoachPanel
            message={coachMessage}
            coachName={COACH_PROFILES[selectedCoachId].name}
          >
            {/* museTalkRequest가 없을 때도 항상 마운트한다 — AiAvatarStage는 idle 영상을
                내부적으로 상시 재생하고(536-546행), 조언이 있을 때만 발화 오버레이를
                올린다(speaking = status==="speaking" && museTalkRequest 존재).
                조건부로 마운트하면(옛 코드) 안 말할 때 컴포넌트 자체가 없어 idle도 안 보였다. */}
            <AiAvatarStage
              key={selectedCoachId}
              avatarId={selectedCoachId}
              status={avatarStatus}
              volume={coachVolume}
              museTalkRequest={museTalkRequest}
              onSpeakingEnd={handleAvatarSpeakingEnd}
              onSpeakingError={handleAvatarSpeakingError}
            />
          </AiCoachPanel>
        </div>
        <span className={styles.keyboardGuide} aria-hidden="true">
          <kbd>WASD</kbd>
          <span>이동</span>
          <kbd>Space</kbd>
          <span>대화</span>
        </span>
      </div>

      {/* ── 페이즈별 화면 — 조건 조합 대신 페이즈 하나로 결정된다 ── */}

      {/* 2·3단계 앞 — 사수가 이번 업무 절차를 알려준다 */}
      {phase === "briefing" && activeStep ? (
        <BriefingPanel
          npcName={activeNpc?.name ?? "사수"}
          npcRole={activeNpc?.role}
          npcPortraitSrc={
            activeNpc ? NPC_STANDING_ILLUSTRATIONS[activeNpc.npc_id] : undefined
          }
          missionTitle={activeStep.title}
          mission={activeStep.mission}
          steps={activeStep.briefing ?? []}
          onClose={handleBriefingDone}
        />
      ) : null}

      {/* 2단계 — 과제 풀이·채점·결과(재도전 포함) */}
      {MISSION_PHASES.has(phase) && activeMission ? (
        <MissionPanel
          key={quest ? "quest" : activeStep?.id}
          mission={activeMission}
          submitting={phase === "mission_grading"}
          result={taskResult}
          onSubmit={handleTaskSubmit}
          onSkip={handleSkip}
          onClose={() => setPhase("exploring")}
          onClearResult={() => setTaskResult(null)}
        />
      ) : null}

      {/* 4단계 — 실무 미니게임 (지금은 빈 창). 실제 엔진이 붙으면 onClear에서
          그 게임의 engine 키·정확도·실수를 보내면 역량·리포트에 반영된다.
          스텁은 engine:"stub"로 보내 파이프라인만 태우고 점수엔 반영되지 않는다. */}
      {phase === "minigame" ? (
        <MiniGamePanel
          missionTitle={activeActivity?.label || "신입의 주 업무"}
          placeholderDescription={
            activeActivity?.kind === "minigame" ? activeStep?.mission : undefined
          }
          game={activeActivity?.kind === "minigame" ? activeActivityGame : minigame}
          games={
            activeActivity?.kind === "minigame"
              ? activeActivityGame
                ? [activeActivityGame]
                : []
              : minigames
          }
          onClear={(result) => {
            if (activeActivity?.kind === "minigame" && activeActivity.game_id) {
              if (result) {
                const resultWithGameId = {
                  ...result,
                  metadata: {
                    ...result.metadata,
                    activityGameId: activeActivity.game_id,
                    gameId: result.metadata?.gameId ?? activeActivity.game_id,
                  },
                };
                pendingMinigameActivityRef.current = {
                  gameId: activeActivity.game_id,
                  engine: result.engine,
                };
                if (!socketRef.current?.sendMinigameResult(resultWithGameId)) {
                  pendingMinigameActivityRef.current = null;
                  setCoachMessage("게임 결과를 저장하지 못했어요. 연결을 확인한 뒤 다시 시도해주세요.");
                }
                return;
              }
              // 게임 정의가 아직 없는 활동만 준비 중 화면의 완료 버튼으로 넘긴다.
              if (!socketRef.current?.sendActivityComplete({ game_id: activeActivity.game_id })) {
                setCoachMessage("게임 서버에 연결 중이에요. 잠시 후 다시 시도해주세요.");
                return;
              }
              setPhase("exploring");
              return;
            }
            // 실제 엔진이면 성적을 그대로, 게임 데이터가 없는 시나리오는 스텁으로.
            // 스텁의 engine:"stub"은 백엔드 aggregate가 걸러내 점수를 오염시키지 않는다.
            socketRef.current?.sendMinigameResult(result ?? { engine: "stub", accuracy: 0 });
            setPhase("reflection");
          }}
        />
      ) : null}

      {/* 5단계 — 체험 소감문 (채점하지 않음. 최종 리포트의 재료) */}
      <AnimatePresence>
        {phase === "reflection" ? (
          <ReflectionPanel
            key="reflection"
            scenarioTitle={scenarioTitle}
            theme={scenarioTheme}
            submitting={reflectionSending}
            onSubmit={handleReflectionSubmit}
          />
        ) : null}
      </AnimatePresence>

      {phase === "completed" ? (
        <div
          className={styles.completionOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="시나리오 완수"
        >
          <div className={styles.completionCard}>
            <span className={styles.completionEmoji} aria-hidden="true">
              🎉
            </span>
            <h2>시나리오 완수!</h2>
            <p>{scenarioTitle || "시나리오"}를 완료했어요.</p>
            {/* 점수·역량·화법은 게임에서 보여주지 않는다(팀 결정) — 상담 + 체험을 합쳐
                최종 진로 리포트에서만 공개한다. 점수 쫓기가 아니라 체험이 되도록. */}
            <p className={styles.completionNote}>
              {reportSyncStatus === "done"
                ? "오늘 체험한 내용이 상담 결과와 함께 최종 진로 리포트에 반영됐어요."
                : reportSyncStatus === "error"
                  ? "리포트 반영에 실패했어요. 마이페이지에서 리포트를 다시 만들어주세요."
                  : reportSyncStatus === "pending"
                    ? "오늘 체험한 내용을 상담 결과와 함께 최종 진로 리포트에 반영하는 중..."
                    : "오늘 체험한 내용은 상담 결과와 함께 최종 진로 리포트에 반영됩니다."}
            </p>
            <div className={styles.completionActions}>
              <button
                className={styles.completionPrimary}
                type="button"
                onClick={() => window.location.assign("/")}
              >
                홈으로
              </button>
              <button className={styles.completionSecondary} type="button" onClick={handleRetry}>
                다시 하기
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <ScenarioAudioSettingsDialog
        open={isAudioSettingsOpen}
        theme={scenarioTheme}
        bgmVolume={bgmVolume}
        coachVolume={coachVolume}
        coachId={selectedCoachId}
        onCancel={handleAudioSettingsCancel}
        onPreview={handleAudioSettingsPreview}
        onSave={handleAudioSettingsSave}
      />
      <LogoutConfirmDialog
        open={isLogoutConfirmOpen}
        onCancel={() => setIsLogoutConfirmOpen(false)}
        onConfirm={() => {
          logout();
          window.location.assign("/");
        }}
      />
    </main>
  );
}
