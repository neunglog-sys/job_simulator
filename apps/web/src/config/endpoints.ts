// 배포/프로덕션: VITE_API_BASE_URL을 비워 두면 API_BASE_URL이 빈 문자열이 되고,
// 브라우저는 /api·/ws 를 **현재 오리진**으로 호출한다 → nginx가 api:8000으로 동일오리진
// 프록시(apps/web/nginx.conf)하므로 CORS가 아예 없고, 터널 주소 변경에도 안 묶인다.
// 로컬 vite dev 서버(5173)에서만 api를 별도 오리진(localhost:8000)으로 직접 호출한다.
const configuredApiBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.trim() ||
  (import.meta.env.DEV ? "http://localhost:8000" : "");

export const API_BASE_URL = configuredApiBaseUrl.replace(/\/+$/, "");

const apiUrl = (path: string) => `${API_BASE_URL}${path}`;

// WebSocket은 헤더를 못 실어서 토큰을 쿼리로 붙인다 (백엔드 규약).
// API_BASE_URL이 비어(상대경로) 있으면 절대 ws URL을 만들 수 없으므로 현재 페이지 오리진에서 유도한다.
export const WS_BASE_URL = API_BASE_URL
  ? API_BASE_URL.replace(/^http/, "ws")
  : typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`
    : "";

export const FRONTEND_ENDPOINTS = {
  home: "/",
  conversation: "/conversation", // AI 상담 화면
  scenario: "/scenario", // 시나리오 게임 화면
  myPage: "/mypage", // 내 정보·개인 문서 보관함
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
  profile: {
    account: apiUrl("/api/profile/account"),
    policyProfile: apiUrl("/api/profile/policy-profile"),
    password: apiUrl("/api/profile/password"),
    avatar: apiUrl("/api/profile/avatar"),
    documents: apiUrl("/api/profile/documents"),
    document: (id: number) => apiUrl(`/api/profile/documents/${id}`),
    download: (id: number) => apiUrl(`/api/profile/documents/${id}/download`),
  },
  policies: {
    card: apiUrl("/api/policies/card"),
  },
  consultations: {
    list: apiUrl("/api/consultations"),
    create: apiUrl("/api/consultations"),
    detail: (id: number) => apiUrl(`/api/consultations/${id}`),
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
  avatar: {
    // 아바타 사용 가능 여부. Colab 세션이 안 떠 있으면 enabled=false → idle 루프만 재생.
    status: apiUrl("/api/avatar/status"),
    // 발화 텍스트 → 백엔드가 재봉합한 연속 fragmented MP4 스트림 URL.
    // 첫 URL까지 약 7초 — 그동안 프론트는 thinking 상태 유지.
    speak: apiUrl("/api/avatar/speak"),
    // 긴 답변을 문장 단위로 나눠 각 MP4 스트림 URL을 SSE로 순차 전달.
    speakChunks: apiUrl("/api/avatar/speak-chunks"),
    ws: (token?: string | null) =>
      `${WS_BASE_URL}/api/avatar/ws${token ? `?token=${encodeURIComponent(token)}` : ""}`,
    // 아바타 모델 콜드스타트 완화용 워밍업 트리거 — 백엔드 준비 전까지는 404/네트워크 실패를
    // 조용히 무시한다 (warmupAvatar 참고). 실제 스펙 확정되면 경로만 맞추면 됨.
    warmup: apiUrl("/api/avatar/warmup"),
  },
} as const;

// idle 루프 영상 — MuseTalk 발화 영상과 같은 720p 기준으로 맞춘 driving/idle/idle_02.mp4 변환본.
export const AVATAR_IDLE_SRC = "/avatar-idle-720p.mp4";

// 게임 WebSocket URL — 로그인 토큰이 있으면 쿼리로 실어 보낸다 (없으면 데모 사용자).
export const wsSimulation = (id: number, token?: string | null) =>
  `${WS_BASE_URL}/ws/simulations/${id}${token ? `?token=${encodeURIComponent(token)}` : ""}`;

export const CLIENT_EVENTS = {
  startCareerExploration: "jobiverse:start",
} as const;
