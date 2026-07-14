export const LANDING_COPY = {
  brand: "직무 아카데미아",
  intro: {
    eyebrow: "AI 아바타 직무 시뮬레이션",
    title: "나에게 맞는 일,\n설명보다 경험으로",
    description:
      "설문부터 직무 추천, 가상 미션, 최종 리포트까지 한 번의 여정으로 만나보세요.",
  },
  final: {
    eyebrow: "경험으로 발견하는 나의 직무",
    title: "직무를 고르기 전,\n하루를 살아보세요",
    description:
      "AI 아바타가 직무를 추천하고, 가상 회사의 미션과 대화로 나의 적성을 분석해요.",
  },
  actions: {
    signUp: "회원가입",
    signIn: "로그인",
    launch: "직무 우주로 출발하기",
    getStarted: "직무 탐색 시작하기",
    replay: "다시 보기",
  },
} as const;

// 실제 사용자 아바타로 교체할 때 public 경로만 변경하세요.
export const AVATAR_IMAGE: string | null = "/assets/career-explorer.png";
