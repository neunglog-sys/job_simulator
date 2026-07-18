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
  avatar: {
    // 아바타 사용 가능 여부. Colab 세션이 안 떠 있으면 enabled=false → idle 루프만 재생.
    status: apiUrl("/api/avatar/status"),
    // 발화 텍스트 → HLS 재생목록 URL. 영상 세그먼트는 브라우저가 GPU 서버에서 직접 받아간다
    // (백엔드를 안 거침). 첫 URL까지 약 7초 — 그동안 프론트는 thinking 상태 유지.
    speak: apiUrl("/api/avatar/speak"),
  },
} as const;

// idle 루프 영상 — SoulX가 발화와 동일한 설정(av6_2 512x512 / lite / seed 123)으로 만든 것.
// 핑퐁(정+역)이라 시작=끝 → 루프 이음새 없음. 오디오 트랙 없음.
export const AVATAR_IDLE_SRC = "/avatar-idle.mp4";

// 게임 WebSocket URL — 로그인 토큰이 있으면 쿼리로 실어 보낸다 (없으면 데모 사용자).
export const wsSimulation = (id: number, token?: string | null) =>
  `${WS_BASE_URL}/ws/simulations/${id}${token ? `?token=${encodeURIComponent(token)}` : ""}`;

export const CLIENT_EVENTS = {
  startCareerExploration: "jobiverse:start",
} as const;
