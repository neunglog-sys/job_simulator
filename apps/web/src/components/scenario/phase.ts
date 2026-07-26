/**
 * 시나리오 게임의 진행 페이즈 — 화면이 "지금 무엇을 하는 중인지"의 단일 출처.
 *
 * 이전에는 tourActive·briefingOpen·miniGameOpen·isMissionOpen… 플래그 조합으로 상태가
 * 암묵적으로 결정돼, 뭘 하나 추가할 때마다 `!miniGameOpen && !briefingOpen && …` 조건이
 * 늘어났다. 페이즈를 명시하면 전이 규칙이 한곳에 모이고 "인사 안 하고 넘어가기" 같은
 * 빠져나갈 구멍이 구조적으로 막힌다.
 *
 * 팀장 안 5단계 매핑:
 *   1단계(사수가 데리고 다니며 인사)  → tour_intro → tour_greet → tour_reply → tour_closing
 *   2·3단계(익히고 → 퀴즈)           → briefing → mission → mission_grading → mission_result
 *                                      → coach_review
 *   4단계(실무 미니게임)              → minigame
 *   5단계(체험 소감문 — 채점 안 함)   → reflection
 *   완주                              → completed (점수는 게임에서 비공개, 최종 리포트에서만)
 */
export type GamePhase =
  | "loading"
  | "tour_opening"
  | "tour_intro"
  | "tour_greet"
  | "tour_reply"
  | "tour_closing"
  | "exploring"
  | "process_learning"
  | "briefing"
  | "mission"
  | "mission_grading"
  | "mission_result"
  | "coach_review"
  | "quest_intro"
  | "quest"
  | "quest_grading"
  | "quest_result"
  | "minigame"
  | "minigame_debrief"
  | "reflection"
  | "completed";

/** 온보딩 투어(1단계) 진행 중 — 사수가 인솔하므로 자유 이동·업무를 막는다. */
export const TOUR_PHASES: ReadonlySet<GamePhase> = new Set<GamePhase>([
  "tour_opening",
  "tour_intro",
  "tour_greet",
  "tour_reply",
  "tour_closing",
]);

/** 모달이 떠 있는 페이즈 — 맵 상호작용(배너·마커 클릭)을 막는다. */
export const MODAL_PHASES: ReadonlySet<GamePhase> = new Set<GamePhase>([
  "briefing",
  "mission",
  "mission_grading",
  "mission_result",
  "coach_review",
  "quest_intro",
  "quest",
  "quest_grading",
  "quest_result",
  "minigame",
  "reflection",
  "completed",
]);

/** 플레이어가 직접 이동할 수 있는가 — 컷신·모달 중에는 조작을 뺏지 않는다.
 *  단 tour_greet(사수 소개 후 신입이 직접 인사)은 예외 — 신입이 그 동료 옆까지 '걸어가서'
 *  인사해야 하므로 이동을 열어 준다(멀리서 인사가 성립하면 안 된다). */
export function canMove(phase: GamePhase): boolean {
  return phase === "exploring" || phase === "tour_greet";
}

/** 채팅 입력을 받는가 — 자유 대화, 그리고 투어 중 '직접 인사'(화법 평가) 때. */
export function canChat(phase: GamePhase): boolean {
  return (
    phase === "exploring" ||
    phase === "tour_greet" ||
    phase === "process_learning" ||
    phase === "minigame_debrief"
  );
}
