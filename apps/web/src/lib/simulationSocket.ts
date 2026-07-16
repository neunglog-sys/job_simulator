import { wsSimulation } from "../config/endpoints";
import { getToken, type GameStep, type GameTask, type Simulation } from "./api";

// 백엔드 WS 프레임(services/api/.../simulation/router.py)과 1:1.
// 이번 테스트 단계에서 다루는 것: session / token / coach_tip / npc_reply / step_changed / error.
// task_result·quest_result·state_updated·sudden_quest·simulation_completed·coach_cards는
// 과제 제출 UI를 붙이는 다음 단계에서 사용 — 지금은 조용히 무시한다.

export type NpcReplyFrame = {
  npc: string;
  name: string;
  content: string;
  delta?: Record<string, number>;
  affinity?: { value: number; delta: number; band: string };
  state?: Record<string, unknown>;
};

export type TaskResultFrame = {
  passed: boolean;
  total: number;
  feedback: string;
  advice_card?: { level?: number; title?: string; body?: string } | null;
  farewell?: { npc?: string; name?: string; text: string } | null; // 통과 시 담당 NPC 격려
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

// NPC 실시간 인사 (플레이어가 담당 NPC에게 다가왔을 때)
export type NpcGreetingFrame = {
  npc?: string;
  name?: string;
  text: string;
};

export type SimulationSocketHandlers = {
  onSession?: (session: Simulation) => void;
  onToken?: (text: string) => void;
  onCoachTip?: (text: string) => void;
  onNpcReply?: (reply: NpcReplyFrame) => void;
  onTaskResult?: (result: TaskResultFrame) => void;
  onNpcGreeting?: (greeting: NpcGreetingFrame) => void;
  onSuddenQuest?: (quest: SuddenQuestFrame) => void;
  onQuestResult?: (result: QuestResultFrame) => void;
  onStepChanged?: (step: GameStep) => void;
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
        this.handlers.onToken?.(String(msg.text ?? ""));
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

  /** NPC에게 발화 전송. 소켓이 아직 안 열렸으면 false. */
  sendChat(npc: string, content: string): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: "chat", npc, content }));
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
