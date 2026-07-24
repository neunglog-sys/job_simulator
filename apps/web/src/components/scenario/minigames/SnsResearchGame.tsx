import { useEffect, useReducer, useRef, useState, type CSSProperties } from "react";
import { SNS_RESEARCH_STAGES } from "../../../data/snsResearchStages";
import styles from "../../../styles/snsResearchGame.module.css";
import type { EngineProps } from "./shared";

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 880;
const CLEAR_DISPLAY_MS = 900;
const INCORRECT_FEEDBACK_MS = 1000;
const MONITOR = { x: 286.5, y: 37.5, width: 1366, height: 626 } as const;

const CARD_LAYOUTS = [
  { left: 316, top: 152, width: 247.388, height: 461.041 },
  { left: 580, top: 151.795, width: 247.388, height: 461.041 },
  { left: 844, top: 151.795, width: 248.091, height: 461.041 },
  { left: 1109, top: 151.795, width: 247.388, height: 461.041 },
  { left: 1373, top: 151.795, width: 247.388, height: 461.041 },
] as const;

type GameState = {
  stageIndex: number;
  selected: Set<string>;
  stageWrongAttempts: number[];
  totalWrongAttempts: number;
  locked: boolean;
  clear: boolean;
  incorrectFeedback: boolean;
};

type GameAction =
  | { type: "toggle"; cardId: string }
  | { type: "reset-after-incorrect" }
  | { type: "advance" };

const initialState = (): GameState => ({
  stageIndex: 0,
  selected: new Set(),
  stageWrongAttempts: Array(SNS_RESEARCH_STAGES.length).fill(0),
  totalWrongAttempts: 0,
  locked: false,
  clear: false,
  incorrectFeedback: false,
});

function isClear(stageIndex: number, selected: Set<string>): boolean {
  const stage = SNS_RESEARCH_STAGES[stageIndex];
  const allCorrectSelected = stage.correctCardIds.every((id) => selected.has(id));
  const hasIncorrectSelected = [...selected].some((id) => !stage.correctCardIds.includes(id));
  return allCorrectSelected && !hasIncorrectSelected;
}

function reducer(state: GameState, action: GameAction): GameState {
  if (action.type === "advance") {
    return {
      ...state,
      stageIndex: state.stageIndex + 1,
      selected: new Set(),
      locked: false,
      clear: false,
      incorrectFeedback: false,
    };
  }
  if (action.type === "reset-after-incorrect") {
    return {
      ...state,
      selected: new Set(),
      locked: false,
      clear: false,
      incorrectFeedback: false,
    };
  }
  if (state.locked) return state;

  const stage = SNS_RESEARCH_STAGES[state.stageIndex];
  const selected = new Set(state.selected);
  let totalWrongAttempts = state.totalWrongAttempts;
  const stageWrongAttempts = [...state.stageWrongAttempts];

  if (selected.has(action.cardId)) {
    selected.delete(action.cardId);
  } else {
    selected.add(action.cardId);
    if (!stage.correctCardIds.includes(action.cardId)) {
      totalWrongAttempts += 1;
      stageWrongAttempts[state.stageIndex] += 1;
      return {
        ...state,
        selected,
        totalWrongAttempts,
        stageWrongAttempts,
        locked: true,
        clear: false,
        incorrectFeedback: true,
      };
    }
  }

  const clear = isClear(state.stageIndex, selected);
  return {
    ...state,
    selected,
    totalWrongAttempts,
    stageWrongAttempts,
    locked: clear,
    clear,
    incorrectFeedback: false,
  };
}

export function SnsResearchGame({ game, onComplete }: EngineProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const startedAtRef = useRef(Date.now());
  const completionStartedRef = useRef(false);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const [scale, setScale] = useState(1);
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const stage = SNS_RESEARCH_STAGES[state.stageIndex];

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateScale = () => {
      setScale(Math.min(viewport.clientWidth / DESIGN_WIDTH, viewport.clientHeight / DESIGN_HEIGHT));
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!state.incorrectFeedback) return;
    const timer = window.setTimeout(() => {
      dispatch({ type: "reset-after-incorrect" });
    }, INCORRECT_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [state.incorrectFeedback]);

  useEffect(() => {
    if (!state.clear) return;
    const timer = window.setTimeout(() => {
      if (state.stageIndex < SNS_RESEARCH_STAGES.length - 1) {
        dispatch({ type: "advance" });
        return;
      }
      if (completionStartedRef.current) return;
      completionStartedRef.current = true;
      completeRef.current({
        completed: true,
        time_seconds: Math.round((Date.now() - startedAtRef.current) / 1000),
        mistakes: state.totalWrongAttempts,
        metadata: {
          gameId: "sns-content-research",
          completed: true,
          totalStages: SNS_RESEARCH_STAGES.length,
          clearedStages: SNS_RESEARCH_STAGES.length,
          totalWrongAttempts: state.totalWrongAttempts,
          stageResults: SNS_RESEARCH_STAGES.map((item, index) => ({
            stageId: item.id,
            stageIndex: index,
            keyword: item.keyword,
            wrongAttempts: state.stageWrongAttempts[index],
            completed: true,
          })),
          completedAt: new Date().toISOString(),
        },
      });
    }, CLEAR_DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    state.clear,
    state.stageIndex,
    state.stageWrongAttempts,
    state.totalWrongAttempts,
  ]);

  const backgroundImage =
    `${import.meta.env.BASE_URL}assets/minigames/backgrounds/cartoon-day-v3/` +
    "sns-01-background-duck-cartoon-monitor-v4.webp";
  const stageStyle = { "--sns-research-scale": scale } as CSSProperties;

  return (
    <div
      ref={viewportRef}
      className={styles.viewport}
      aria-label={`${game.title}, ${state.stageIndex + 1}단계`}
    >
      <div className={styles.stage} style={stageStyle}>
        <img className={styles.background} src={backgroundImage} alt="" draggable={false} />
        <div
          className={styles.monitor}
          style={{
            left: MONITOR.x,
            top: MONITOR.y,
            width: MONITOR.width,
            height: MONITOR.height,
          }}
        >
          <div className={styles.keyword}>
            <span className={styles.keywordLabel}>Keyword :</span>
            <span>{stage.keyword}</span>
          </div>

          {stage.cards.map((item, index) => {
            const selected = state.selected.has(item.id);
            const correct = stage.correctCardIds.includes(item.id);
            const layout = CARD_LAYOUTS[index];
            const selectionState = selected ? (correct ? "correct" : "incorrect") : "none";
            return (
              <button
                key={item.id}
                className={styles.card}
                type="button"
                aria-pressed={selected}
                aria-label={`${item.alt}${selected ? ", 선택됨" : ""}`}
                disabled={state.locked}
                data-selection-state={selectionState}
                style={{
                  left: layout.left - MONITOR.x,
                  top: layout.top - MONITOR.y,
                  width: layout.width,
                  height: layout.height,
                }}
                onClick={() => dispatch({ type: "toggle", cardId: item.id })}
              >
                <img
                  className={styles.cardImage}
                  src={item.imageSrc}
                  alt={item.alt}
                  draggable={false}
                  style={{
                    objectFit: item.fit ?? "cover",
                    objectPosition: item.objectPosition ?? "center",
                    transform:
                      item.offsetY !== undefined
                        ? `translateY(${item.offsetY}px) scale(1.16)`
                        : undefined,
                    transformOrigin: item.objectPosition?.startsWith("left")
                      ? "left center"
                      : item.objectPosition?.endsWith("top")
                        ? "center top"
                      : "center",
                  }}
                />
              </button>
            );
          })}

          {state.clear ? (
            <div className={styles.clear} role="status" aria-live="polite">
              Clear!
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
