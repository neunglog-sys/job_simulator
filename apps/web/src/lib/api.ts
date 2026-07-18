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

/**
 * 상담 메시지 전송 → 아바타 응답을 **토큰 단위로 스트리밍**.
 *
 * 백엔드가 SSE(`event: token` → `event: done`)로 보내는데, 브라우저 `EventSource`는 GET만
 * 지원해서 못 쓴다. 그래서 fetch로 POST한 뒤 본문 스트림을 직접 파싱한다.
 *
 * 토큰이 오는 대로 화면에 흘려주면, 아바타 영상(첫 발화까지 ~7초)을 기다리는 동안
 * 사용자가 답변을 먼저 읽을 수 있어 체감 지연이 줄어든다.
 */
export async function* streamConsultationReply(
  consultationId: number,
  content: string,
): AsyncGenerator<string, void, unknown> {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (token) (headers as Record<string, string>).Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(API_ENDPOINTS.consultations.messages(consultationId), {
      method: "POST",
      headers,
      body: JSON.stringify({ content }),
    });
  } catch {
    throw new ApiError(0, null, "서버에 연결할 수 없어요. 백엔드가 켜져 있는지 확인해주세요.");
  }

  if (!res.ok || !res.body) {
    const raw = await res.text().catch(() => "");
    const detail = (safeJson(raw) as { detail?: unknown } | null)?.detail;
    throw new ApiError(res.status, detail, messageFromDetail(detail, res.status));
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;

      // SSE는 빈 줄로 이벤트를 구분한다. 마지막 조각은 아직 안 끝났을 수 있으니 buffer에 남긴다.
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        let event = "message";
        const dataLines: string[] = [];
        for (const rawLine of block.split("\n")) {
          const l = rawLine.trimEnd();
          if (l.startsWith("event:")) event = l.slice(6).trim();
          else if (l.startsWith("data:")) dataLines.push(l.slice(5).trim());
        }
        const data = dataLines.join("\n");
        if (event === "done") return;
        if (event === "error") {
          const detail = (safeJson(data) as { detail?: unknown } | null)?.detail;
          throw new ApiError(500, detail, messageFromDetail(detail, 500));
        }
        if (event === "token") {
          const text = (safeJson(data) as { text?: unknown } | null)?.text;
          if (typeof text === "string" && text) yield text;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

// --- 아바타 (SoulX-FlashHead) ---
export type AvatarStatusOut = { enabled: boolean; model_type: string };
/** hls_url = HLS 재생목록(.m3u8). mp4가 아니라 스트림이라 hls.js로 재생해야 한다. */
export type AvatarSpeakOut = { hls_url: string; model_type: string };

export function fetchAvatarStatus(): Promise<AvatarStatusOut> {
  return request(API_ENDPOINTS.avatar.status, { method: "GET" });
}

/**
 * 발화 텍스트 → 아바타 HLS 스트림 URL.
 *
 * ⚠️ **첫 URL까지 약 7초** 걸린다(Gradio 큐/SSE 오버헤드 — 실측). 영상 자체는 1.8초면
 * 만들어지지만 URL이 늦게 온다. 호출부는 그동안 avatarStatus를 "thinking"으로 유지할 것.
 * 아바타 미설정(Colab 세션 없음)이면 503 → 호출부에서 idle 유지로 폴백.
 */
export function speakAvatar(text: string, voice?: string): Promise<AvatarSpeakOut> {
  return request(API_ENDPOINTS.avatar.speak, {
    method: "POST",
    body: JSON.stringify(voice ? { text, voice } : { text }),
  });
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
