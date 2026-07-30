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
  if (options.body != null && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
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
export type Me = {
  id: number;
  email: string | null;
  name: string;
  has_password: boolean;
  gender: "male" | "female" | null; // 게임 주인공 스프라이트 성별 배선용 (미설정 시 null)
};
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

export type UserDocumentKind = "resume" | "portfolio" | "other";
export type UserDocument = {
  id: number;
  kind: UserDocumentKind;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

export type PolicyProfileGender = "male" | "female";
export type PolicyProfile = {
  birth_year: number | null;
  gender: PolicyProfileGender | null;
  region_ctpv: string | null;
  region_sgg: string | null;
  has_disability: boolean | null;
  sensitive_agreed_at: string | null;
};
export type PolicyProfileUpdate = Partial<{
  birth_year: number | null;
  gender: PolicyProfileGender | null;
  region_ctpv: string | null;
  region_sgg: string | null;
  has_disability: boolean | null;
  sensitive_agreed: boolean;
}>;

export type SimulationSummary = {
  id: number;
  scenario_slug: string;
  scenario_title: string;
  module: string | null;
  status: "active" | "completed" | "aborted";
  current_step: string | null;
  total: number | null;
  created_at: string;
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

export function updateProfileAccount(name: string): Promise<Me> {
  return request(API_ENDPOINTS.profile.account, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function fetchPolicyProfile(): Promise<PolicyProfile> {
  return request(API_ENDPOINTS.profile.policyProfile, { method: "GET" });
}

export function updatePolicyProfile(body: PolicyProfileUpdate): Promise<PolicyProfile> {
  return request(API_ENDPOINTS.profile.policyProfile, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function changeProfilePassword(currentPassword: string, newPassword: string): Promise<void> {
  return request(API_ENDPOINTS.profile.password, {
    method: "PUT",
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
}

export async function fetchProfileAvatar(): Promise<Blob | null> {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(API_ENDPOINTS.profile.avatar, { headers });
  } catch {
    throw new ApiError(0, null, "프로필 이미지 서버에 연결할 수 없어요.");
  }

  // 204 = 등록된 이미지 없음(정상). 404는 이 엔드포인트가 404를 쓰던 시절 배포본 호환.
  if (response.status === 204 || response.status === 404) return null;
  if (!response.ok) {
    const raw = await response.text();
    const data = raw ? safeJson(raw) : null;
    const detail = (data as { detail?: unknown } | null)?.detail;
    throw new ApiError(response.status, detail, messageFromDetail(detail, response.status));
  }
  return response.blob();
}

export function uploadProfileAvatar(file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  return request(API_ENDPOINTS.profile.avatar, { method: "POST", body: form });
}

export function fetchProfileDocuments(): Promise<UserDocument[]> {
  return request(API_ENDPOINTS.profile.documents, { method: "GET" });
}

export function uploadProfileDocument(
  kind: UserDocumentKind,
  file: File,
): Promise<UserDocument> {
  const form = new FormData();
  form.append("kind", kind);
  form.append("file", file);
  return request(API_ENDPOINTS.profile.documents, { method: "POST", body: form });
}

export function deleteProfileDocument(documentId: number): Promise<void> {
  return request(API_ENDPOINTS.profile.document(documentId), { method: "DELETE" });
}

export async function downloadProfileDocument(documentId: number): Promise<Blob> {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(API_ENDPOINTS.profile.download(documentId), { headers });
  } catch {
    throw new ApiError(0, null, "문서 서버에 연결할 수 없어요.");
  }

  if (!response.ok) {
    const raw = await response.text();
    const data = raw ? safeJson(raw) : null;
    const detail = (data as { detail?: unknown } | null)?.detail;
    throw new ApiError(response.status, detail, messageFromDetail(detail, response.status));
  }
  return response.blob();
}

// --- 아바타 워밍업 — 콜드스타트(최초 발화 시 UNet forward + ffmpeg 첫 실행, ~23초) 완화용.
// 회원가입/로그인/직무 탐색 시작 등 진입 초입 트리거에서 미리 한 번 쏴 둔다. 세션당 1회만
// 보내면 되므로 여러 트리거가 겹쳐 호출해도 무시(dedup). 백엔드 엔드포인트가 아직 없을 수
// 있어 실패(404/네트워크 오류)는 조용히 삼킨다 — 실패해도 사용자 흐름엔 영향 없어야 한다.
let avatarWarmupSent = false;

export function warmupAvatar(): void {
  if (avatarWarmupSent) return;
  avatarWarmupSent = true;

  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);

  fetch(API_ENDPOINTS.avatar.warmup, { method: "POST", headers }).catch(() => {
    /* 워밍업 실패는 무시 — 실제 대화 흐름에서 정상적으로 콜드스타트가 발생할 뿐 */
  });
}

// --- 맞춤 제도 카드 — 백엔드가 정부 API에서 조건에 맞는 제도를 찾아 문구까지 만들어 준다.
// available=false면 카드를 감춘다(키 미설정·조건에 맞는 제도 없음·생성 실패).
export type PolicyCard = {
  available: boolean;
  reason?: "not_configured" | "no_match";
  /** 사용자 만 나이 — 정부 API가 죽어 고정 목록을 쓸 때 연령으로 걸러내는 데 쓴다.
   *  프로필에 생년이 없으면 null. */
  age?: number | null;
  title?: string;
  body?: string;
  more_url?: string;
  /** 본문이 실제로 언급한 제도 — 백엔드가 후보와 대조해 검증한 것만 담긴다. */
  // 백엔드(policy/service.py·providers.py)는 name·summary·provider·link 4개를 내려준다.
  // summary·provider가 빠져 있어 YouthPolicyModal의 접근이 TS2339로 빌드를 깨뜨렸다(배포 실패).
  // 값이 없을 때 빈 문자열이 오므로 optional로 둔다.
  cited?: PolicyCardItem[];
  /** 본문에는 없지만 '더 알아보기'에서 함께 보여줄 제도 — 이것도 후보와 대조해 검증된 것만. */
  more?: PolicyCardItem[];
  source_count?: number;
};

export type PolicyCardItem = {
  name: string;
  summary?: string;
  provider?: string;
  link: string;
};

export function fetchPolicyCard(): Promise<PolicyCard> {
  return request(API_ENDPOINTS.policies.card, { method: "GET" });
}

export function createConsultation(): Promise<Consultation> {
  return request(API_ENDPOINTS.consultations.create, { method: "POST" });
}

/** 마이페이지에 저장해 둔 이력서를 상담에 자동 연결(B안). 저장된 이력서가 없거나 분석이
 * 실패해도 attached=false로 조용히 넘어가므로, 상담 시작을 막지 않는 fire-and-forget용이다. */
export function attachStoredResume(
  consultationId: number,
): Promise<{ attached: boolean }> {
  return request(API_ENDPOINTS.consultations.resumeFromStorage(consultationId), {
    method: "POST",
  });
}

export function fetchConsultations(): Promise<ConsultationSummary[]> {
  return request(API_ENDPOINTS.consultations.list, { method: "GET" });
}

export function fetchSimulationSummaries(): Promise<SimulationSummary[]> {
  return request(API_ENDPOINTS.simulations.list, { method: "GET" });
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

export function fetchSurveyItems(
  consultationId: number,
): Promise<{ items: SurveyItem[]; completed: boolean }> {
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
// education_requirement/salary는 조사 안 된 직무가 대부분이라 값 자체가 null이거나
// note만 채워진 채로 오는 경우가 흔함 — 렌더링 시 value/median_annual_krw 존재 여부로 판단.
export type JobEducationRequirement = {
  value: string | null;
  source_field?: string;
  evidence_type?: string;
  note?: string;
};

export type JobSalary = {
  entry_level?: { min_krw: number | null; max_krw: number | null };
  reference_statistics?: {
    median_annual_krw?: number;
    statistic_type?: string;
    population?: string;
    reference_year?: number;
  } | null;
  note?: string;
};

export type JobCertification = {
  name: string;
  tier: string;
};

/** 개인화 근거 — 상담에서 검증된 실제 발화 인용. 근거가 없으면 null(생략). */
export type RecommendationEvidence = {
  quote: string;
  dimension_name: string;
  confidence: number;
};

export type JobRecommendation = {
  job_code: string;
  job_title: string;
  description: string | null;
  score: number;
  reason: string;
  education_requirement: JobEducationRequirement | null;
  salary: JobSalary | null;
  certifications: JobCertification[];
  scenario_slug: string | null;
  // F 직무군 세부직업(조사 자료) — 이 필드 도입 전 스냅샷(과거 추천)엔 없다
  detail_jobs?: string[];
  evidence?: RecommendationEvidence | null;
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
  // 상담만 반영된 결과(consult)인지, 상담+체험 수행이 합쳐진 최종 리포트(experience)인지 —
  // 백엔드가 simulation_id 유무로 판단해 내려준다 (services/api/app/domains/reporting/schemas.py).
  kind: "consult" | "experience";
  kind_label: string;
  fit_score: number | null;
  strengths: string[];
  improvements: string[];
  advice: string | null;
  created_at: string;
};

export function fetchReports(): Promise<Report[]> {
  return request(API_ENDPOINTS.reports.list, { method: "GET" });
}

/** 리포트 생성은 백엔드에서 비동기 처리 — status가 done/failed 될 때까지 fetchReport로 폴링.
 * simulationId를 주면 완주한 체험이 최종 적합도에 50% 반영된다(팀 확정 공식). */
export function createReport(consultationId: number, simulationId?: number): Promise<Report> {
  return request(API_ENDPOINTS.reports.create, {
    method: "POST",
    body: JSON.stringify({ consultation_id: consultationId, simulation_id: simulationId ?? null }),
  });
}

export function fetchReport(reportId: number): Promise<Report> {
  return request(API_ENDPOINTS.reports.detail(reportId));
}

/** PDF는 바이너리라 request()의 JSON 파싱을 못 타므로 별도 처리 — 인증 헤더는 동일하게 싣는다. */
export async function fetchReportPdfBlob(reportId: number): Promise<Blob> {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(API_ENDPOINTS.reports.pdf(reportId), { headers });
  } catch {
    throw new ApiError(0, null, "서버에 연결할 수 없어요. 백엔드가 켜져 있는지 확인해주세요.");
  }
  if (!res.ok) {
    const detail = safeJson(await res.text()) as { detail?: unknown } | null;
    throw new ApiError(res.status, detail?.detail, messageFromDetail(detail?.detail, res.status));
  }
  return res.blob();
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
export type GameActivity = {
  kind: "minigame" | "debrief";
  game_id?: string | null;
  label: string;
  briefing?: string[];
  prompt?: string | null;
  completion_message?: string | null;
};
export type GameStep = {
  id: string;
  title: string;
  mission: string;
  npcs: string[]; // npc_id 목록 (표시정보는 Simulation.npcs에서 조회)
  guide: string | null;
  // 제공자료 본문 — guide가 이름만 나열하는 것과 달리, 실제로 대조할 수 있는 문서다.
  // 시뮬레이션마다 세트가 하나 정해져 내려온다(세트별로 정답이 다르다). 없으면 빈 배열.
  materials: Array<{ title: string; body: string }>;
  // 사수가 업무 시작 전에 알려주는 절차 — 브리핑 창 + 업무 노트에 표시.
  // 정답 키(task.answer)는 서버가 내려주지 않으므로, 들은 절차를 섞인 보기와 맞추는 건 사용자 몫.
  briefing: string[];
  choices: Array<Record<string, unknown>>;
  task: GameTask | null;
  activity: GameActivity | null;
};
export type GameNpc = {
  npc_id: string;
  name: string;
  role: string;
  rank: string | null;
  spawn: string | null; // 맵 geometry.spawns의 자리 id (teamjang|sasu|bujang)
};
export type GameSpawn = { id: string; x: number; y: number };
// 하드코딩된 NPC 안내 경로 — 사수 역할 NPC가 스폰 지점에서 안내 지점까지 한 번 리드하고,
// 플레이어가 일정 시간 안 따라오면 말을 건다(팀 결정, 2026-07-23 갱신).
// 좌표는 collision 배열을 실측 검증해 정한 안전 지점 (find_patrol_points 스크립트).
export type GameNpcPath = {
  npc_id: string;
  points: Array<{ x: number; y: number }>;
  speed?: number; // px/초
  pause_ms?: number; // 각 지점 도착 후 대기 시간
  prompt?: string; // 플레이어가 안 따라올 때 사수가 건네는 대사
  nudge_radius?: number; // 이 반경(px) 밖이면 안 따라온 것으로 판단
  nudge_interval_ms?: number; // 넛지 재확인 주기
  nudge_max?: number; // 넛지 최대 반복 횟수(그 이상은 조용히 대기)
};
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
    npc_paths?: GameNpcPath[];
    // 손님 NPC가 자유롭게 돌아다닐 영역(스테이지 좌표) — 없으면 스폰 주변으로 제한.
    // 와인바 안쪽·창고를 벗어난 매장 플로어만 담는다.
    roam_area?: { x: number; y: number; w: number; h: number };
    // true면 손님뿐 아니라 (가이드/순찰 NPC를 뺀) 모든 NPC가 로밍한다 — 손님 구분이 없는
    // 오피스형 시나리오(sns-01)처럼 전원이 돌아다녀야 하는 맵용. 기본은 손님만.
    roam_all?: boolean;
    [key: string]: unknown;
  };
};
export type Simulation = {
  id: number;
  consultation_id: number | null; // 이 체험을 시작한 상담 — 재개 시 리포트 연동 복원용
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
  minigames: MinigameDef[]; // 다중 게임 시 순서대로 실행. 단일 게임은 1개짜리 목록.
  // 미션 스킵 버튼 노출 여부. 서버 설정(allow_skip_step)과 같은 값이라 프론트가 따로
  // 판단하지 않는다 — 기본 false이므로 시연·운영에서는 버튼이 뜨지 않는다.
  allow_skip: boolean;
  created_at: string;
};

export function createSimulation(
  scenarioSlug: string,
  consultationId?: number | null,
): Promise<Simulation> {
  // consultationId를 실어보내면 서버가 DB에 박아둔다 → 이어하기로 재개해도 리포트 연동 유지.
  return request(API_ENDPOINTS.simulations.create, {
    method: "POST",
    body: JSON.stringify(
      consultationId != null
        ? { scenario_slug: scenarioSlug, consultation_id: consultationId }
        : { scenario_slug: scenarioSlug },
    ),
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
  /** 남/여 아바타 선택. 미지정 시 서버 기본(male)로 진행. */
  avatar_id?: "male" | "female";
  gesture_index?: number;
  /** 한 답변을 묶는 식별자. 문장 단위로 쪼개진 청크들이 같은 값을 공유한다. */
  session_id?: string;
  /** 이 답변 안에서의 **재생 순번**(0부터).
   *
   * 서버는 이 번호로 줄을 세워 앞 청크가 끝난 프레임에서 이어붙인다.
   * 도착 순서·TTS 완료 순서는 재생 순서와 다르기 때문에 반드시 명시해야 한다
   * (짧은 문장이 TTS를 먼저 끝내 추론 순서가 뒤집힌다). */
  seq?: number;
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
      socket.send(
        JSON.stringify({ speaker_id: "coach", avatar_id: "male", emotion: "neutral", ...request })
      );
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
export function speakAvatar(
  text: string,
  voice?: string,
  avatarId?: "male" | "female",
): Promise<AvatarSpeakOut> {
  return request(API_ENDPOINTS.avatar.speak, {
    method: "POST",
    body: JSON.stringify({
      text,
      ...(voice ? { voice } : {}),
      ...(avatarId ? { avatar_id: avatarId } : {}),
    }),
  });
}

export async function streamAvatarSpeakChunks(
  text: string,
  onChunk: (chunk: AvatarChunkOut) => void,
  options: {
    voice?: string;
    avatarId?: "male" | "female";
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
      body: JSON.stringify({
        text,
        ...(options.voice ? { voice: options.voice } : {}),
        ...(options.avatarId ? { avatar_id: options.avatarId } : {}),
      }),
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
