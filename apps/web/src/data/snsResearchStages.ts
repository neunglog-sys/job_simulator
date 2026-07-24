import type { MinigameDef } from "../components/scenario/minigames/types";

export type SnsResearchCard = {
  id: string;
  imageSrc: string;
  alt: string;
  fit?: "cover" | "contain";
  objectPosition?: string;
  offsetY?: number;
};

export type SnsResearchStage = {
  id: string;
  keyword: string;
  cards: [
    SnsResearchCard,
    SnsResearchCard,
    SnsResearchCard,
    SnsResearchCard,
    SnsResearchCard,
  ];
  correctCardIds: string[];
};

const asset = (folder: string, file: string) =>
  `${import.meta.env.BASE_URL}assets/minigames/sns-research/${folder}/${file}.webp`;

const card = (
  stage: string,
  index: number,
  folder: string,
  file: string,
  keyword: string,
  objectPosition?: string,
  offsetY?: number,
): SnsResearchCard => ({
  id: `${stage}-card-${index}`,
  imageSrc: asset(folder, file),
  alt: `${keyword} 키워드의 후보 자료 ${index}`,
  objectPosition,
  offsetY,
});

export const SNS_RESEARCH_STAGES: SnsResearchStage[] = [
  {
    id: "stage-1",
    keyword: "10대, 남자, 게임",
    cards: [
      card("stage-1", 1, "teen-male-game", "incorrect-01", "10대 남성 게임"),
      card("stage-1", 2, "teen-male-game", "correct-01", "10대 남성 게임"),
      card("stage-1", 3, "teen-male-game", "correct-02", "10대 남성 게임"),
      card("stage-1", 4, "teen-male-game", "incorrect-02", "10대 남성 게임"),
      card("stage-1", 5, "teen-male-game", "correct-03", "10대 남성 게임"),
    ],
    correctCardIds: ["stage-1-card-2", "stage-1-card-3", "stage-1-card-5"],
  },
  {
    id: "stage-2",
    keyword: "20대, 남자, 뷰티",
    cards: [
      card("stage-2", 1, "twenties-male-beauty", "correct-01", "20대 남성 뷰티", "left center"),
      card("stage-2", 2, "twenties-male-beauty", "incorrect-01", "20대 남성 뷰티", "left center"),
      card("stage-2", 3, "twenties-male-beauty", "incorrect-02", "20대 남성 뷰티", "left center"),
      card("stage-2", 4, "twenties-male-beauty", "correct-02", "20대 남성 뷰티", "left center"),
      card("stage-2", 5, "twenties-male-beauty", "incorrect-03", "20대 남성 뷰티", "left center"),
    ],
    correctCardIds: ["stage-2-card-1", "stage-2-card-4"],
  },
  {
    id: "stage-3",
    keyword: "20대, 여자, 음식",
    cards: [
      card("stage-3", 1, "twenties-female-food", "incorrect-01", "20대 여성 음식", "left center"),
      card("stage-3", 2, "twenties-female-food", "correct-01", "20대 여성 음식", "left center"),
      card("stage-3", 3, "twenties-female-food", "incorrect-02", "20대 여성 음식"),
      card("stage-3", 4, "twenties-female-food", "correct-02", "20대 여성 음식", "left center"),
      card("stage-3", 5, "twenties-female-food", "incorrect-03", "20대 여성 음식"),
    ],
    correctCardIds: ["stage-3-card-2", "stage-3-card-4"],
  },
  {
    id: "stage-4",
    keyword: "30대, 여자, 스포츠",
    cards: [
      card("stage-4", 1, "thirties-female-sports", "correct-01", "30대 여성 스포츠", "center top", -30),
      card("stage-4", 2, "thirties-female-sports", "incorrect-01", "30대 여성 스포츠", "left center"),
      card("stage-4", 3, "thirties-female-sports", "incorrect-02", "30대 여성 스포츠"),
      card("stage-4", 4, "thirties-female-sports", "correct-02", "30대 여성 스포츠", "center top", -30),
      card("stage-4", 5, "thirties-female-sports", "incorrect-03", "30대 여성 스포츠"),
    ],
    correctCardIds: ["stage-4-card-1", "stage-4-card-4"],
  },
  {
    id: "stage-5",
    keyword: "40대, 남자, 패션",
    cards: [
      card("stage-5", 1, "forties-male-fashion", "incorrect-01", "40대 남성 패션", "left center"),
      card("stage-5", 2, "forties-male-fashion", "correct-01", "40대 남성 패션", "left center"),
      card("stage-5", 3, "forties-male-fashion", "correct-02", "40대 남성 패션", "left center"),
      card("stage-5", 4, "forties-male-fashion", "incorrect-02", "40대 남성 패션", "left center"),
      card("stage-5", 5, "forties-male-fashion", "correct-03", "40대 남성 패션"),
    ],
    correctCardIds: ["stage-5-card-2", "stage-5-card-3", "stage-5-card-5"],
  },
];

function validateStages(stages: SnsResearchStage[]): void {
  if (stages.length !== 5) {
    throw new Error("SNS 자료 수집 미니게임은 정확히 5개 스테이지가 필요합니다.");
  }

  const stageIds = new Set<string>();
  const allCardIds = new Set<string>();
  stages.forEach((stage) => {
    if (stageIds.has(stage.id)) throw new Error(`${stage.id}: 스테이지 ID가 중복되었습니다.`);
    stageIds.add(stage.id);
    if (stage.cards.length !== 5) throw new Error(`${stage.id}: 카드가 정확히 5개여야 합니다.`);
    if (![2, 3].includes(stage.correctCardIds.length)) {
      throw new Error(`${stage.id}: 정답은 2개 또는 3개여야 합니다.`);
    }
    const stageCardIds = new Set(stage.cards.map((item) => item.id));
    if (stageCardIds.size !== stage.cards.length) {
      throw new Error(`${stage.id}: 카드 ID가 중복되었습니다.`);
    }
    stage.cards.forEach((item) => {
      if (allCardIds.has(item.id)) throw new Error(`${item.id}: 전체 카드 ID가 중복되었습니다.`);
      allCardIds.add(item.id);
    });
    stage.correctCardIds.forEach((id) => {
      if (!stageCardIds.has(id)) throw new Error(`${stage.id}: 존재하지 않는 정답 카드 ID ${id}`);
    });
  });
}

validateStages(SNS_RESEARCH_STAGES);

export const SNS_RESEARCH_PREVIEW_GAME: MinigameDef = {
  id: "sns-01-research",
  engine: "research",
  title: "콘텐츠·SNS 자료 수집",
  intro: "키워드에 적합한 자료를 모두 선택하세요.",
  time_limit: null,
  pass_score: 70,
  data: {
    background_id: "sns-01-background-duck-cartoon-monitor-v4",
    auto_complete: true,
  },
  scoring: {},
};
