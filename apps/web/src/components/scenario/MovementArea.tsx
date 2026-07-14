import {
  Briefcase,
  ClipboardText,
  DesktopTower,
  type Icon,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { PlayerSprite, PLAYER_SIZE } from "./PlayerSprite";
import type { Position } from "./types";
import styles from "../../styles/scenarioGame.module.css";

type MovementAreaProps = {
  position: Position;
  onPositionChange: (position: Position) => void;
  onCoachMessage: (message: string) => void;
};

type GameObject = {
  id: string;
  label: string;
  className: string;
  icon: Icon;
  message: string;
};

const MOVE_STEP = 18;

const GAME_OBJECTS: GameObject[] = [
  {
    id: "brief",
    label: "업무 브리핑 확인",
    className: styles.objectBrief,
    icon: ClipboardText,
    message: "브리핑을 확인했어요. 먼저 요청의 우선순위와 완료 조건을 정리해볼까요?",
  },
  {
    id: "workstation",
    label: "업무 시스템 열기",
    className: styles.objectWorkstation,
    icon: DesktopTower,
    message: "업무 시스템이 준비됐어요. 처리 전 고객 정보와 최근 이력을 먼저 확인하세요.",
  },
  {
    id: "archive",
    label: "자료 보관함 살펴보기",
    className: styles.objectArchive,
    icon: Briefcase,
    message: "관련 자료를 찾았어요. 비슷한 사례의 해결 순서를 참고할 수 있습니다.",
  },
];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function MovementArea({
  position,
  onPositionChange,
  onCoachMessage,
}: MovementAreaProps) {
  const areaRef = useRef<HTMLDivElement>(null);

  const clampPosition = useCallback((nextPosition: Position) => {
    const area = areaRef.current;
    if (!area) return nextPosition;

    return {
      x: clamp(nextPosition.x, 0, area.clientWidth - PLAYER_SIZE.width),
      y: clamp(nextPosition.y, 0, area.clientHeight - PLAYER_SIZE.height),
    };
  }, []);

  const movePlayer = useCallback(
    (deltaX: number, deltaY: number) => {
      onPositionChange(
        clampPosition({
          x: position.x + deltaX,
          y: position.y + deltaY,
        }),
      );
    },
    [clampPosition, onPositionChange, position.x, position.y],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const movementKeys: Record<string, Position> = {
      ArrowUp: { x: 0, y: -MOVE_STEP },
      w: { x: 0, y: -MOVE_STEP },
      W: { x: 0, y: -MOVE_STEP },
      ArrowDown: { x: 0, y: MOVE_STEP },
      s: { x: 0, y: MOVE_STEP },
      S: { x: 0, y: MOVE_STEP },
      ArrowLeft: { x: -MOVE_STEP, y: 0 },
      a: { x: -MOVE_STEP, y: 0 },
      A: { x: -MOVE_STEP, y: 0 },
      ArrowRight: { x: MOVE_STEP, y: 0 },
      d: { x: MOVE_STEP, y: 0 },
      D: { x: MOVE_STEP, y: 0 },
    };
    const delta = movementKeys[event.key];
    if (!delta) return;
    event.preventDefault();
    movePlayer(delta.x, delta.y);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("button")) return;
    const bounds = areaRef.current?.getBoundingClientRect();
    const area = areaRef.current;
    if (!bounds || !area) return;
    const scaleX = area.clientWidth / bounds.width;
    const scaleY = area.clientHeight / bounds.height;

    onPositionChange(
      clampPosition({
        x: (event.clientX - bounds.left) * scaleX - PLAYER_SIZE.width / 2,
        y: (event.clientY - bounds.top) * scaleY - PLAYER_SIZE.height / 2,
      }),
    );
    areaRef.current?.focus();
  };

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;

    const resizeObserver = new ResizeObserver(() => {
      const nextPosition = clampPosition(position);
      if (nextPosition.x !== position.x || nextPosition.y !== position.y) {
        onPositionChange(nextPosition);
      }
    });
    resizeObserver.observe(area);
    return () => resizeObserver.disconnect();
  }, [clampPosition, onPositionChange, position]);

  return (
    <div
      ref={areaRef}
      className={styles.movementArea}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      aria-label="플레이어 이동 영역. 방향키 또는 WASD로 이동할 수 있습니다."
    >
      <div className={styles.objectLayer}>
        {GAME_OBJECTS.map((object) => {
          const ObjectIcon = object.icon;
          return (
            <button
              className={`${styles.gameObject} ${object.className}`}
              type="button"
              key={object.id}
              onClick={() => onCoachMessage(object.message)}
              aria-label={object.label}
            >
              <ObjectIcon weight="duotone" aria-hidden="true" />
              <span>{object.label}</span>
            </button>
          );
        })}
      </div>
      <PlayerSprite position={position} />
    </div>
  );
}
