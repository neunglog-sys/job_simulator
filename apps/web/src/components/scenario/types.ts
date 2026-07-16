export type Position = {
  x: number;
  y: number;
};

export type HintCardData = {
  id: string;
  title: string;
  category: string;
  description: string;
  answer?: string; // 있으면 '확인하기' 클릭 시 공개되는 정답 텍스트 (테스트용)
};
