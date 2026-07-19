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
