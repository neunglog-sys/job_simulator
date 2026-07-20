const configuredApiBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://localhost:8000";

export const API_BASE_URL = configuredApiBaseUrl.replace(/\/+$/, "");

const apiUrl = (path: string) => `${API_BASE_URL}${path}`;

// WebSocket은 헤더를 못 실어서 토큰을 쿼리로 붙인다 (백엔드 규약).
export const WS_BASE_URL = API_BASE_URL.replace(/^http/, "ws");

export const FRONTEND_ENDPOINTS = {
  home: "/",
  conversation: "/conversation", // AI 상담 화면
  scenario: "/scenario", // 시나리오 게임 화면
} as const;

export const API_ENDPOINTS = {
  docs: apiUrl("/docs"),
  health: apiUrl("/health"),
  auth: {
    signUp: apiUrl("/api/auth/signup"),
    signIn: apiUrl("/api/auth/login"),
    me: apiUrl("/api/auth/me"),
    oauth: {
      google: apiUrl("/api/auth/oauth/google"),
      kakao: apiUrl("/api/auth/oauth/kakao"),
      naver: apiUrl("/api/auth/oauth/naver"),
    },
  },
  consultations: {
    list: apiUrl("/api/consultations"),
    create: apiUrl("/api/consultations"),
    survey: (id: number) => apiUrl(`/api/consultations/${id}/survey`),
    messages: (id: number) => apiUrl(`/api/consultations/${id}/messages`),
  },
  recommendations: {
    latest: (consultationId: number) =>
      apiUrl(`/api/recommendations?consultation_id=${consultationId}`),
    create: apiUrl("/api/recommendations"),
  },
  scenarios: {
    list: apiUrl("/api/scenarios"),
  },
  simulations: {
    list: apiUrl("/api/simulations"),
    create: apiUrl("/api/simulations"),
    detail: (id: number) => apiUrl(`/api/simulations/${id}`),
    score: (id: number) => apiUrl(`/api/simulations/${id}/score`),
    finish: (id: number) => apiUrl(`/api/simulations/${id}/finish`),
  },
  reports: {
    list: apiUrl("/api/reports"),
    create: apiUrl("/api/reports"),
    detail: (id: number) => apiUrl(`/api/reports/${id}`),
    pdf: (id: number) => apiUrl(`/api/reports/${id}/pdf`),
  },
  tts: apiUrl("/api/tts"),
} as const;

// 게임 WebSocket URL — 로그인 토큰이 있으면 쿼리로 실어 보낸다 (없으면 데모 사용자).
export const wsSimulation = (id: number, token?: string | null) =>
  `${WS_BASE_URL}/ws/simulations/${id}${token ? `?token=${encodeURIComponent(token)}` : ""}`;

export const CLIENT_EVENTS = {
  startCareerExploration: "jobiverse:start",
} as const;
