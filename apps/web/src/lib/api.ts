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
