import { useSyncExternalStore } from "react";
import * as api from "./api";

// 앱 전역 로그인 상태 스토어 (외부 스토어 → useSyncExternalStore로 구독).
// 토큰 변경은 반드시 이 모듈을 거치게 해서 상태를 단일 지점에서 관리한다.
type AuthState =
  | { status: "loading"; me: null }
  | { status: "anon"; me: null }
  | { status: "authed"; me: api.Me };

let state: AuthState = api.getToken()
  ? { status: "loading", me: null } // 토큰은 있으나 /me 확인 전
  : { status: "anon", me: null };

const listeners = new Set<() => void>();

function setState(next: AuthState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

/** 저장된 토큰으로 내 정보를 확인해 상태를 갱신. 토큰이 만료/무효면 폐기하고 익명 처리. */
async function refresh(): Promise<void> {
  if (!api.getToken()) {
    setState({ status: "anon", me: null });
    return;
  }
  try {
    const me = await api.fetchMe();
    setState({ status: "authed", me });
  } catch {
    api.setToken(null);
    setState({ status: "anon", me: null });
  }
}

/** 로그인/회원가입 실행 → 토큰 저장 → 내 정보 로드. 실패 시 ApiError를 그대로 던진다. */
export async function authenticate(
  mode: "signIn" | "signUp",
  body: { email: string; password: string; name?: string },
): Promise<void> {
  const token =
    mode === "signUp"
      ? await api.signup({ email: body.email, password: body.password, name: body.name ?? "" })
      : await api.login({ email: body.email, password: body.password });
  api.setToken(token.access_token);
  await refresh();
}

/** OAuth 리다이렉트 URL의 토큰을 저장하고, 로그인 사용자 정보를 즉시 갱신한다. */
export async function completeOAuthAuthentication(token: string): Promise<void> {
  api.setToken(token);
  await refresh();
}

export function logout(): void {
  api.setToken(null);
  setState({ status: "anon", me: null });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): AuthState {
  return state;
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// 앱 로드 시 저장된 토큰이 있으면 1회 확인.
void refresh();
