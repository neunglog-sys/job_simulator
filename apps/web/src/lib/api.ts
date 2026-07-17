import { API_ENDPOINTS } from "../config/endpoints";

// 로그인 토큰은 localStorage에 보관 — 새로고침해도 세션 유지. WS/fetch 인증에 재사용.
const TOKEN_KEY = "jobiverse:token";

let token: string | null = readToken();

function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // 프라이빗 모드 등 storage 접근 불가 — 메모리만 사용
  }
}

export function getToken(): string | null {
  return token;
}

export function setToken(next: string | null): void {
  token = next;
  try {
    if (next) window.localStorage.setItem(TOKEN_KEY, next);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage 불가 — 메모리 토큰만 유지 */
  }
}

/** 백엔드 에러 규약: 본문 {detail: string | object}. 상태코드와 detail을 함께 실어 던진다. */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, detail: unknown, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function messageFromDetail(detail: unknown, status: number): string {
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && "message" in detail) {
    return String((detail as { message: unknown }).message);
  }
  return `요청에 실패했어요 (${status})`;
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(url, { ...options, headers });
  } catch {
    throw new ApiError(0, null, "서버에 연결할 수 없어요. 백엔드가 켜져 있는지 확인해주세요.");
  }

  const raw = await res.text();
  const data = raw ? safeJson(raw) : null;

  if (!res.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail;
    throw new ApiError(res.status, detail, messageFromDetail(detail, res.status));
  }
  return data as T;
}

// --- 백엔드 응답 타입 (스키마와 1:1) ---
export type TokenOut = { access_token: string; token_type: string };
export type Me = { id: number; email: string | null; name: string };
export type Consultation = { id: number; status: string; created_at: string };

export function signup(body: { email: string; password: string; name: string }): Promise<TokenOut> {
  return request(API_ENDPOINTS.auth.signUp, { method: "POST", body: JSON.stringify(body) });
}

export function login(body: { email: string; password: string }): Promise<TokenOut> {
  return request(API_ENDPOINTS.auth.signIn, { method: "POST", body: JSON.stringify(body) });
}

export function fetchMe(): Promise<Me> {
  return request(API_ENDPOINTS.auth.me, { method: "GET" });
}

export function createConsultation(): Promise<Consultation> {
  return request(API_ENDPOINTS.consultations.create, { method: "POST" });
}

// --- 시뮬레이션(게임) 타입 — 백엔드 SimulationOut 스키마와 1:1 ---
export type GameTaskOption = { key: string; label: string };
export type GameTask = {
  kind: string; // write | choice | checklist | order
  prompt: string;
  criteria: string[];
  pass_score: number;
  options: GameTaskOption[];
  answer?: { key?: string; keys?: string[] } | null; // ⚠️ 테스트용 정답 공개
  answer_guide?: string | null; // ⚠️ 테스트용 정답 해설
};
export type GameStep = {
  id: string;
  title: string;
  mission: string;
  npcs: string[]; // npc_id 목록 (표시정보는 Simulation.npcs에서 조회)
  guide: string | null;
  // 사수가 업무 시작 전에 알려주는 절차 — 브리핑 창 + 업무 노트에 표시.
  // 정답 키(task.answer)는 서버가 내려주지 않으므로, 들은 절차를 섞인 보기와 맞추는 건 사용자 몫.
  briefing: string[];
  choices: Array<Record<string, unknown>>;
  task: GameTask | null;
};
export type GameNpc = {
  npc_id: string;
  name: string;
  role: string;
  rank: string | null;
  spawn: string | null; // 맵 geometry.spawns의 자리 id (teamjang|sasu|bujang)
};
export type GameSpawn = { id: string; x: number; y: number };
export type GameMapData = {
  id: string;
  background: string | null; // /maps/<폴더>/<파일>.png (백엔드 정적 서빙) — 절대 URL은 API_BASE_URL 접두
  geometry: {
    size?: { width: number; height: number };
    spawns?: GameSpawn[];
    walkable?: Array<{ x: number; y: number; w: number; h: number; id?: string }>;
    collision?: Array<{ x: number; y: number; w: number; h: number }>;
    [key: string]: unknown;
  };
};
export type Simulation = {
  id: number;
  scenario_slug: string;
  scenario_title: string;
  module: string | null;
  status: string;
  state: Record<string, unknown>;
  step: GameStep;
  step_ids: string[]; // 본편 미션 id 순서 (진행률 계산용, 돌발 퀘스트 제외)
  npcs: GameNpc[];
  map: GameMapData | null; // null이면 맵 미배정 → 프론트 기본 배경 폴백
  created_at: string;
};

export function createSimulation(scenarioSlug: string): Promise<Simulation> {
  return request(API_ENDPOINTS.simulations.create, {
    method: "POST",
    body: JSON.stringify({ scenario_slug: scenarioSlug }),
  });
}

/** 진행 중이던 시뮬 이어받기 — 새로고침·뒤로가기로 진행도(투어·인사·미션)가 날아가지 않게. */
export function fetchSimulation(id: number): Promise<Simulation> {
  return request(API_ENDPOINTS.simulations.detail(id));
}

// 수행 점수 — 완주 화면·리포트 근거. 진행 중이면 부분 집계.
export type SimulationScore = {
  total: number;
  mission_avg: number;
  missions: Array<{ step: string; type: string | null; adjusted: number; attempts: number }>;
  quest: { status: string; adjusted: number } | null;
  competencies: Record<string, number | null>;
  // 대화 태도(사회생활 화법) — NPC를 어떻게 대했는가. 대화 이력이 없으면 null.
  conduct: { average: number; band: string; npc_count: number; lowest: number } | null;
  percentile?: { sample_size: number; top_percent: number | null };
};

export function fetchSimulationScore(id: number): Promise<SimulationScore> {
  return request(API_ENDPOINTS.simulations.score(id));
}
