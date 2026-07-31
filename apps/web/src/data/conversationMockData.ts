import type { ConversationMessage } from "../types/conversation";

// 서버에 저장된 대화 이력이 없을 때(첫 상담) 보여줄 기본 인사말.
export const initialConversationMessages: ConversationMessage[] = [
  {
    id: "greeting",
    role: "assistant",
    content: "안녕하세요! 저는 AI 진로 코치예요. 어떤 일을 할 때 가장 즐겁다고 느끼나요?",
  },
];
