import { API_ENDPOINTS } from "../config/endpoints";
import type { MinigameDef } from "../components/scenario/minigames/types";

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
export type ConsultationSummary = {
  id: number;
  status: "active" | "completed";
  title: string;
  preview: string;
  message_count: number;
  created_at: string;
  updated_at: string;
};

export function signup(body: {
  email: string;
  password: string;
  name: string;
  terms_agreed: true;
  privacy_agreed: true;
}): Promise<TokenOut> {
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

export function fetchConsultations(): Promise<ConsultationSummary[]> {
  return request(API_ENDPOINTS.consultations.list, { method: "GET" });
}

export function updateConsultationTitle(
  consultationId: number,
  title: string,
): Promise<{ id: number; title: string }> {
  return request(API_ENDPOINTS.consultations.detail(consultationId), {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export function deleteConsultation(consultationId: number): Promise<void> {
  return request(API_ENDPOINTS.consultations.detail(consultationId), { method: "DELETE" });
}

// --- 상담 메시지 — 백엔드 MessageOut과 1:1 ---
export type ConsultationMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export function fetchConsultationMessages(
  consultationId: number,
): Promise<ConsultationMessage[]> {
  return request(API_ENDPOINTS.consultations.messages(consultationId), { method: "GET" });
}

/** 아바타 응답 SSE 스트리밍(event: token → done). fetch+ReadableStream 직접 파싱 —
 * EventSource는 GET 전용이라 본문이 필요한 이 POST 스트림엔 못 쓴다. */
export type ConsultationStreamDoneMetrics = {
  server_first_token_ms?: number;
  server_total_ms?: number;
  server_output_chars?: number;
  server_output_chars_per_s?: number;
  // 백엔드(#131)가 상세요청(길이제한 해제) 응답에 true로 실어보냄 → 아바타 음성 합성 생략(텍스트만).
  skip_tts?: boolean;
};

export async function streamConsultationReply(
  consultationId: number,
  content: string,
  onToken: (text: string) => void,
  options: { onDone?: (metrics: ConsultationStreamDoneMetrics) => void } = {},
): Promise<void> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);

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
    const data = raw ? safeJson(raw) : null;
    const detail = (data as { detail?: unknown } | null)?.detail;
    throw new ApiError(res.status, detail, messageFromDetail(detail, res.status));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeEvent = (rawEvent: string) => {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of rawEvent.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) return;

    const data = safeJson(dataLines.join("\n")) as { text?: string; detail?: string } | null;
    if (eventName === "token" && data?.text) {
      onToken(data.text);
    } else if (eventName === "done") {
      options.onDone?.((data ?? {}) as ConsultationStreamDoneMetrics);
    } else if (eventName === "error") {
      throw new ApiError(500, data?.detail, data?.detail ?? "응답 생성에 실패했어요.");
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // sse_starlette는 이벤트를 `\r\n\r\n`로 구분한다 → 리터럴 "\n\n"으로는 못 잘림.
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) consumeEvent(block);
  }
  if (buffer.trim()) consumeEvent(buffer);
}

// --- 사전 설문 — 백엔드 survey.py 문항(정답지인 dimension_scores는 노출 안 됨) ---
export type SurveyItem = {
  id: string;
  text: string;
  options: Array<{ key: string; label: string }>;
};

export function fetchSurveyItems(consultationId: number): Promise<{ items: SurveyItem[] }> {
  return request(API_ENDPOINTS.consultations.survey(consultationId), { method: "GET" });
}

export type SurveySubmitResult = {
  profile: Record<string, number>;
  avatar_lines: string[];
};

export function submitConsultationSurvey(
  consultationId: number,
  answers: Record<string, string>,
): Promise<SurveySubmitResult> {
  return request(API_ENDPOINTS.consultations.survey(consultationId), {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
}

// --- 직무 추천 · 최종 리포트 — 백엔드 recommendation/reporting 스키마와 1:1 ---
export type JobRecommendation = {
  job_code: string;
  job_title: string;
  score: number;
  reason: string;
  education_requirement: Record<string, unknown> | null;
  salary: Record<string, unknown> | null;
  certifications: unknown[];
  scenario_slug: string | null;
};

export type Recommendation = {
  id: number;
  consultation_id: number;
  results: JobRecommendation[];
  feedback: string | null;
  created_at: string;
};

/** 상담 대화를 분석해 적합 직무 상위 5개를 추천 — 상담은 completed로 전환됨.
 * 적성 파악이 부족하면 409(aptitude_unclear, detail에 follow-up 질문 포함)로 거절될 수 있음. */
export function createRecommendation(consultationId: number): Promise<Recommendation> {
  return request(API_ENDPOINTS.recommendations.create, {
    method: "POST",
    body: JSON.stringify({ consultation_id: consultationId }),
  });
}

export function fetchLatestRecommendation(consultationId: number): Promise<Recommendation | null> {
  return request(API_ENDPOINTS.recommendations.latest(consultationId), { method: "GET" });
}

export type ScenarioSummary = {
  slug: string;
  title: string;
  module: string | null;
  job_code: string;
  job_title: string;
  map_id: string | null;
  map_background: string | null;
};

export function fetchScenarios(): Promise<ScenarioSummary[]> {
  return request(API_ENDPOINTS.scenarios.list, { method: "GET" });
}

export type Report = {
  id: number;
  status: "pending" | "done" | "failed";
  consultation_id: number | null;
  simulation_id: number | null;
  fit_score: number | null;
  strengths: string[];
  improvements: string[];
  advice: string | null;
  created_at: string;
};

/** 리포트 생성은 백엔드에서 비동기 처리 — status가 done/failed 될 때까지 fetchReport로 폴링. */
export function createReport(consultationId: number): Promise<Report> {
  return request(API_ENDPOINTS.reports.create, {
    method: "POST",
    body: JSON.stringify({ consultation_id: consultationId }),
  });
}

export function fetchReport(reportId: number): Promise<Report> {
  return request(API_ENDPOINTS.reports.detail(reportId));
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
// overhead 오클루더 — 가구 상단부. 배경을 같은 위치에서 잘라 캐릭터 위에 y-정렬로 겹친다.
// 사각형(x,y,w,h) 또는 폴리곤(points+bbox), 복잡한 가구는 픽셀 마스크(mask 파일명).
export type GameOccluder = {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  points?: Array<[number, number]>; // 절대(스테이지) 좌표 꼭짓점
  bbox?: { x: number; y: number; w: number; h: number };
  baseline: number; // 밑변 y — 발이 이보다 위(작음)면 캐릭터가 '뒤' → 가려짐
  mask?: string; // 맵 폴더 기준 마스크 PNG 파일명
  id?: string;
};
export type GameMapData = {
  id: string;
  background: string | null; // /maps/<폴더>/<파일>.png (백엔드 정적 서빙) — 절대 URL은 API_BASE_URL 접두
  geometry: {
    size?: { width: number; height: number };
    spawns?: GameSpawn[];
    walkable?: Array<{ x: number; y: number; w: number; h: number; id?: string }>;
    collision?: Array<{ x: number; y: number; w: number; h: number }>;
    collision_polys?: Array<{ points: Array<[number, number]>; id?: string }>; // 대각선 구조물 등
    overhead?: GameOccluder[];
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
  minigame: MinigameDef | null; // 4단계 게임 정의. null이면 '준비 중' 빈 창으로 폴백
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

// --- 아바타 (SoulX-FlashHead stream) — feature/JMS 이식 ---
export type AvatarProvider = "musetalk" | "fastapi" | "gradio";
export type AvatarStatusOut = {
  enabled: boolean;
  model_type: string;
  provider?: AvatarProvider;
};
/** hls_url = 백엔드가 재봉합한 연속 fragmented MP4 스트림 URL. */
export type AvatarSpeakOut = { hls_url: string; model_type: string };
export type AvatarChunkPlan = { total: number; chunks: string[] };
export type AvatarChunkOut = AvatarSpeakOut & {
  index: number;
  total: number;
  text: string;
  elapsed_ms: number;
};

export function fetchAvatarStatus(): Promise<AvatarStatusOut> {
  return request(API_ENDPOINTS.avatar.status, { method: "GET" });
}

export type MuseTalkSpeakRequest = {
  text: string;
  voice?: string | null;
  speaker_id?: string;
  gesture_index?: number;
};

export type MuseTalkBlobOut = {
  blob: Blob;
  bytes: number;
  elapsed_ms: number;
  statuses: unknown[];
};

export function createAvatarWebSocket(): WebSocket {
  return new WebSocket(API_ENDPOINTS.avatar.ws(token));
}

export function generateMuseTalkBlob(
  request: MuseTalkSpeakRequest,
): Promise<MuseTalkBlobOut> {
  return new Promise((resolve, reject) => {
    const socket = createAvatarWebSocket();
    const startedAt = window.performance.now();
    const chunks: ArrayBuffer[] = [];
    const statuses: unknown[] = [];
    let settled = false;
    let bytes = 0;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({
        blob: new Blob(chunks, { type: "video/mp4" }),
        bytes,
        elapsed_ms: Math.round(window.performance.now() - startedAt),
        statuses,
      });
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      reject(new ApiError(500, message, message));
    };

    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      console.info("[MuseTalk]", "prefetch_ws_open", request);
      socket.send(JSON.stringify({ speaker_id: "coach", emotion: "neutral", ...request }));
    };
    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        const payload = safeJson(event.data);
        statuses.push(payload);
        const signal = (payload as { type?: string; status?: string; stage?: string } | null)?.type;
        if (signal === "error") fail("MuseTalk 백그라운드 청크 생성에 실패했어요.");
        if (signal === "done") {
          try {
            socket.close(1000);
          } catch {
            // 이미 닫힌 경우 무시한다.
          }
          finish();
        }
        return;
      }

      const push = (chunk: ArrayBuffer) => {
        chunks.push(chunk);
        bytes += chunk.byteLength;
      };
      if (event.data instanceof Blob) void event.data.arrayBuffer().then(push);
      else if (event.data instanceof ArrayBuffer) push(event.data);
    };
    socket.onerror = (event) => {
      console.error("[MuseTalk]", "prefetch_ws_error", event);
      fail("MuseTalk 백그라운드 WebSocket 연결에 실패했어요.");
    };
    socket.onclose = (event) => {
      console.info("[MuseTalk]", "prefetch_ws_close", {
        code: event.code,
        reason: event.reason,
        bytes,
        settled,
      });
      if (settled) return;
      if (chunks.length > 0 && event.code === 1000) finish();
      else fail("MuseTalk 백그라운드 WebSocket이 조기 종료됐어요.");
    };
  });
}

/**
 * 발화 텍스트 → 아바타 연속 MP4 스트림 URL.
 * ⚠️ 첫 URL까지 약 7초(Gradio 큐/SSE 오버헤드). 호출부는 그동안 avatarStatus를 "thinking" 유지.
 * 아바타 미설정(Colab 세션 없음)이면 503 → idle 유지로 폴백.
 */
export function speakAvatar(text: string, voice?: string): Promise<AvatarSpeakOut> {
  return request(API_ENDPOINTS.avatar.speak, {
    method: "POST",
    body: JSON.stringify(voice ? { text, voice } : { text }),
  });
}

export async function streamAvatarSpeakChunks(
  text: string,
  onChunk: (chunk: AvatarChunkOut) => void,
  options: {
    voice?: string;
    onPlan?: (plan: AvatarChunkPlan) => void;
  } = {},
): Promise<void> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(API_ENDPOINTS.avatar.speakChunks, {
      method: "POST",
      headers,
      body: JSON.stringify(options.voice ? { text, voice: options.voice } : { text }),
    });
  } catch {
    throw new ApiError(0, null, "서버에 연결할 수 없어요. 백엔드가 켜져 있는지 확인해주세요.");
  }

  if (!res.ok || !res.body) {
    const raw = await res.text().catch(() => "");
    const data = raw ? safeJson(raw) : null;
    const detail = (data as { detail?: unknown } | null)?.detail;
    throw new ApiError(res.status, detail, messageFromDetail(detail, res.status));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeEvent = (rawEvent: string) => {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of rawEvent.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) return;

    const data = safeJson(dataLines.join("\n"));
    if (eventName === "plan") {
      options.onPlan?.(data as AvatarChunkPlan);
    } else if (eventName === "chunk") {
      onChunk(data as AvatarChunkOut);
    } else if (eventName === "error") {
      const detail = (data as { detail?: unknown } | null)?.detail;
      throw new ApiError(500, detail, typeof detail === "string" ? detail : "아바타 청크 생성에 실패했어요.");
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) consumeEvent(block);
  }

  if (buffer.trim()) consumeEvent(buffer);
}
