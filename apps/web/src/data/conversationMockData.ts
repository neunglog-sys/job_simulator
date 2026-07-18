import type { ConversationMessage } from "../types/conversation";

export const initialConversationMessages: ConversationMessage[] = [
  {
    id: "message-1",
    role: "assistant",
    content: "안녕하세요. 어떤 일을 할 때 가장 즐겁다고 느끼나요?",
  },
  {
    id: "message-2",
    role: "user",
    content: "사람들과 이야기하면서 문제를 해결할 때 재미를 느껴요.",
  },
  {
    id: "message-3",
    role: "assistant",
    content: "혼자 집중해서 일하는 것과 여러 사람과 협업하는 것 중 어느 쪽을 더 선호하나요?",
  },
  {
    id: "message-4",
    role: "user",
    content: "여러 사람과 같이 일하는 쪽이 더 좋아요.",
  },
  {
    id: "message-5",
    role: "assistant",
    content:
      "예상하지 못한 문제가 생겼을 때는 보통 어떤 방식으로 해결하는 편인가요?\n그리고 만약 해결이 되지 않는다면 어떻게 하시나요?",
  },
  {
    id: "message-6",
    role: "assistant",
    content: "조금 더 정확한 직무 추천을 위해 간단한 설문을 진행해볼까요?",
    action: "open-survey",
  },
];
