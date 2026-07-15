export type ConversationRole = "assistant" | "user";

export type ConversationMessage = {
  id: string;
  role: ConversationRole;
  content: string;
  createdAt?: string;
};

export type AvatarStatus = "idle" | "listening" | "thinking" | "speaking";

export type RecordingState = "idle" | "requesting" | "recording" | "processing";
