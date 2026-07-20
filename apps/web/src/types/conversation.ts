import type { Recommendation, Report } from "../lib/api";

export type ConversationRole = "assistant" | "user";

export type ConversationMessage = {
  id: string;
  role: ConversationRole;
  content: string;
  createdAt?: string;
  action?: "open-survey";
};

export type AvatarStatus = "idle" | "listening" | "thinking" | "speaking";

export type RecordingState = "idle" | "requesting" | "recording" | "processing";

export type ActiveConversationPanel = "chat" | "survey" | "report";

export type NavigationMenuId =
  | "conversation-list"
  | "new-consultation"
  | "virtual-company"
  | "recommended-jobs"
  | "final-report";

// 최종 리포트 생성 상태 — recommendation → report(비동기) 순으로 진행.
export type ReportPhase = "idle" | "loading" | "ready" | "needs-more-chat" | "error";

export type ReportState = {
  phase: ReportPhase;
  recommendation: Recommendation | null;
  report: Report | null;
  message: string | null;
  followupQuestions: string[];
};

export const INITIAL_REPORT_STATE: ReportState = {
  phase: "idle",
  recommendation: null,
  report: null,
  message: null,
  followupQuestions: [],
};
