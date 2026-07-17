import { UserCircle } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AiCoachPanel } from "../components/scenario/AiCoachPanel";
import { BriefingPanel } from "../components/scenario/BriefingPanel";
import { DashboardHeader } from "../components/scenario/DashboardHeader";
import { GameMapLayer } from "../components/scenario/GameMapLayer";
import { HintPanel } from "../components/scenario/HintPanel";
import { MiniGamePanel } from "../components/scenario/MiniGamePanel";
import { MissionPanel } from "../components/scenario/MissionPanel";
import { MovementArea } from "../components/scenario/MovementArea";
import { PLAYER_SIZE } from "../components/scenario/PlayerSprite";
import { ScenarioControlPanel } from "../components/scenario/ScenarioControlPanel";
import type { HintCardData, Position } from "../components/scenario/types";
import { API_BASE_URL } from "../config/endpoints";
import type { MissionView } from "../components/scenario/MissionPanel";
import {
  ApiError,
  createSimulation,
  fetchSimulationScore,
  type GameNpc,
  type GameStep,
  type GameTask,
  type Simulation,
  type SimulationScore,
} from "../lib/api";
import { logout } from "../lib/auth";
import {
  SimulationSocket,
  type AdviceCard,
  type CoachCardsFrame,
  type TaskResultFrame,
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

const COACH_SEVERITY: Record<string, string> = {
  critical: "꼭 고칠 것",
  warning: "주의",
  info: "참고",
  success: "잘한 점",
};

// 백엔드 리포트 PDF(reporting/pdf.py COMPETENCY_NAMES)와 같은 표기를 쓴다.
const COMPETENCY_NAMES: Record<string, string> = {
  situation_judgment: "상황 판단력",
  problem_solving: "문제해결력",
  communication: "커뮤니케이션",
  collaboration: "협업",
  task_management: "업무 관리",
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

export function ScenarioGamePage() {
  const [isHintOpen, setIsHintOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [coachMessage, setCoachMessage] = useState(DEFAULT_COACH_MESSAGE);
  const [playerPosition, setPlayerPosition] = useState<Position>({ x: 420, y: 290 });
  const [stageScale, setStageScale] = useState(getStageScale);

  // 시뮬레이션(게임) 연결 상태
  const [connStatus, setConnStatus] = useState<ConnectionStatus>("creating");
  const [activeStep, setActiveStep] = useState<GameStep | null>(null);
  const [npcs, setNpcs] = useState<GameNpc[]>([]);
  const [gameMap, setGameMap] = useState<Simulation["map"]>(null);
  const [scenarioTitle, setScenarioTitle] = useState("");
  const [stepIds, setStepIds] = useState<string[]>([]); // 본편 미션 순서 (진행률 계산용)
  const [isCompleted, setIsCompleted] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [isMissionOpen, setIsMissionOpen] = useState(false);
  const [taskResult, setTaskResult] = useState<TaskResultFrame | null>(null);
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [quest, setQuest] = useState<{ title: string; task: GameTask; banner?: string } | null>(null);
  const [greetSent, setGreetSent] = useState(false);
  const [farewell, setFarewell] = useState<{ name: string; text: string } | null>(null); // 통과 격려 배너
  const npcsRef = useRef<GameNpc[]>([]); // 코치 안내 문구용 로스터(핸들러 클로저의 stale 방지)
  const [npcMessage, setNpcMessage] = useState("");
  const [userMessage, setUserMessage] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [chatNpcId, setChatNpcId] = useState<string | null>(null); // 대화 상대(마커 클릭). null=미션 담당 NPC
  const [mapImage, setMapImage] = useState<string>(DEFAULT_SCENARIO_MAP_IMAGE);
  // 미달할수록 깊어지는 조언 카드 — 스텝(또는 퀘스트)당 누적, 힌트 패널에 쌓인다.
  const [adviceCards, setAdviceCards] = useState<AdviceCard[]>([]);
  // 미션 통과 후 AI 코치 사후 리뷰 (근거 기반 카드)
  const [coachCards, setCoachCards] = useState<CoachCardsFrame | null>(null);
  // 완주 시 수행 결과 — 리포트에 실릴 근거를 사용자에게도 보여준다
  const [finalScore, setFinalScore] = useState<SimulationScore | null>(null);
  // 4단계(실무 미니게임) — 마지막 스텝(소감문) 직전에 1회. 지금은 빈 창 → 바로 완료.
  const [miniGameOpen, setMiniGameOpen] = useState(false);
  const [miniGameCleared, setMiniGameCleared] = useState(false);
  // 1·3단계 — 업무를 받기 전 사수 브리핑(절차 설명). 스텝당 1회.
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [briefedSteps, setBriefedSteps] = useState<string[]>([]); // 브리핑 본 스텝 id
  const socketRef = useRef<SimulationSocket | null>(null);

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
  const progress = isCompleted
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

  // 담당 NPC 근처 + 미션 미진행일 때만 업무 배너 표시 (순차 진행 — 현재 스텝 NPC에게만 뜬다).
  const showEncounter =
    isNearActiveNpc &&
    !isMissionOpen &&
    !isCompleted &&
    !quest &&
    !farewell && // 격려 배너가 떠 있는 동안은 업무 배너 숨김
    Boolean(activeStep?.task);

  // 4단계(실무 미니게임) 발동 — 앞 미션들로 주 업무를 익힌 뒤, 마지막 소감문 스텝 직전에 1회.
  // 마지막 스텝 = step_ids의 끝(본편 미션 순서). 돌발 퀘스트 중에는 끼어들지 않는다.
  const isFinalStep = Boolean(
    activeStep && stepIds.length > 0 && activeStep.id === stepIds[stepIds.length - 1],
  );
  useEffect(() => {
    if (isFinalStep && !miniGameCleared && !quest && !isCompleted) setMiniGameOpen(true);
  }, [isFinalStep, miniGameCleared, quest, isCompleted]);

  // 담당 NPC에게 처음 다가가면 실시간 인사를 1회 요청 (스텝당 1회, 응답 오면 채팅창에 표시).
  useEffect(() => {
    if (showEncounter && !greetSent && socketRef.current?.sendGreet()) {
      setGreetSent(true);
    }
  }, [showEncounter, greetSent]);

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
      npcsRef.current = sim.npcs;
      setGameMap(sim.map);
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
        const sim = await createSimulation(DEFAULT_SCENARIO_SLUG);
        if (cancelled) return;
        applySim(sim);

        socket = new SimulationSocket(sim.id, {
          onOpen: () => !cancelled && setConnStatus("open"),
          onClose: () => !cancelled && setConnStatus("closed"),
          onError: (detail) => {
            if (cancelled) return;
            setConnStatus("error");
            setCoachMessage(detail);
            setIsStreaming(false);
            setTaskSubmitting(false);
          },
          onToken: (text) => !cancelled && setNpcMessage((prev) => prev + text),
          onNpcReply: (reply) => {
            if (cancelled) return;
            setNpcMessage(reply.content);
            setIsStreaming(false);
          },
          onTaskResult: (taskResultFrame) => {
            if (cancelled) return;
            setTaskResult(taskResultFrame);
            setTaskSubmitting(false);
            // 미달 → 조언 카드 누적 (같은 단계는 한 번만). 힌트 패널에서 계속 볼 수 있게.
            const advice = taskResultFrame.advice_card;
            if (advice) {
              setAdviceCards((current) =>
                current.some((card) => card.level === advice.level) ? current : [...current, advice],
              );
              setIsHintOpen(true); // 도움이 도착했음을 바로 보이게
            }
            if (taskResultFrame.passed) {
              // 통과 → 미션 패널 닫음(자동으로 다음 미션 X) + 담당 NPC 격려 배너 표시
              setIsMissionOpen(false);
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
            setTaskSubmitting(false);
            setIsMissionOpen(true);
          },
          onQuestResult: (questResult) => {
            if (cancelled) return;
            setTaskSubmitting(false);
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
            setTaskSubmitting(false);
            setGreetSent(false); // 다음 담당 NPC 인사를 새로 요청
            setAdviceCards([]); // 조언 카드는 미션별 — 다음 미션으로 넘기지 않는다
            setCoachCards(null);
            setCoachMessage(approachGuide(step, npcsRef.current));
          },
          onCompleted: () => {
            if (cancelled) return;
            setIsMissionOpen(false);
            setIsCompleted(true);
            // 완주 결과 = 리포트에 실릴 수행 근거 (총점·역량·대화 태도). 실패해도 완주 화면은 유지.
            fetchSimulationScore(sim.id)
              .then((score) => !cancelled && setFinalScore(score))
              .catch(() => undefined);
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
  }, [retryKey]);

  const handleSendToNpc = useCallback(
    (message: string) => {
      const socket = socketRef.current;
      if (!socket || !chatTargetId) return;
      setUserMessage(message);
      setNpcMessage("");
      setIsStreaming(true);
      const sent = socket.sendChat(chatTargetId, message);
      if (!sent) {
        setIsStreaming(false);
        setCoachMessage("게임 서버에 연결 중이에요. 잠시 후 다시 보내주세요.");
      }
    },
    [chatTargetId],
  );

  // NPC 마커 클릭 → 그 NPC와 대화 (미션 진행과 무관한 자유 대화). 대화창 초기화.
  const handleNpcClick = useCallback((npcId: string) => {
    setChatNpcId(npcId);
    setNpcMessage("");
    setUserMessage("");
    setIsStreaming(false);
  }, []);

  // 테스트용 — 현재 미션을 채점 없이 통과 처리하고 다음 미션으로 (WS skip_step). 마지막이면 완료 오버레이.
  const handleSkip = useCallback(() => {
    const socket = socketRef.current;
    setNpcMessage("");
    setUserMessage("");
    // 돌발 퀘스트 표시 중 스킵하면 서버는 퀘스트를 통과 처리(프레임 없음)하므로 로컬도 함께 정리.
    setQuest(null);
    setTaskResult(null);
    setTaskSubmitting(false);
    if (!socket || !socket.sendSkipStep()) {
      setCoachMessage("게임 서버에 연결 중이에요. 잠시 후 다시 시도해주세요.");
    }
  }, []);

  // 리트라이 — 현재 시뮬을 닫고 첫 미션부터 새로 시작한다.
  const handleRetry = useCallback(() => {
    setIsCompleted(false);
    setIsMissionOpen(false);
    setQuest(null);
    setTaskResult(null);
    setTaskSubmitting(false);
    setGreetSent(false);
    setFarewell(null);
    setChatNpcId(null);
    setNpcMessage("");
    setUserMessage("");
    setIsStreaming(false);
    setAdviceCards([]);
    setCoachCards(null);
    setFinalScore(null);
    setMiniGameOpen(false);
    setMiniGameCleared(false); // 처음부터 다시 = 4단계도 다시
    setBriefingOpen(false);
    setBriefedSteps([]); // 브리핑도 다시 듣는다
    setConnStatus("creating");
    setRetryKey((key) => key + 1);
  }, []);

  // 업무 받기 — 이 스텝의 브리핑을 아직 안 들었으면 사수 설명부터(1·3단계), 들었으면 바로 과제(2단계).
  const handleOpenMission = useCallback(() => {
    setTaskResult(null);
    const stepId = activeStep?.id;
    if (stepId && !quest && !briefedSteps.includes(stepId) && (activeStep?.briefing?.length ?? 0) > 0) {
      setBriefingOpen(true);
      return;
    }
    setIsMissionOpen(true);
  }, [activeStep, briefedSteps, quest]);

  // 브리핑을 다 들으면 그 스텝은 들은 것으로 기록하고 과제로 넘어간다.
  const handleBriefingDone = useCallback(() => {
    if (activeStep?.id) setBriefedSteps((current) => [...current, activeStep.id]);
    setBriefingOpen(false);
    setIsMissionOpen(true);
  }, [activeStep]);

  // 미션(과제) 제출 — WS task_submit. 통과 시 step_changed로 다음 미션, 마지막이면 완료.
  const handleTaskSubmit = useCallback((content: string | string[]) => {
    const socket = socketRef.current;
    setTaskResult(null);
    setTaskSubmitting(true);
    if (!socket || !socket.sendTaskSubmit(content)) {
      setTaskSubmitting(false);
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
      <div className={styles.designStage} style={stageStyle} data-debug="false">
        <GameMapLayer imageUrl={mapImage} />
        <MovementArea
          position={playerPosition}
          onPositionChange={setPlayerPosition}
          onCoachMessage={setCoachMessage}
          geometry={gameMap?.geometry ?? null}
          npcs={npcs}
          activeNpcId={activeNpcId}
          onNpcClick={handleNpcClick}
        />
        <DashboardHeader
          progress={progress}
          isHintOpen={isHintOpen}
          isFullscreen={isFullscreen}
          onHintToggle={() => setIsHintOpen((current) => !current)}
          onFullscreenToggle={toggleFullscreen}
          onLogout={() => {
            logout();
            window.location.assign("/");
          }}
          onMenuOpen={() => setCoachMessage("메뉴 기능은 다음 시나리오 단계와 연결될 예정이에요.")}
          onSettingsOpen={() => setCoachMessage("설정 메뉴에서 사운드와 이동 방식을 조정할 수 있게 될 예정이에요.")}
          onHome={() => window.location.assign("/")}
          onBack={() => {
            if (window.history.length > 1) window.history.back();
            else window.location.assign("/");
          }}
          onSkip={handleSkip}
          onRetry={handleRetry}
          onMission={handleOpenMission}
        />
        <HintPanel isOpen={isHintOpen} hints={hints} />

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
              <p>오늘의 업무</p>
            </div>
            <button className={styles.encounterButton} type="button" onClick={handleOpenMission}>
              업무 받기 →
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
            npcName={chatNpc?.name ?? "NPC"}
            npcRole={chatNpc?.role}
            npcMessage={npcMessage}
            userMessage={userMessage}
            isStreaming={isStreaming}
            disabled={connStatus !== "open"}
            onSend={handleSendToNpc}
          />
          <AiCoachPanel message={coachMessage} />
        </div>
        <span className={styles.keyboardGuide} aria-hidden="true">
          <kbd>WASD</kbd>
          <span>이동</span>
        </span>
      </div>

      {/* 1·3단계 — 사수가 업무 절차를 알려주는 브리핑. 과제 창보다 먼저 뜬다. */}
      {briefingOpen && activeStep ? (
        <BriefingPanel
          npcName={activeNpc?.name ?? "사수"}
          npcRole={activeNpc?.role}
          missionTitle={activeStep.title}
          mission={activeStep.mission}
          steps={activeStep.briefing ?? []}
          onClose={handleBriefingDone}
        />
      ) : null}

      {/* 4단계 — 실무 미니게임(빈 창). 소감문 미션보다 먼저 뜨고, 완료하면 5단계로 넘어간다. */}
      {miniGameOpen && !briefingOpen ? (
        <MiniGamePanel
          missionTitle={activeStep?.title || "신입의 주 업무"}
          onClear={() => {
            setMiniGameCleared(true);
            setMiniGameOpen(false);
          }}
        />
      ) : null}

      {isMissionOpen && activeMission && !miniGameOpen && !briefingOpen ? (
        <MissionPanel
          key={quest ? "quest" : activeStep?.id}
          mission={activeMission}
          submitting={taskSubmitting}
          result={taskResult}
          onSubmit={handleTaskSubmit}
          onSkip={handleSkip}
          onClose={() => setIsMissionOpen(false)}
          onClearResult={() => setTaskResult(null)}
        />
      ) : null}

      {isCompleted ? (
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
            {finalScore ? (
              <div className={styles.completionScore}>
                <p className={styles.completionTotal}>
                  수행 점수 <strong>{finalScore.total}점</strong>
                  {finalScore.percentile?.top_percent != null
                    ? ` · 상위 ${finalScore.percentile.top_percent}%`
                    : ""}
                </p>
                <ul className={styles.completionCompetencies}>
                  {Object.entries(finalScore.competencies)
                    .filter(([, value]) => value != null)
                    .map(([key, value]) => (
                      <li key={key}>
                        <span>{COMPETENCY_NAMES[key] ?? key}</span>
                        <strong>{value}점</strong>
                      </li>
                    ))}
                </ul>
                {finalScore.conduct ? (
                  <p className={styles.completionConduct}>
                    동료 대응 태도 · 평균 호감도 {finalScore.conduct.average}/100 (
                    {finalScore.conduct.band})
                  </p>
                ) : null}
                <p className={styles.completionNote}>
                  이 결과는 최종 진로 리포트의 수행 근거로 반영됩니다.
                </p>
              </div>
            ) : null}
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
    </main>
  );
}
