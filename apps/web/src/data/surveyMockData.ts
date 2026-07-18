import type { SurveyQuestionData } from "../types/survey";

export const surveyQuestions: SurveyQuestionData[] = [
  {
    id: "job-search-count",
    prompt: "최근 구직 활동을 몇 번이나 수행하셨습니까?",
    options: [
      { value: "0", label: "0회" },
      { value: "1-3", label: "1회 ~ 3회" },
      { value: "4-8", label: "4회 ~ 8회" },
      { value: "8-15", label: "8회 ~ 15회" },
      { value: "16+", label: "16회 이상" },
    ],
  },
  {
    id: "career-clarity",
    prompt: "희망하는 직무를 어느 정도 구체적으로 정하셨습니까?",
    options: [
      { value: "none", label: "아직 정하지 못했어요" },
      { value: "exploring", label: "여러 직무를 탐색하고 있어요" },
      { value: "some", label: "관심 직무가 몇 개 있어요" },
      { value: "clear", label: "희망 직무가 구체적이에요" },
      { value: "decided", label: "진로 계획까지 세웠어요" },
    ],
  },
  {
    id: "preferred-work-style",
    prompt: "어떤 방식으로 일할 때 가장 몰입이 잘 되나요?",
    options: [
      { value: "independent", label: "혼자 집중할 때 몰입이 잘 돼요" },
      { value: "small-team", label: "소규모 팀에서 협업하는 게 좋아요" },
      { value: "large-team", label: "여러 사람과 활발히 협업하고 싶어요" },
      { value: "flexible", label: "상황에 따라 유연하게 바뀌는 게 좋아요" },
      { value: "unsure", label: "아직 잘 모르겠어요" },
    ],
  },
  {
    id: "problem-solving-style",
    prompt: "문제가 생겼을 때 어떤 해결 방식을 선호하나요?",
    options: [
      { value: "analyze", label: "원인을 충분히 분석해요" },
      { value: "experiment", label: "여러 방법을 빠르게 시도해요" },
      { value: "discuss", label: "주변 사람과 의견을 나눠요" },
      { value: "reference", label: "자료와 사례를 먼저 찾아봐요" },
      { value: "mixed", label: "상황에 맞게 방법을 조합해요" },
    ],
  },
  {
    id: "career-priority",
    prompt: "직무를 선택할 때 가장 중요하게 생각하는 것은 무엇인가요?",
    options: [
      { value: "growth", label: "성장 가능성" },
      { value: "stability", label: "고용 안정성" },
      { value: "interest", label: "업무에 대한 흥미" },
      { value: "balance", label: "일과 생활의 균형" },
      { value: "reward", label: "급여와 보상" },
    ],
  },
];
