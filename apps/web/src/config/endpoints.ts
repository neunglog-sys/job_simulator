const configuredApiBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://localhost:8000";

export const API_BASE_URL = configuredApiBaseUrl.replace(/\/+$/, "");

const apiUrl = (path: string) => `${API_BASE_URL}${path}`;

export const FRONTEND_ENDPOINTS = {
  home: "/",
} as const;

export const API_ENDPOINTS = {
  docs: apiUrl("/docs"),
  health: apiUrl("/health"),
  auth: {
    signUp: apiUrl("/api/auth/signup"),
    signIn: apiUrl("/api/auth/login"),
    me: apiUrl("/api/auth/me"),
  },
  consultations: {
    list: apiUrl("/api/consultations"),
    create: apiUrl("/api/consultations"),
  },
  recommendations: {
    create: apiUrl("/api/recommendations"),
  },
} as const;

export const CLIENT_EVENTS = {
  startCareerExploration: "jobiverse:start",
} as const;
