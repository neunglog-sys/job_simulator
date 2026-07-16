import {
  Briefcase,
  ClipboardText,
  DesktopTower,
  UserCircle,
  type Icon,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { GameMapData, GameNpc } from "../../lib/api";
import { PlayerSprite, PLAYER_SIZE } from "./PlayerSprite";
import type { Position } from "./types";
import styles from "../../styles/scenarioGame.module.css";

type MovementAreaProps = {
  position: Position;
  onPositionChange: (position: Position) => void;
  onCoachMessage: (message: string) => void;
  // 백엔드 맵 geometry (TMX에서 추출된 walkable·collision·spawns). 있으면 이동 판정·NPC 배치에 사용.
  geometry?: GameMapData["geometry"] | null;
  npcs?: GameNpc[];
  activeNpcId?: string | null; // 현재 미션 담당 NPC — 마커를 그 이름으로 강조
};

type GameObject = {
  id: string;
  label: string;
  className: string;
  icon: Icon;
  message: string;
};

type Rect = { x: number; y: number; w: number; h: number };
type NpcMarker = { npc_id: string; name: string; x: number; y: number; isActive: boolean };

const MOVE_STEP = 18;
// 충돌은 스프라이트 전체가 아니라 발밑 영역으로 판정 — 벽에 자연스럽게 붙는다.
const FOOT_WIDTH = 46;
const FOOT_HEIGHT = 26;

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
  geometry = null,
  npcs = [],
  activeNpcId = null,
}: MovementAreaProps) {
  const areaRef = useRef<HTMLDivElement>(null);

  // geometry 좌표계(스테이지 1920×1080)의 원점 = walkable 영역의 좌상단. movementArea 로컬좌표 = (x-origin).
  const origin = useMemo(() => {
    const base = geometry?.walkable?.[0];
    return { x: base?.x ?? 0, y: base?.y ?? 0 };
  }, [geometry]);

  const collisions = useMemo<Rect[]>(() => {
    if (!geometry?.collision) return [];
    return geometry.collision.map((c) => ({
      x: c.x - origin.x,
      y: c.y - origin.y,
      w: c.w,
      h: c.h,
    }));
  }, [geometry, origin]);

  const npcMarkers = useMemo<NpcMarker[]>(() => {
    if (!geometry?.spawns) return [];
    const byId = new Map(geometry.spawns.map((s) => [s.id, s]));
    // 시나리오 NPC가 spawn 자리보다 많으면 백엔드가 한 자리에 여러 명을 배정한다(순환).
    // 자리당 1명만 표시하되, 현재 미션 담당 NPC가 그 자리에 있으면 그를 대표로(정확한 이름·강조).
    const bySlot = new Map<string, GameNpc>();
    for (const npc of npcs) {
      if (!npc.spawn || !byId.has(npc.spawn)) continue;
      const existing = bySlot.get(npc.spawn);
      if (!existing || npc.npc_id === activeNpcId) bySlot.set(npc.spawn, npc);
    }
    const markers: NpcMarker[] = [];
    for (const [slot, npc] of bySlot) {
      const spot = byId.get(slot);
      if (spot) {
        markers.push({
          npc_id: npc.npc_id,
          name: npc.name,
          x: spot.x - origin.x,
          y: spot.y - origin.y,
          isActive: npc.npc_id === activeNpcId,
        });
      }
    }
    return markers;
  }, [geometry, npcs, origin, activeNpcId]);

  const collidesAt = useCallback(
    (pos: Position) => {
      if (collisions.length === 0) return false;
      const footX = pos.x + (PLAYER_SIZE.width - FOOT_WIDTH) / 2;
      const footY = pos.y + PLAYER_SIZE.height - FOOT_HEIGHT;
      return collisions.some(
        (c) =>
          footX < c.x + c.w &&
          footX + FOOT_WIDTH > c.x &&
          footY < c.y + c.h &&
          footY + FOOT_HEIGHT > c.y,
      );
    },
    [collisions],
  );

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
      // 축 분리 이동 — 벽에 부딪혀도 다른 축으로는 미끄러진다.
      let nextX = position.x;
      let nextY = position.y;
      const tryX = clampPosition({ x: position.x + deltaX, y: position.y });
      if (!collidesAt(tryX)) nextX = tryX.x;
      const tryY = clampPosition({ x: nextX, y: position.y + deltaY });
      if (!collidesAt(tryY)) nextY = tryY.y;
      if (nextX !== position.x || nextY !== position.y) {
        onPositionChange({ x: nextX, y: nextY });
      }
    },
    [clampPosition, collidesAt, onPositionChange, position.x, position.y],
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

    const target = clampPosition({
      x: (event.clientX - bounds.left) * scaleX - PLAYER_SIZE.width / 2,
      y: (event.clientY - bounds.top) * scaleY - PLAYER_SIZE.height / 2,
    });
    // 마우스 클릭 이동은 tile 충돌을 무시하고 자유 이동 (키보드 이동만 충돌 판정 유지).
    onPositionChange(target);
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
        {geometry ? (
          npcMarkers.map((marker) => (
            <div
              className={`${styles.npcMarker} ${marker.isActive ? styles.npcMarkerActive : ""}`}
              key={marker.npc_id}
              style={{ left: marker.x, top: marker.y }}
            >
              {marker.isActive ? (
                <span className={styles.npcMarkerBadge} aria-hidden="true">
                  !
                </span>
              ) : null}
              <span className={styles.npcMarkerAvatar} aria-hidden="true">
                <UserCircle weight="duotone" />
              </span>
              <span className={styles.npcMarkerName}>{marker.name}</span>
            </div>
          ))
        ) : (
          GAME_OBJECTS.map((object) => {
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
          })
        )}
      </div>
      <PlayerSprite position={position} />
    </div>
  );
}
