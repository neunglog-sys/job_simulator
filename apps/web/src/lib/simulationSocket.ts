import { wsSimulation } from "../config/endpoints";
import { getToken, type GameStep, type GameTask, type Simulation } from "./api";

// 백엔드 WS 프레임(services/api/.../simulation/router.py)과 1:1.
// 전 프레임 처리 — state_updated는 choice 제출·투어 완료 시 온다.

export type NpcReplyFrame = {
  npc: string;
  name: string;
  content: string;
  delta?: Record<string, number>;
  affinity?: { value: number; delta: number; band: string };
  state?: Record<string, unknown>;
};

// 미달 시 나오는 조언 카드 — 시도가 거듭될수록 깊어진다 (1 방향 → 2 미충족 기준 전부 → 3 정답 골격).
// 필드명은 백엔드 hints.advice_card 반환과 1:1 (level/title/content).
export type AdviceCard = { level: number; title: string; content: string };

export type TaskResultFrame = {
  passed: boolean;
  total: number;
  feedback: string;
  advice_card?: AdviceCard | null;
  farewell?: { npc?: string; name?: string; text: string } | null; // 통과 시 담당 NPC 격려
};

// AI 코치 사후 리뷰 (coach.response.v1) — 미션 통과 시 1회. 근거 기반 카드 최대 3장.
export type CoachCard = {
  card_id: string;
  card_type: "safety_stop" | "error_correction" | "requirement_check" | "better_expression" | "success";
  severity: "critical" | "warning" | "info" | "success";
  title: string;
  summary: string;
};

export type CoachCardsFrame = {
  coach_message: string;
  cards: CoachCard[];
  retry_instruction?: string;
};

// 돌발 퀘스트 — 스텝 전환 시 확률 발동. 별도 미션처럼 등장.
export type SuddenQuestFrame = {
  npc?: string;
  npc_name?: string;
  intro?: string;
  task: GameTask;
};

export type QuestResultFrame = TaskResultFrame & {
  quest_status: string; // active(진행중) | passed | failed
};

// 1단계 온보딩 투어 — 사수가 신입을 데리고 다니며 팀원을 한 명씩 소개한다(컷신 재료).
export type TourFrame = {
  guide: { npc: string; name: string; role: string } | null;
  opening: string; // 팀 소개 전에 사수가 먼저 자기소개하는 말
  stops: Array<{ npc: string; name: string; role: string; line: string }>;
  closing: string; // 소개를 마치고 오늘 업무 흐름을 짚는 말
};

// NPC 실시간 인사 (플레이어가 담당 NPC에게 다가왔을 때)
export type NpcGreetingFrame = {
  npc?: string;
  name?: string;
  text: string;
};

export type SimulationSocketHandlers = {
  onSession?: (session: Simulation) => void;
  onToken?: (text: string, npc?: string) => void;
  onCoachTip?: (text: string) => void;
  onNpcReply?: (reply: NpcReplyFrame) => void;
  onTaskResult?: (result: TaskResultFrame) => void;
  onCoachCards?: (cards: CoachCardsFrame) => void;
  onTour?: (tour: TourFrame) => void;
  onStateUpdated?: (state: Record<string, unknown>) => void;
  onNpcGreeting?: (greeting: NpcGreetingFrame) => void;
  onSuddenQuest?: (quest: SuddenQuestFrame) => void;
  onQuestResult?: (result: QuestResultFrame) => void;
  onStepChanged?: (step: GameStep) => void;
  onActivityMessage?: (message: { name: string; text: string }) => void;
  onReflectionReady?: () => void;
  onCompleted?: () => void;
  onError?: (detail: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
};

/** 시뮬레이션 NPC 대화 채널. 토큰이 있으면 쿼리로 실어 인증, 없으면 백엔드 데모 사용자. */
export class SimulationSocket {
  private ws: WebSocket | null = null;
  private manualClose = false;

  constructor(
    private readonly simulationId: number,
    private readonly handlers: SimulationSocketHandlers,
  ) {}

  connect(): void {
    const ws = new WebSocket(wsSimulation(this.simulationId, getToken()));
    this.ws = ws;
    ws.onopen = () => this.handlers.onOpen?.();
    ws.onerror = () => this.handlers.onError?.("게임 서버 연결에 실패했어요.");
    ws.onclose = () => {
      if (!this.manualClose) this.handlers.onClose?.();
    };
    ws.onmessage = (event) => this.dispatch(event.data);
  }

  private dispatch(raw: unknown): void {
    if (typeof raw !== "string") return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case "session":
        this.handlers.onSession?.(msg as unknown as Simulation);
        break;
      case "token":
        this.handlers.onToken?.(
          String(msg.text ?? ""),
          typeof msg.npc === "string" ? msg.npc : undefined,
        );
        break;
      case "coach_tip":
        this.handlers.onCoachTip?.(String(msg.text ?? ""));
        break;
      case "npc_reply":
        this.handlers.onNpcReply?.(msg as unknown as NpcReplyFrame);
        break;
      case "task_result":
        this.handlers.onTaskResult?.(msg as unknown as TaskResultFrame);
        break;
      case "coach_cards":
        this.handlers.onCoachCards?.(msg as unknown as CoachCardsFrame);
        break;
      case "tour":
        this.handlers.onTour?.(msg as unknown as TourFrame);
        break;
      case "state_updated":
        this.handlers.onStateUpdated?.((msg.state ?? {}) as Record<string, unknown>);
        break;
      case "npc_greeting":
        this.handlers.onNpcGreeting?.(msg as unknown as NpcGreetingFrame);
        break;
      case "sudden_quest":
        this.handlers.onSuddenQuest?.(msg as unknown as SuddenQuestFrame);
        break;
      case "quest_result":
        this.handlers.onQuestResult?.(msg as unknown as QuestResultFrame);
        break;
      case "step_changed":
        this.handlers.onStepChanged?.(msg.step as GameStep);
        break;
      case "activity_message":
        this.handlers.onActivityMessage?.({
          name: String(msg.name ?? ""),
          text: String(msg.text ?? ""),
        });
        break;
      case "reflection_ready":
        this.handlers.onReflectionReady?.();
        break;
      case "simulation_completed":
        this.handlers.onCompleted?.();
        break;
      case "error":
        this.handlers.onError?.(String(msg.detail ?? "알 수 없는 오류가 발생했어요."));
        break;
      default:
        break;
    }
  }

  /** NPC에게 발화 전송. 업무 설명 중에는 서버도 같은 대화 모드를 사용한다. */
  sendChat(
    npc: string,
    content: string,
    mode: "work" | "process_learning" = "work",
  ): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: "chat", npc, content, mode }));
    return true;
  }

  /** 테스트용 — 현재 미션을 채점 없이 통과 처리하고 다음 미션으로. */
  sendSkipStep(): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: "skip_step" }));
    return true;
  }

  /** 미션(과제) 제출 — content는 선택·배열형은 key 배열, 서술형은 문자열. */
  sendTaskSubmit(content: string | string[]): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: "task_submit", content }));
    return true;
  }

  /** 1단계 온보딩 투어 대사 요청 — 응답은 tour 프레임. */
  requestTour(): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: "tour" }));
    return true;
  }

  /** 투어를 끝까지 봤음 — 전원과 인사한 것으로 기록(업무 게이트 해제). */
  sendTourDone(): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: "tour_done" }));
    return true;
  }

  /** 4단계 미니게임 결과 전송 — 역량 지표에 블렌드되고 리포트 근거가 된다 (팀 결정 B안).
   *  engine은 설계 문서의 엔진 키(spot·match·sort·gauge·sequence·route·pour·trace·physics·place).
   *  스텁 등 모르는 engine은 저장만 되고 점수에 반영되지 않는다. */
  sendMinigameResult(result: {
    engine: string;
    accuracy?: number; // 점수형 엔진만 0~100
    time_seconds?: number;
    mistakes?: number;
    completed?: boolean;
    metadata?: Record<string, unknown>;
  }): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: "minigame_result", ...result }));
    return true;
  }

  /** 기존 미션 뒤에 이어지는 미니게임·회고 활동 완료. */
  sendActivityComplete(payload: { game_id?: string; content?: string }): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: "activity_complete", ...payload }));
    return true;
  }

  /** 플레이어 메모 저장 — 사수에게 배운 내용을 직접 받아적는 학습 노트.
   *  저장할 때마다 덮어쓰기(단일 노트), 빈 문자열 = 지움. 채점·리포트에 쓰지 않는다.
   *  복원: 세션 state.memo (새로고침·이어하기 시 그대로 내려온다). */
  sendMemo(content: string): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: "memo", content }));
    return true;
  }

  /** 5단계 체험 소감문 전송 — 채점하지 않고 최종 리포트 재료로 저장된다. */
  sendReflection(content: string): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: "reflection", content }));
    return true;
  }

  /** 담당 NPC 실시간 인사 요청 — 응답은 npc_greeting 프레임. */
  sendGreet(): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: "greet" }));
    return true;
  }

  close(): void {
    this.manualClose = true;
    this.ws?.close();
    this.ws = null;
  }
}
