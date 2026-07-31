export type Position = {
  x: number;
  y: number;
};

// 힌트는 백엔드가 주는 것만 쓴다: 스텝 시작 가이드(step.guide) + 미달할수록 깊어지는
// 조언 카드(task_result.advice_card). 정답은 클라이언트로 내려오지 않는다.
export type HintCardData = {
  id: string;
  title: string;
  category: string;
  description: string;
};
