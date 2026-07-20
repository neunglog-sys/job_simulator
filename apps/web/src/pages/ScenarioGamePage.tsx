import { UserCircle } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { LogoutConfirmDialog } from "../components/LogoutConfirmDialog";
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
import { ScenarioControlPanel } from "../components/scenario/ScenarioControlPanel";
import { TourBanner } from "../components/scenario/TourBanner";
import { WorkflowModal } from "../components/scenario/WorkflowModal";
import type { HintCardData, Position } from "../components/scenario/types";
import { API_BASE_URL } from "../config/endpoints";
import type { MissionView } from "../components/scenario/MissionPanel";
import {
  ApiError,
  createSimulation,
  fetchSimulation,
  type GameNpc,
  type GameStep,
  type GameTask,
  type Simulation,
} from "../lib/api";
import { logout } from "../lib/auth";
import {
  SimulationSocket,
  type AdviceCard,
  type CoachCardsFrame,
  type TaskResultFrame,
  type TourFrame,
} from "../lib/simulationSocket";
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

// 테스트 대상 시나리오 — ?slug= 쿼리로 덮어쓸 수 있다. 기본은 ms-06(농축산 현장 작업 / 작업순서_농축산현장작업 맵).
const DEFAULT_SCENARIO_SLUG =
  new URLSearchParams(window.location.search).get("slug") ||
  import.meta.env.VITE_SCENARIO_SLUG?.trim() ||
  "ms-06";

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
      if (sim.status === "active") return sim; // 진행 중이면 이어받는다
    } catch {
      /* 없거나 남의 것 → 새로 만든다 */
    }
    sessionStorage.removeItem(RESUME_KEY);
  }
  const sim = await createSimulation(slug);
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
  if (!step?.task) return DEFAULT_COACH_MESSAGE;
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

export function ScenarioGamePage() {
  const [isHintOpen, setIsHintOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isMemoOpen, setIsMemoOpen] = useState(false);
  const [isWorkflowOpen, setIsWorkflowOpen] = useState(false);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [scenarioTheme, setScenarioTheme] = useState<ScenarioTheme>(() => {
    const savedTheme = localStorage.getItem("scenario-theme");
    return savedTheme === "deep-space" || savedTheme === "aurora" ? savedTheme : "nebula";
  });
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [coachMessage, setCoachMessage] = useState(DEFAULT_COACH_MESSAGE);
  const [playerPosition, setPlayerPosition] = useState<Position>({ x: 420, y: 290 });
  const [stageScale, setStageScale] = useState(getStageScale);

  // 시뮬레이션(게임) 연결 상태
  const [connStatus, setConnStatus] = useState<ConnectionStatus>("creating");
  const [activeStep, setActiveStep] = useState<GameStep | null>(null);
  const [npcs, setNpcs] = useState<GameNpc[]>([]);
  const [gameMap, setGameMap] = useState<Simulation["map"]>(null);
  const [minigame, setMinigame] = useState<Simulation["minigame"]>(null);
  const [scenarioTitle, setScenarioTitle] = useState("");
  const [stepIds, setStepIds] = useState<string[]>([]); // 본편 미션 순서 (진행률 계산용)
  // 진행 페이즈 — "지금 무엇을 하는 중인지"의 단일 출처. 전이는 아래 handle*/소켓 핸들러에서만.
  const [phase, setPhase] = useState<GamePhase>("loading");
  const [retryKey, setRetryKey] = useState(0);
  const [taskResult, setTaskResult] = useState<TaskResultFrame | null>(null);
  const [quest, setQuest] = useState<{ title: string; task: GameTask; banner?: string } | null>(null);
  const [greetSent, setGreetSent] = useState(false);
  const [farewell, setFarewell] = useState<{ name: string; text: string } | null>(null); // 통과 격려 배너
  const npcsRef = useRef<GameNpc[]>([]); // 코치 안내 문구용 로스터(핸들러 클로저의 stale 방지)
  const [npcMessage, setNpcMessage] = useState("");
  const [userMessage, setUserMessage] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [dialogueHistory, setDialogueHistory] = useState<DialogueHistoryEntry[]>([]);
  const dialogueSequenceRef = useRef(0);
  const [chatNpcId, setChatNpcId] = useState<string | null>(null); // 대화 상대(마커 클릭). null=미션 담당 NPC
  const [mapImage, setMapImage] = useState<string>(DEFAULT_SCENARIO_MAP_IMAGE);
  // 미달할수록 깊어지는 조언 카드 — 스텝(또는 퀘스트)당 누적, 힌트 패널에 쌓인다.
  const [adviceCards, setAdviceCards] = useState<AdviceCard[]>([]);
  // 미션 통과 후 AI 코치 사후 리뷰 (근거 기반 카드)
  const [coachCards, setCoachCards] = useState<CoachCardsFrame | null>(null);
  const [briefedSteps, setBriefedSteps] = useState<string[]>([]); // 브리핑을 본 스텝 id (스텝당 1회)
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
  const socketRef = useRef<SimulationSocket | null>(null);

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
  // 대화 상대 = 마커로 선택한 NPC(chatNpcId), 없으면 미션 담당 NPC.
  const chatTargetId = chatNpcId ?? activeNpcId;
  const chatNpc = npcs.find((npc) => npc.npc_id === chatTargetId) ?? activeNpc;
  const hints = useMemo(
    () => buildHints(activeStep, adviceCards, coachCards, briefedSteps.includes(activeStep?.id ?? "")),
    [activeStep, adviceCards, coachCards, briefedSteps],
  );
  // 진행률 = 완료한 본편 미션 수 / 전체 (완주 시 100%). 돌발 퀘스트는 stepIds에 없어 제외됨.
  const progress = phase === "completed"
    ? 100
    : stepIds.length
      ? Math.round((Math.max(0, stepIds.indexOf(activeStep?.id ?? "")) / stepIds.length) * 100)
      : 0;
  // 미션 패널에 띄울 대상 — 돌발 퀘스트가 있으면 우선, 없으면 현재 스텝 미션.
  const activeMission: MissionView | null = quest
    ? { title: quest.title, task: quest.task, banner: quest.banner }
    : activeStep?.task
      ? { title: activeStep.title, task: activeStep.task }
      : null;

  // 현재 미션 담당 NPC의 맵 좌표(로컬) — 근접 판정·마커 강조에 사용.
  const activeNpcMarker = useMemo(() => {
    const geo = gameMap?.geometry;
    const origin = geo?.walkable?.[0];
    const spot = geo?.spawns?.find((spawn) => spawn.id === activeNpc?.spawn);
    if (!geo || !origin || !spot) return null;
    return { x: spot.x - origin.x, y: spot.y - origin.y };
  }, [gameMap, activeNpc]);

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
    Boolean(activeStep?.task);

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
  // 투어 자막과 하단 대화창이 서로 다른 상태를 보지 않도록 현재 발화자와 대사를 한곳에서 계산한다.
  // 직접 인사를 입력하는 동안에는 직전에 말한 사수의 소개를 유지하고, 동료 답변 토큰이 도착하면
  // 그때부터 발화자를 해당 동료로 전환한다.
  const tourReplyStarted =
    phase === "tour_reply" || (phase === "tour_greet" && npcMessage.trim().length > 0);
  const tourDialogueSpeaker =
    phase === "tour_closing" || !tourReplyStarted
      ? tour?.guide ?? tourStop
      : tourStop ?? tour?.guide;
  const tourDialogueMessage =
    phase === "tour_closing"
      ? tour?.closing ?? ""
      : tourReplyStarted
        ? npcMessage
        : tourStop?.line ?? "";
  const visibleChatNpc = tourActive ? tourDialogueSpeaker ?? chatNpc : chatNpc;
  const visibleNpcMessage = tourActive ? tourDialogueMessage : npcMessage;

  // 위 자막에서 지나간 사수의 소개와 마무리도 이전 대화 목록에 남긴다.
  // 동료 답변은 onNpcReply에서 완성된 문장으로 별도 기록한다.
  useEffect(() => {
    if (!tour?.guide) return;
    if (phase === "tour_intro" && tourStop?.line) {
      appendDialogue(tour.guide.name || "사수", "npc", tourStop.line);
    } else if (phase === "tour_closing" && tour.closing) {
      appendDialogue(tour.guide.name || "사수", "npc", tour.closing);
    }
  }, [appendDialogue, phase, tour, tourStop]);

  // 투어 중 사수·플레이어가 서 있을 자리 — 소개 대상 옆(마무리 때는 사수 자리로 돌아온다).
  const tourAnchor = useMemo(() => {
    if (!tour) return null;
    const target = tourStop?.npc ?? tour.guide?.npc;
    return target ? spawnPos(target) : null;
  }, [tour, tourStop, spawnPos]);
  const guidePosition = useMemo(
    () => (tourActive && tourAnchor ? { x: tourAnchor.x - 70, y: tourAnchor.y } : null),
    [tourActive, tourAnchor],
  );

  // 사수가 이동하면 신입은 자동으로 따라붙는다(컷신 — 플레이어 조작 없음).
  useEffect(() => {
    if (!tourActive || !tourAnchor) return;
    setPlayerPosition({
      x: tourAnchor.x - 140 - PLAYER_SIZE.width / 2,
      y: tourAnchor.y - PLAYER_SIZE.height,
    });
  }, [tourActive, tourAnchor]);

  // 투어 전이: 사수 소개(tour_intro) → 신입이 직접 인사(tour_greet) → 동료 응답(tour_reply)
  //          → 다음 동료 / 마지막이면 사수 마무리(tour_closing) → exploring
  const handleTourNext = useCallback(() => {
    if (!tour) return;
    if (phase === "tour_intro") {
      // 소개를 들었으면 이제 신입이 직접 인사한다 — 여기서 화법(호감도)이 평가된다.
      setChatNpcId(tour.stops[tourIndex]?.npc ?? null);
      setNpcMessage("");
      setUserMessage("");
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
  // (대화 중 코치 TIP·리뷰가 떠 있을 때 덮어쓰지 않도록 스트리밍 중에는 건드리지 않는다)
  useEffect(() => {
    if (phase !== "exploring" || isStreaming || npcs.length === 0) return;
    setCoachMessage(
      needsTour ? introGuide(activeStep, npcsRef.current) : approachGuide(activeStep, npcsRef.current),
    );
  }, [phase, needsTour, npcs.length, isStreaming, activeStep]);

  // 담당 NPC에게 처음 다가가면 실시간 인사를 1회 요청 (스텝당 1회, 응답 오면 채팅창에 표시).
  // 담당 NPC 인사는 업무를 건네는 대사다 — 팀 소개(투어)를 받기 전에 다가갔다고 해서
  // "왔어? 이것부터 점검해 줘"가 튀어나오면 안 된다. 투어를 마친 뒤부터 요청한다.
  useEffect(() => {
    if (showEncounter && !needsTour && !greetSent && socketRef.current?.sendGreet()) {
      setGreetSent(true);
    }
  }, [showEncounter, needsTour, greetSent]);

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
      setActiveStep(sim.step);
      setNpcs(sim.npcs);
      // 1단계 진행도 복원 — 새로고침해도 인사한 동료·투어 완료는 기억된다(서버 state).
      setMetNpcs((sim.state?.met_npcs as string[] | undefined) ?? []);
      setMemo(typeof sim.state?.memo === "string" ? sim.state.memo : "");
      setMemoSaveStatus("idle");
      pendingMemoRef.current = null;
      // 접속하면 언제나 자유 이동부터 — 투어는 플레이어가 사수에게 다가가 시작한다.
      setTourDone(Boolean(sim.state?.tour_done));
      tourRequestPendingRef.current = false;
      setTourRequestPending(false);
      tourStartedRef.current = Boolean(sim.state?.tour_done);
      setPhase("exploring");
      npcsRef.current = sim.npcs;
      setGameMap(sim.map);
      setMinigame(sim.minigame ?? null);
      setScenarioTitle(sim.scenario_title);
      setStepIds(sim.step_ids ?? []);
      setCoachMessage(approachGuide(sim.step, sim.npcs));
      // 플레이어 시작 위치 = geometry의 player spawn(발밑 기준). geometry는 스테이지 좌표라 walkable 원점만큼 뺀다.
      const origin = sim.map?.geometry?.walkable?.[0];
      const playerSpawn = sim.map?.geometry?.spawns?.find((spot) => spot.id === "player");
      if (origin && playerSpawn) {
        setPlayerPosition({
          x: playerSpawn.x - origin.x - PLAYER_SIZE.width / 2,
          y: playerSpawn.y - origin.y - PLAYER_SIZE.height,
        });
      }
      // 배경: 백엔드 맵 이미지가 실제로 로드되면 그것으로, 실패(미업로드 등)하면 기본 배경 유지
      const bg = sim.map?.background;
      if (bg) {
        const absolute = `${API_BASE_URL}${bg}`;
        const probe = new Image();
        probe.onload = () => {
          if (!cancelled) setMapImage(absolute);
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
            setPhase("mission_result");
            if (questResult.feedback) setCoachMessage(questResult.feedback);
            if (questResult.quest_status === "active") {
              setTaskResult(questResult); // 1차 미달 — 재시도
            } else {
              // 통과 또는 2회 미달로 퀘스트 종료 → 본편 미션으로 복귀
              setQuest(null);
              setTaskResult(null);
            }
          },
          onCoachTip: (text) => !cancelled && setCoachMessage(text),
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
              setPhase("tour_intro");
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
            if (state.reflection) {
              // 5단계 소감문 저장 완료 → 완주 화면 (점수는 게임에서 공개하지 않는다)
              setReflectionSending(false);
              setPhase("completed");
            }
          },
          onCoachCards: (frame) => {
            if (cancelled) return;
            // 통과한 제출물에 대한 AI 코치 사후 리뷰 (근거 기반 카드 최대 3장)
            setCoachCards(frame);
            if (frame.coach_message) setCoachMessage(frame.coach_message);
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
            setGreetSent(false); // 다음 담당 NPC 인사를 새로 요청
            setAdviceCards([]); // 조언 카드는 미션별 — 다음 미션으로 넘기지 않는다
            setCoachCards(null);
            setCoachMessage(approachGuide(step, npcsRef.current));
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
      const sent = socket.sendChat(chatTargetId, message);
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
    [chatTargetId, appendDialogue],
  );

  // NPC 마커 클릭 → 그 NPC와 대화 (미션 진행과 무관한 자유 대화). 대화창 초기화.
  const handleNpcClick = useCallback((npcId: string) => {
    setChatNpcId(npcId);
    setNpcMessage("");
    setUserMessage("");
    setIsStreaming(false);
  }, []);

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
    setAdviceCards([]);
    setCoachCards(null);
    setBriefedSteps([]);
    setTour(null);
    setTourIndex(0);
    setTourDone(false);
    setTourRequestPending(false);
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
    setTaskResult(null);
    const stepId = activeStep?.id;
    // 이 업무의 절차를 아직 안 들었으면 브리핑부터 → 들었으면 바로 과제
    const needsBriefing =
      Boolean(stepId) && !quest && !briefedSteps.includes(stepId!) && (activeStep?.briefing?.length ?? 0) > 0;
    setPhase(needsBriefing ? "briefing" : "mission");
  }, [activeStep, briefedSteps, quest, needsTour, tourActive]);

  // 브리핑을 다 들으면 그 스텝은 들은 것으로 기록하고 과제로 넘어간다.
  const handleBriefingDone = useCallback(() => {
    if (activeStep?.id) setBriefedSteps((current) => [...current, activeStep.id]);
    setPhase("mission");
  }, [activeStep]);

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
          onPositionChange={canMove(phase) && !isMemoOpen && !isWorkflowOpen ? setPlayerPosition : NOOP}
          onCoachMessage={setCoachMessage}
          geometry={gameMap?.geometry ?? null}
          mapImage={mapImage}
          npcs={npcs}
          activeNpcId={activeNpcId}
          onNpcClick={MODAL_PHASES.has(phase) || tourActive || isMemoOpen || isWorkflowOpen ? undefined : handleNpcClick}
          guideNpcId={tour?.guide?.npc ?? null}
          guidePosition={guidePosition}
        />
        <DashboardHeader
          progress={progress}
          theme={scenarioTheme}
          isHintOpen={isHintOpen}
          isFullscreen={isFullscreen}
          onThemeChange={setScenarioTheme}
          onHintToggle={() => setIsHintOpen((current) => !current)}
          onFullscreenToggle={toggleFullscreen}
          onLogout={() => setIsLogoutConfirmOpen(true)}
          onSettingsOpen={() => setCoachMessage("설정 메뉴에서 사운드와 이동 방식을 조정할 수 있게 될 예정이에요.")}
          onHome={() => window.location.assign("/")}
          onBack={() => {
            if (window.history.length > 1) window.history.back();
            else window.location.assign("/");
          }}
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
              phase === "tour_closing" || phase === "tour_intro"
                ? tour.guide?.name ?? "사수"
                : tourStop?.name ?? ""
            }
            line={
              phase === "tour_closing"
                ? tour.closing
                : phase === "tour_intro"
                  ? tourStop?.line ?? ""
                  : phase === "tour_greet"
                    ? `${tourStop?.name ?? "동료"} 님에게 직접 인사를 건네보세요. (아래 채팅창)`
                    : npcMessage || "…"
            }
            stepLabel={phase === "tour_closing" ? "마무리" : `${tourIndex + 1}/${tour.stops.length}`}
            mode={
              phase === "tour_intro"
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
              <p>{needsTour ? "첫 출근 — 팀 소개받기" : "오늘의 업무"}</p>
            </div>
            <button
              className={styles.encounterButton}
              type="button"
              onClick={handleOpenMission}
              disabled={tourRequestPending}
              aria-busy={tourRequestPending}
            >
              {tourRequestPending ? "준비 중…" : needsTour ? "인사하러 가기 →" : "업무 받기 →"}
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
            npcRole={visibleChatNpc?.role}
            npcMessage={visibleNpcMessage}
            userMessage={userMessage}
            isStreaming={isStreaming}
            isHistoryOpen={isHistoryOpen}
            isMemoOpen={isMemoOpen}
            isWorkflowOpen={isWorkflowOpen}
            // 자유 대화, 그리고 투어 중 '직접 인사'(tour_greet)일 때만 입력을 받는다.
            disabled={connStatus !== "open" || !canChat(phase)}
            focusInput={phase === "tour_greet"}
            // 막힌 이유를 구분해서 보여준다 — 서버 문제가 아닌데 '연결 중'이라고 하면 장애로 오해한다.
            disabledHint={
              connStatus !== "open"
                ? "게임 서버에 연결 중이에요…"
                : TOUR_PHASES.has(phase)
                  ? "사수가 팀을 소개하는 중이에요. 인사할 차례가 되면 여기에 입력할 수 있어요."
                  : "지금은 대화할 수 없어요."
            }
            onSend={handleSendToNpc}
            onHistoryToggle={handleHistoryToggle}
            onMemoOpen={handleMemoToggle}
            onWorkflowOpen={handleWorkflowToggle}
          />
          <AiCoachPanel message={coachMessage} />
        </div>
        <span className={styles.keyboardGuide} aria-hidden="true">
          <kbd>WASD</kbd>
          <span>이동</span>
        </span>
      </div>

      {/* ── 페이즈별 화면 — 조건 조합 대신 페이즈 하나로 결정된다 ── */}

      {/* 2·3단계 앞 — 사수가 이번 업무 절차를 알려준다 */}
      {phase === "briefing" && activeStep ? (
        <BriefingPanel
          npcName={activeNpc?.name ?? "사수"}
          npcRole={activeNpc?.role}
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
          missionTitle="신입의 주 업무"
          game={minigame}
          onClear={(result) => {
            // 실제 엔진이면 성적을 그대로, 게임 데이터가 없는 시나리오는 스텁으로.
            // 스텁의 engine:"stub"은 백엔드 aggregate가 걸러내 점수를 오염시키지 않는다.
            socketRef.current?.sendMinigameResult(result ?? { engine: "stub", accuracy: 0 });
            setPhase("reflection");
          }}
        />
      ) : null}

      {/* 5단계 — 체험 소감문 (채점하지 않음. 최종 리포트의 재료) */}
      {phase === "reflection" ? (
        <ReflectionPanel
          scenarioTitle={scenarioTitle}
          submitting={reflectionSending}
          onSubmit={handleReflectionSubmit}
        />
      ) : null}

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
              오늘 체험한 내용은 상담 결과와 함께 최종 진로 리포트에 반영됩니다.
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
