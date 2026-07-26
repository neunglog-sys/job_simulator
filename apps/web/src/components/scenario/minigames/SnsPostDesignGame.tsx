import {
  ArrowCounterClockwise,
  ArrowUUpLeft,
  MagnifyingGlassPlus,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  SNS_POST_DESIGN_LAYOUT,
  SNS_POST_DESIGN_PUZZLE,
  type SnsPostDesignPiece,
} from "../../../data/snsPostDesignPuzzle";
import {
  pieceInSlot,
  useSnsPostDesignPuzzle,
} from "../../../hooks/useSnsPostDesignPuzzle";
import styles from "../../../styles/snsPostDesignGame.module.css";
import type { EngineProps } from "./shared";

const CLEAR_DISPLAY_MS = 850;
const SAMPLE_ZOOM_MS = 3000;
const DRAG_THRESHOLD = 5;

type DragState = {
  pieceId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

type PointerStart = {
  pieceId: string;
  clientX: number;
  clientY: number;
  moved: boolean;
};

const { designWidth, designHeight, monitor, sample, board, reset, undo, sampleZoom, submit, tray } =
  SNS_POST_DESIGN_LAYOUT;

const monitorPosition = (box: { x: number; y: number; width: number; height: number }) => ({
  left: box.x - monitor.x,
  top: box.y - monitor.y,
  width: box.width,
  height: box.height,
});

export function SnsPostDesignGame({ game, onComplete }: EngineProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointerStartRef = useRef<PointerStart | null>(null);
  const suppressClickRef = useRef<string | null>(null);
  const completionStartedRef = useRef(false);
  const completionTimerRef = useRef<number | null>(null);
  const sampleTimerRef = useRef<number | null>(null);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  const [scale, setScale] = useState(1);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [sampleZoomOpen, setSampleZoomOpen] = useState(false);
  const puzzle = useSnsPostDesignPuzzle();

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateScale = () => {
      setScale(
        Math.min(viewport.clientWidth / designWidth, viewport.clientHeight / designHeight),
      );
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current);
      }
      if (sampleTimerRef.current !== null) window.clearTimeout(sampleTimerRef.current);
    },
    [],
  );

  const toDesignPoint = useCallback((clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const renderedScale = rect.width / designWidth;
    return {
      x: (clientX - rect.left) / renderedScale,
      y: (clientY - rect.top) / renderedScale,
    };
  }, []);

  const visualSizeFor = useCallback(
    (piece: SnsPostDesignPiece) => {
      const placement = puzzle.arrangement[piece.id];
      if (placement?.location === "slot") {
        const slot = SNS_POST_DESIGN_PUZZLE.slots.find(
          (item) => item.id === placement.slotId,
        );
        if (slot) {
          return {
            width: slot.width,
            height: slot.height,
            rotation: slot.targetRotation ?? 0,
          };
        }
      }
      return {
        width: piece.initialWidth,
        height: piece.initialHeight,
        rotation: piece.initialRotation,
      };
    },
    [puzzle.arrangement],
  );

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    piece: SnsPostDesignPiece,
  ) => {
    if (!puzzle.canInteract) return;
    pointerStartRef.current = {
      pieceId: piece.id,
      clientX: event.clientX,
      clientY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
    piece: SnsPostDesignPiece,
  ) => {
    const start = pointerStartRef.current;
    if (!start || start.pieceId !== piece.id) return;
    const distance = Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY);
    if (!start.moved && distance < DRAG_THRESHOLD) return;
    start.moved = true;
    event.preventDefault();
    const point = toDesignPoint(event.clientX, event.clientY);
    if (!point) return;
    const size = visualSizeFor(piece);
    setDragging({
      pieceId: piece.id,
      x: point.x - size.width / 2,
      y: point.y - size.height / 2,
      ...size,
    });
  };

  const finishDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    piece: SnsPostDesignPiece,
    cancelled = false,
  ) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || start.pieceId !== piece.id || !start.moved) {
      setDragging(null);
      return;
    }

    suppressClickRef.current = piece.id;
    window.setTimeout(() => {
      if (suppressClickRef.current === piece.id) suppressClickRef.current = null;
    }, 0);

    if (!cancelled) {
      const point = toDesignPoint(event.clientX, event.clientY);
      if (point) {
        const targetSlot = SNS_POST_DESIGN_PUZZLE.slots.find(
          (slot) =>
            point.x >= board.x + slot.x &&
            point.x <= board.x + slot.x + slot.width &&
            point.y >= board.y + slot.y &&
            point.y <= board.y + slot.y + slot.height,
        );
        if (targetSlot) {
          puzzle.placePieceInSlot(piece.id, targetSlot.id);
        } else if (
          point.x >= tray.x &&
          point.x <= tray.x + tray.width &&
          point.y >= tray.y &&
          point.y <= tray.y + tray.height
        ) {
          puzzle.returnPieceToTray(piece.id);
        }
      }
    }
    setDragging(null);
  };

  const handlePieceClick = (pieceId: string) => {
    if (suppressClickRef.current === pieceId) return;
    puzzle.activatePiece(pieceId);
  };

  const openSampleZoom = () => {
    if (!puzzle.canInteract) return;
    if (sampleTimerRef.current !== null) window.clearTimeout(sampleTimerRef.current);
    setSampleZoomOpen(true);
    sampleTimerRef.current = window.setTimeout(() => {
      setSampleZoomOpen(false);
      sampleTimerRef.current = null;
    }, SAMPLE_ZOOM_MS);
  };

  const handleSubmit = () => {
    const outcome = puzzle.submit();
    if (!outcome?.correct || completionStartedRef.current) return;
    completionStartedRef.current = true;
    completionTimerRef.current = window.setTimeout(() => {
      puzzle.markSaving();
      completeRef.current({
        completed: true,
        time_seconds: Math.round(outcome.stats.durationMs / 1000),
        mistakes: outcome.stats.wrongSubmissionCount,
        metadata: {
          gameId: "sns-post-design",
          completed: true,
          wrongSubmissionCount: outcome.stats.wrongSubmissionCount,
          completedAt: new Date().toISOString(),
          durationMs: outcome.stats.durationMs,
          moveCount: outcome.stats.moveCount,
          undoCount: outcome.stats.undoCount,
          resetCount: outcome.stats.resetCount,
        },
      });
    }, CLEAR_DISPLAY_MS);
  };

  const stageStyle = { "--sns-design-scale": scale } as CSSProperties;
  const backgroundImage =
    `${import.meta.env.BASE_URL}assets/minigames/backgrounds/cartoon-day-v3/` +
    "sns-01-background-duck-cartoon-monitor-v4.webp";
  const interactionLocked = !puzzle.canInteract;

  return (
    <div
      ref={viewportRef}
      className={styles.viewport}
      aria-label={`${game.title}, 진로 시뮬레이터 홍보 게시물 시안 제작`}
    >
      <div ref={stageRef} className={styles.stage} style={stageStyle}>
        <img className={styles.background} src={backgroundImage} alt="" draggable={false} />

        <div
          className={styles.monitor}
          style={{ left: monitor.x, top: monitor.y, width: monitor.width, height: monitor.height }}
        >
          <div className={styles.sampleLabel}>샘플</div>
          <div className={styles.sample} style={monitorPosition(sample)}>
            <img
              src={SNS_POST_DESIGN_PUZZLE.sampleImageSrc}
              alt={SNS_POST_DESIGN_PUZZLE.sampleImageAlt}
              draggable={false}
            />
          </div>

          <div
            className={`${styles.board} ${
              puzzle.feedback === "incorrect" ? styles.boardIncorrect : ""
            }`}
            style={monitorPosition(board)}
          >
            {SNS_POST_DESIGN_PUZZLE.slots.map((slot, index) => {
              const occupantId = pieceInSlot(puzzle.arrangement, slot.id);
              const occupant = SNS_POST_DESIGN_PUZZLE.pieces.find(
                (item) => item.id === occupantId,
              );
              const selected = puzzle.selectedSlotId === slot.id;
              return (
                <div
                  key={slot.id}
                  className={styles.slotLayer}
                  style={{
                    left: slot.x,
                    top: slot.y,
                    width: slot.width,
                    height: slot.height,
                    zIndex: slot.zIndex ?? 2,
                  }}
                >
                  <button
                    className={styles.slot}
                    type="button"
                    aria-pressed={selected}
                    aria-label={`제작판 위치 ${index + 1}, ${
                      occupant ? "요소 배치됨" : "비어 있음"
                    }`}
                    disabled={interactionLocked}
                    data-selected={selected ? "true" : undefined}
                    data-occupied={occupant ? "true" : undefined}
                    onClick={() => puzzle.selectSlot(slot.id)}
                    style={{ borderRadius: slot.borderRadius }}
                  />
                  {occupant ? (
                    <button
                      className={styles.placedPiece}
                      type="button"
                      aria-label={`${occupant.alt}, 제작판 위치 ${index + 1}에 배치됨`}
                      disabled={interactionLocked}
                      data-dragged={dragging?.pieceId === occupant.id ? "true" : undefined}
                      onClick={() => handlePieceClick(occupant.id)}
                      onPointerDown={(event) => handlePointerDown(event, occupant)}
                      onPointerMove={(event) => handlePointerMove(event, occupant)}
                      onPointerUp={(event) => finishDrag(event, occupant)}
                      onPointerCancel={(event) => finishDrag(event, occupant, true)}
                      style={{
                        borderRadius: slot.borderRadius,
                        transform: `rotate(${slot.targetRotation ?? 0}deg)`,
                      }}
                    >
                      <img
                        src={occupant.imageSrc}
                        alt=""
                        draggable={false}
                        style={{
                          objectFit: occupant.fit ?? "contain",
                          objectPosition: occupant.objectPosition ?? "center",
                        }}
                      />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>

          {SNS_POST_DESIGN_PUZZLE.pieces.map((piece) => {
            if (puzzle.arrangement[piece.id]?.location !== "tray") return null;
            return (
              <button
                key={piece.id}
                className={styles.trayPiece}
                type="button"
                aria-label={`${piece.alt}, 요소 목록에 있음${
                  puzzle.selectedSlotId ? ", 선택한 제작판 위치에 배치" : ""
                }`}
                disabled={interactionLocked}
                data-dragged={dragging?.pieceId === piece.id ? "true" : undefined}
                onClick={() => handlePieceClick(piece.id)}
                onPointerDown={(event) => handlePointerDown(event, piece)}
                onPointerMove={(event) => handlePointerMove(event, piece)}
                onPointerUp={(event) => finishDrag(event, piece)}
                onPointerCancel={(event) => finishDrag(event, piece, true)}
                style={{
                  left: piece.initialX - monitor.x,
                  top: piece.initialY - monitor.y,
                  width: piece.initialWidth,
                  height: piece.initialHeight,
                  transform: `rotate(${piece.initialRotation}deg)`,
                }}
              >
                <img
                  src={piece.imageSrc}
                  alt=""
                  draggable={false}
                  style={{
                    objectFit: piece.fit ?? "contain",
                    objectPosition: piece.objectPosition ?? "center",
                  }}
                />
              </button>
            );
          })}

          <button
            className={styles.control}
            type="button"
            aria-label="전체 배치 초기화"
            title="전체 초기화"
            disabled={interactionLocked}
            style={monitorPosition(reset)}
            onClick={puzzle.reset}
          >
            <ArrowCounterClockwise weight="bold" aria-hidden="true" />
          </button>
          <button
            className={styles.control}
            type="button"
            aria-label="마지막 배치 한 단계 되돌리기"
            title="한 단계 되돌리기"
            disabled={interactionLocked || puzzle.historyLength === 0}
            style={monitorPosition(undo)}
            onClick={puzzle.undo}
          >
            <ArrowUUpLeft weight="bold" aria-hidden="true" />
          </button>
          <button
            className={styles.control}
            type="button"
            aria-label="완성 샘플 크게 보기"
            title="샘플 크게 보기"
            disabled={interactionLocked}
            style={monitorPosition(sampleZoom)}
            onClick={openSampleZoom}
          >
            <MagnifyingGlassPlus weight="bold" aria-hidden="true" />
          </button>

          <button
            className={styles.submit}
            type="button"
            aria-label="완성 시안 제출하기"
            disabled={!puzzle.allSlotsFilled || interactionLocked}
            style={monitorPosition(submit)}
            onClick={handleSubmit}
          >
            제출하기
          </button>

          {dragging ? (
            <div
              className={styles.dragGhost}
              style={{
                left: dragging.x - monitor.x,
                top: dragging.y - monitor.y,
                width: dragging.width,
                height: dragging.height,
                transform: `rotate(${dragging.rotation}deg)`,
              }}
              aria-hidden="true"
            >
              <img
                src={
                  SNS_POST_DESIGN_PUZZLE.pieces.find(
                    (item) => item.id === dragging.pieceId,
                  )?.imageSrc
                }
                alt=""
                draggable={false}
              />
            </div>
          ) : null}

          {puzzle.feedback === "incorrect" ? (
            <div className={styles.feedbackIncorrect} role="status" aria-live="polite">
              샘플과 다른 부분이 있어요. 배치를 다시 확인해 보세요!
            </div>
          ) : null}
          {puzzle.feedback === "correct" || puzzle.feedback === "saving" ? (
            <div className={styles.feedbackClear} role="status" aria-live="polite">
              {puzzle.feedback === "saving" ? "저장 중..." : "Clear!"}
            </div>
          ) : null}

          {sampleZoomOpen ? (
            <div className={styles.sampleZoomOverlay} role="dialog" aria-label="완성 샘플 크게 보기">
              <img
                src={SNS_POST_DESIGN_PUZZLE.sampleImageSrc}
                alt={SNS_POST_DESIGN_PUZZLE.sampleImageAlt}
                draggable={false}
              />
              <span>3초 후 자동으로 닫힙니다</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
