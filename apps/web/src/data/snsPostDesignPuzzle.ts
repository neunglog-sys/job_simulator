import type { MinigameDef } from "../components/scenario/minigames/types";

export type SnsPostDesignPiece = {
  id: string;
  imageSrc: string;
  alt: string;
  initialX: number;
  initialY: number;
  initialWidth: number;
  initialHeight: number;
  initialRotation: number;
  fit?: "cover" | "contain";
  objectPosition?: string;
};

export type SnsPostDesignSlot = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  borderRadius: number;
  correctPieceId: string;
  targetRotation?: number;
  zIndex?: number;
};

export type SnsPostDesignPuzzle = {
  id: string;
  instruction: string;
  sampleImageSrc: string;
  sampleImageAlt: string;
  answerReferenceSrc: string;
  pieces: SnsPostDesignPiece[];
  slots: SnsPostDesignSlot[];
};

export const SNS_POST_DESIGN_LAYOUT = {
  designWidth: 1920,
  designHeight: 880,
  monitor: { x: 287.5, y: 37.5, width: 1365, height: 626 },
  sample: { x: 317, y: 123, width: 260, height: 325 },
  board: { x: 675, y: 65, width: 570, height: 569 },
  reset: { x: 320, y: 494, width: 54, height: 54 },
  undo: { x: 392, y: 494, width: 54, height: 54 },
  sampleZoom: { x: 464, y: 494, width: 54, height: 54 },
  submit: { x: 320, y: 576, width: 158, height: 54 },
  tray: { x: 1248, y: 54, width: 394, height: 590 },
} as const;

const asset = (path: string) =>
  `${import.meta.env.BASE_URL}assets/minigames/sns-post-design/${path}`;

const piece = (
  index: number,
  alt: string,
  initialX: number,
  initialY: number,
  initialWidth: number,
  initialHeight: number,
): SnsPostDesignPiece => ({
  id: `piece-${index}`,
  imageSrc: asset(`pieces/piece-${String(index).padStart(2, "0")}.webp`),
  alt,
  initialX,
  initialY,
  initialWidth,
  initialHeight,
  initialRotation: 0,
  fit: "contain",
  objectPosition: "center",
});

export const SNS_POST_DESIGN_PUZZLE: SnsPostDesignPuzzle = {
  id: "sns-post-design-main",
  instruction:
    "샘플을 참고하여 진로 시뮬레이터 플랫폼을 홍보하는 게시물 이미지를 완성해 주세요.",
  sampleImageSrc: asset("sample.webp"),
  sampleImageAlt: "완성 구조를 참고할 수 있는 제주 여행 홍보 게시물 샘플",
  answerReferenceSrc: asset("answer-reference.webp"),
  pieces: [
    piece(1, "CAREER AI 브랜드 로고 요소", 1264, 593, 138, 40),
    piece(2, "진로 탐색 손글씨 문구 요소", 1360, 529, 259, 57),
    piece(3, "AI 아바타 진로 탐색 제목 요소", 1459, 132, 166, 67),
    piece(4, "진로 시뮬레이터 소개 본문 요소", 1271, 345, 225, 70),
    piece(5, "AI 아바타 상담 장면 이미지 요소", 1282, 140, 131, 189),
    piece(6, "AI 아바타 상담 특징 요소", 1536, 216, 83, 70),
    piece(7, "맞춤 직무 추천 특징 요소", 1522, 314, 111, 113),
    piece(8, "가상 직무 체험 특징 요소", 1431, 219, 89, 84),
    piece(9, "역량 분석 리포트 특징 요소", 1383, 431, 88, 92),
    piece(10, "서비스 정보와 시작하기 버튼 요소", 1301, 64, 326, 52),
  ],
  slots: [
    {
      id: "slot-1",
      x: 33.5,
      y: 16.5,
      width: 234,
      height: 68,
      borderRadius: 5,
      correctPieceId: "piece-1",
    },
    {
      id: "slot-2",
      x: 33.5,
      y: 104.5,
      width: 235,
      height: 58,
      borderRadius: 5,
      correctPieceId: "piece-2",
    },
    {
      id: "slot-3",
      x: 33.5,
      y: 187.5,
      width: 262,
      height: 105,
      borderRadius: 5,
      correctPieceId: "piece-3",
    },
    {
      id: "slot-4",
      x: 315.5,
      y: 16.5,
      width: 232,
      height: 345,
      borderRadius: 5,
      correctPieceId: "piece-5",
      zIndex: 1,
    },
    {
      id: "slot-5",
      x: 33.5,
      y: 303.5,
      width: 202,
      height: 62,
      borderRadius: 5,
      correctPieceId: "piece-4",
    },
    {
      id: "slot-6",
      x: 33.5,
      y: 376.5,
      width: 118,
      height: 99,
      borderRadius: 5,
      correctPieceId: "piece-6",
    },
    {
      id: "slot-7",
      x: 165.5,
      y: 376.5,
      width: 118,
      height: 99,
      borderRadius: 5,
      correctPieceId: "piece-7",
    },
    {
      id: "slot-8",
      x: 297.5,
      y: 376.5,
      width: 118,
      height: 99,
      borderRadius: 5,
      correctPieceId: "piece-8",
    },
    {
      id: "slot-9",
      x: 429.5,
      y: 376.5,
      width: 118,
      height: 99,
      borderRadius: 5,
      correctPieceId: "piece-9",
    },
    {
      id: "slot-10",
      x: 33.5,
      y: 482.5,
      width: 514,
      height: 67,
      borderRadius: 5,
      correctPieceId: "piece-10",
    },
  ],
};

function validatePuzzle(puzzle: SnsPostDesignPuzzle): void {
  if (puzzle.pieces.length !== 10) {
    throw new Error("SNS 시안 제작 미니게임은 정확히 10개 조각이 필요합니다.");
  }
  if (puzzle.slots.length !== 10) {
    throw new Error("SNS 시안 제작 미니게임은 정확히 10개 슬롯이 필요합니다.");
  }

  const pieceIds = new Set(puzzle.pieces.map((item) => item.id));
  const slotIds = new Set(puzzle.slots.map((item) => item.id));
  const correctPieceIds = puzzle.slots.map((item) => item.correctPieceId);
  if (pieceIds.size !== puzzle.pieces.length) {
    throw new Error("SNS 시안 제작 조각 ID가 중복되었습니다.");
  }
  if (slotIds.size !== puzzle.slots.length) {
    throw new Error("SNS 시안 제작 슬롯 ID가 중복되었습니다.");
  }
  if (new Set(correctPieceIds).size !== correctPieceIds.length) {
    throw new Error("하나의 조각이 여러 슬롯의 정답으로 지정되었습니다.");
  }
  correctPieceIds.forEach((id) => {
    if (!pieceIds.has(id)) throw new Error(`존재하지 않는 정답 조각 ID: ${id}`);
  });
  pieceIds.forEach((id) => {
    if (!correctPieceIds.includes(id)) throw new Error(`정답 슬롯이 없는 조각 ID: ${id}`);
  });
  puzzle.pieces.forEach((item) => {
    if (!item.imageSrc) throw new Error(`${item.id}: 조각 이미지 경로가 없습니다.`);
  });
  if (!puzzle.sampleImageSrc) throw new Error("시안 샘플 이미지 경로가 없습니다.");
}

validatePuzzle(SNS_POST_DESIGN_PUZZLE);

export const SNS_POST_DESIGN_PREVIEW_GAME: MinigameDef = {
  id: "sns-01-design",
  engine: "design",
  title: "게시물 시안 제작",
  intro: SNS_POST_DESIGN_PUZZLE.instruction,
  time_limit: null,
  pass_score: 70,
  data: {
    presentation: "sns_post_design",
    background_id: "sns-01-background-duck-cartoon-monitor-v4",
    auto_complete: true,
  },
  scoring: {},
};
