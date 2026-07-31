import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SNS_POST_DESIGN_PUZZLE,
  type SnsPostDesignPuzzle,
} from "../data/snsPostDesignPuzzle";

export type PiecePlacement =
  | { location: "tray" }
  | { location: "slot"; slotId: string };

export type PuzzleArrangement = Record<string, PiecePlacement>;
export type DesignFeedback = "idle" | "incorrect" | "correct" | "saving";

export type DesignCompletionStats = {
  wrongSubmissionCount: number;
  durationMs: number;
  moveCount: number;
  undoCount: number;
  resetCount: number;
};

const INCORRECT_FEEDBACK_MS = 1200;
const INTERCHANGEABLE_SLOT_IDS = new Set([
  "slot-6",
  "slot-7",
  "slot-8",
  "slot-9",
]);
const INTERCHANGEABLE_PIECE_IDS = new Set([
  "piece-6",
  "piece-7",
  "piece-8",
  "piece-9",
]);

const cloneArrangement = (arrangement: PuzzleArrangement): PuzzleArrangement =>
  Object.fromEntries(
    Object.entries(arrangement).map(([id, placement]) => [id, { ...placement }]),
  );

const createInitialArrangement = (puzzle: SnsPostDesignPuzzle): PuzzleArrangement =>
  Object.fromEntries(puzzle.pieces.map((item) => [item.id, { location: "tray" }]));

export function pieceInSlot(
  arrangement: PuzzleArrangement,
  slotId: string,
): string | null {
  const entry = Object.entries(arrangement).find(
    ([, placement]) => placement.location === "slot" && placement.slotId === slotId,
  );
  return entry?.[0] ?? null;
}

export function isCorrectArrangement(arrangement: PuzzleArrangement): boolean {
  return SNS_POST_DESIGN_PUZZLE.slots.every((slot) => {
    const placedPieceId = pieceInSlot(arrangement, slot.id);
    if (INTERCHANGEABLE_SLOT_IDS.has(slot.id)) {
      return placedPieceId !== null && INTERCHANGEABLE_PIECE_IDS.has(placedPieceId);
    }
    return placedPieceId === slot.correctPieceId;
  });
}

export function useSnsPostDesignPuzzle() {
  const startedAtRef = useRef(Date.now());
  const submissionLockedRef = useRef(false);
  const [arrangement, setArrangement] = useState<PuzzleArrangement>(() =>
    createInitialArrangement(SNS_POST_DESIGN_PUZZLE),
  );
  const [history, setHistory] = useState<PuzzleArrangement[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [wrongSubmissionCount, setWrongSubmissionCount] = useState(0);
  const [moveCount, setMoveCount] = useState(0);
  const [undoCount, setUndoCount] = useState(0);
  const [resetCount, setResetCount] = useState(0);
  const [feedback, setFeedback] = useState<DesignFeedback>("idle");

  useEffect(() => {
    if (feedback !== "incorrect") return;
    const timer = window.setTimeout(() => {
      submissionLockedRef.current = false;
      setFeedback("idle");
    }, INCORRECT_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const slotIds = useMemo(
    () => new Set(SNS_POST_DESIGN_PUZZLE.slots.map((slot) => slot.id)),
    [],
  );

  const placePieceInSlot = useCallback(
    (pieceId: string, targetSlotId: string) => {
      if (feedback !== "idle" || !slotIds.has(targetSlotId)) return false;
      const source = arrangement[pieceId];
      if (!source || (source.location === "slot" && source.slotId === targetSlotId)) {
        return false;
      }

      const occupantId = pieceInSlot(arrangement, targetSlotId);
      const next = cloneArrangement(arrangement);
      next[pieceId] = { location: "slot", slotId: targetSlotId };
      if (occupantId && occupantId !== pieceId) {
        next[occupantId] =
          source.location === "slot"
            ? { location: "slot", slotId: source.slotId }
            : { location: "tray" };
      }

      setHistory((previous) => [...previous, cloneArrangement(arrangement)]);
      setArrangement(next);
      setMoveCount((count) => count + 1);
      setSelectedSlotId(null);
      return true;
    },
    [arrangement, feedback, slotIds],
  );

  const returnPieceToTray = useCallback(
    (pieceId: string) => {
      if (feedback !== "idle") return false;
      const source = arrangement[pieceId];
      if (!source || source.location === "tray") return false;
      const next = cloneArrangement(arrangement);
      next[pieceId] = { location: "tray" };
      setHistory((previous) => [...previous, cloneArrangement(arrangement)]);
      setArrangement(next);
      setMoveCount((count) => count + 1);
      setSelectedSlotId(null);
      return true;
    },
    [arrangement, feedback],
  );

  const selectSlot = useCallback(
    (slotId: string) => {
      if (feedback !== "idle" || !slotIds.has(slotId)) return;
      setSelectedSlotId((current) => (current === slotId ? null : slotId));
    },
    [feedback, slotIds],
  );

  const activatePiece = useCallback(
    (pieceId: string) => {
      if (feedback !== "idle") return;
      const placement = arrangement[pieceId];
      if (!placement) return;
      if (selectedSlotId) {
        if (placement.location === "slot" && placement.slotId === selectedSlotId) {
          setSelectedSlotId(null);
          return;
        }
        placePieceInSlot(pieceId, selectedSlotId);
        return;
      }
      if (placement.location === "slot") setSelectedSlotId(placement.slotId);
    },
    [arrangement, feedback, placePieceInSlot, selectedSlotId],
  );

  const reset = useCallback(() => {
    if (feedback !== "idle") return;
    setArrangement(createInitialArrangement(SNS_POST_DESIGN_PUZZLE));
    setHistory([]);
    setSelectedSlotId(null);
    setResetCount((count) => count + 1);
  }, [feedback]);

  const undo = useCallback(() => {
    if (feedback !== "idle") return;
    setHistory((previous) => {
      const snapshot = previous.at(-1);
      if (!snapshot) return previous;
      setArrangement(cloneArrangement(snapshot));
      setSelectedSlotId(null);
      setUndoCount((count) => count + 1);
      return previous.slice(0, -1);
    });
  }, [feedback]);

  const allSlotsFilled = useMemo(
    () =>
      SNS_POST_DESIGN_PUZZLE.slots.every(
        (slot) => pieceInSlot(arrangement, slot.id) !== null,
      ) &&
      Object.values(arrangement).every((placement) => placement.location === "slot"),
    [arrangement],
  );

  const submit = useCallback(():
    | { correct: false }
    | { correct: true; stats: DesignCompletionStats }
    | null => {
    if (submissionLockedRef.current || feedback !== "idle" || !allSlotsFilled) {
      return null;
    }
    submissionLockedRef.current = true;
    const correct = isCorrectArrangement(arrangement);
    if (!correct) {
      setWrongSubmissionCount((count) => count + 1);
      setFeedback("incorrect");
      return { correct: false };
    }

    setFeedback("correct");
    return {
      correct: true,
      stats: {
        wrongSubmissionCount,
        durationMs: Date.now() - startedAtRef.current,
        moveCount,
        undoCount,
        resetCount,
      },
    };
  }, [
    allSlotsFilled,
    arrangement,
    feedback,
    moveCount,
    resetCount,
    undoCount,
    wrongSubmissionCount,
  ]);

  const markSaving = useCallback(() => setFeedback("saving"), []);

  return {
    arrangement,
    selectedSlotId,
    wrongSubmissionCount,
    moveCount,
    undoCount,
    resetCount,
    feedback,
    historyLength: history.length,
    allSlotsFilled,
    canInteract: feedback === "idle",
    selectSlot,
    activatePiece,
    placePieceInSlot,
    returnPieceToTray,
    reset,
    undo,
    submit,
    markSaving,
  };
}
