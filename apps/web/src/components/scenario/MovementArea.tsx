import {
  Briefcase,
  ClipboardText,
  DesktopTower,
  type Icon,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type { GameMapData, GameNpc } from "../../lib/api";
import { NpcSprite, type NpcFacing } from "./NpcSprite";
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
  onNpcClick?: (npcId: string) => void; // NPC 마커 클릭 → 그 NPC와 대화
  // 온보딩 투어(컷신) — 사수가 신입을 데리고 다니는 동안 그 마커를 이 좌표로 옮긴다.
  guideNpcId?: string | null;
  guidePosition?: Position | null;
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
// 같은 spawn 자리를 쓰는 NPC들을 좌우로 벌리는 간격(px) — 맵 자리(3개)보다 인원이 많을 때.
// 투어 앵커 계산(ScenarioGamePage)도 같은 값을 써야 마커와 어긋나지 않는다.
export const SLOT_SPREAD = 92;

// 걷기 애니메이션을 끄는 NPC — step 프레임이 실제 보폭 없이 옷·골반만 뒤바뀌어
// 재생하면 파닥거려 보이는 에셋 불량 (투어 가이드 46명 중 5명). 에셋 재생성 시 제거.
const WALK_DISABLED_NPCS = new Set([
  "npc_kts-02_02",
  "npc_ms-04_01",
  "npc_ms-07_01",
  "npc_stn-04_01",
  "npc_wh-01_01",
]);

// WASD·방향키 → 이동량. 대소문자·한글 자판(ㅈㅁㄴㅇ) 모두 받는다 —
// 한글 입력 상태에서도 게임이 멈추지 않게 (event.key가 자모로 들어옴).
const MOVEMENT_KEYS: Record<string, Position> = {
  ArrowUp: { x: 0, y: -MOVE_STEP },
  w: { x: 0, y: -MOVE_STEP },
  W: { x: 0, y: -MOVE_STEP },
  ㅈ: { x: 0, y: -MOVE_STEP },
  ArrowDown: { x: 0, y: MOVE_STEP },
  s: { x: 0, y: MOVE_STEP },
  S: { x: 0, y: MOVE_STEP },
  ㄴ: { x: 0, y: MOVE_STEP },
  ArrowLeft: { x: -MOVE_STEP, y: 0 },
  a: { x: -MOVE_STEP, y: 0 },
  A: { x: -MOVE_STEP, y: 0 },
  ㅁ: { x: -MOVE_STEP, y: 0 },
  ArrowRight: { x: MOVE_STEP, y: 0 },
  d: { x: MOVE_STEP, y: 0 },
  D: { x: MOVE_STEP, y: 0 },
  ㅇ: { x: MOVE_STEP, y: 0 },
};

/** 지금 글자를 입력 중인가 — 채팅창에 타이핑할 때 캐릭터가 같이 움직이면 안 된다. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable === true;
}
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
  onNpcClick,
  guideNpcId = null,
  guidePosition = null,
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

  // 투어 중인 사수의 진행 방향 — 좌표 변화의 지배 축으로 판정해 스프라이트가 걷는 쪽을 본다.
  // ref에 이전 좌표와 함께 저장: 좌표가 실제로 바뀐 렌더에서만 갱신 (StrictMode 이중 렌더 안전).
  const guideTrack = useRef<{ pos: Position | null; facing: NpcFacing }>({
    pos: null,
    facing: "front",
  });
  if (guidePosition) {
    const prev = guideTrack.current.pos;
    if (prev && (prev.x !== guidePosition.x || prev.y !== guidePosition.y)) {
      const dx = guidePosition.x - prev.x;
      const dy = guidePosition.y - prev.y;
      guideTrack.current.facing =
        Math.abs(dx) >= Math.abs(dy)
          ? dx > 0
            ? "screen_right"
            : "screen_left"
          : dy > 0
            ? "front"
            : "back";
    }
    guideTrack.current.pos = guidePosition;
  } else {
    guideTrack.current = { pos: null, facing: "front" };
  }

  // 마커 이동은 CSS transition(900ms)이라, 좌표가 바뀔 때마다 그 시간만큼만 걷기 애니메이션을 켠다.
  const [guideWalking, setGuideWalking] = useState(false);
  useEffect(() => {
    if (!guidePosition) return;
    setGuideWalking(true);
    const timer = setTimeout(() => setGuideWalking(false), 900);
    return () => clearTimeout(timer);
  }, [guidePosition]);

  // 주인공 바라보는 방향·걷기 — 이동 delta의 지배 축으로 판정, 입력이 멎으면 220ms 뒤 idle 복귀
  // (키 리피트 간격보다 길어야 걷는 중에 끊기지 않는다)
  const [playerFacing, setPlayerFacing] = useState<NpcFacing>("front");
  const [playerWalking, setPlayerWalking] = useState(false);
  const playerWalkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notePlayerMove = useCallback((dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return;
    setPlayerFacing(
      Math.abs(dx) >= Math.abs(dy)
        ? dx > 0
          ? "screen_right"
          : "screen_left"
        : dy > 0
          ? "front"
          : "back",
    );
    setPlayerWalking(true);
    if (playerWalkTimer.current) clearTimeout(playerWalkTimer.current);
    playerWalkTimer.current = setTimeout(() => setPlayerWalking(false), 220);
  }, []);

  const npcMarkers = useMemo<NpcMarker[]>(() => {
    if (!geometry?.spawns) return [];
    const byId = new Map(geometry.spawns.map((s) => [s.id, s]));
    // 맵의 NPC 자리는 3개(teamjang/sasu/bujang)인데 시나리오 NPC는 평균 5명이라 백엔드가
    // 한 자리에 여러 명을 배정한다(순환). 예전엔 자리당 1명만 그려서 6명짜리 팀이 3명으로
    // 보였다 → 같은 자리를 쓰는 사람들을 가로로 벌려 전원을 표시한다.
    // (맵에 자리가 늘어나면 자연히 겹침이 사라진다)
    const slotMembers = new Map<string, GameNpc[]>();
    for (const npc of npcs) {
      if (!npc.spawn || !byId.has(npc.spawn)) continue;
      const list = slotMembers.get(npc.spawn);
      if (list) list.push(npc);
      else slotMembers.set(npc.spawn, [npc]);
    }

    const markers: NpcMarker[] = [];
    for (const [slot, members] of slotMembers) {
      const spot = byId.get(slot);
      if (!spot) continue;
      for (const [index, npc] of members.entries()) {
        // 같은 자리 인원은 좌우로 번갈아 벌린다: 0 → 0, 1 → +90, 2 → -90, 3 → +180 …
        const step = Math.ceil(index / 2) * SLOT_SPREAD * (index % 2 === 1 ? 1 : -1);
        // 투어 중인 사수는 자기 자리가 아니라 지금 안내하는 위치에 그린다(걸어다니는 연출).
        const touring = guideNpcId === npc.npc_id && guidePosition;
        markers.push({
          npc_id: npc.npc_id,
          name: npc.name,
          x: touring ? guidePosition.x : spot.x - origin.x + step,
          y: touring ? guidePosition.y : spot.y - origin.y,
          isActive: npc.npc_id === activeNpcId,
        });
      }
    }
    return markers;
  }, [geometry, npcs, origin, activeNpcId, guideNpcId, guidePosition]);

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

  // 최신 좌표를 ref로 들고 간다 — 키를 꾹 누르면 키 리피트가 리렌더보다 빨라서, 클로저의
  // position으로 계산하면 그 사이 입력들이 같은 낡은 좌표를 읽고 마지막 것만 남는다(이동 유실).
  const positionRef = useRef(position);
  positionRef.current = position;

  const movePlayer = useCallback(
    (deltaX: number, deltaY: number) => {
      const from = positionRef.current;
      // 축 분리 이동 — 벽에 부딪혀도 다른 축으로는 미끄러진다.
      let nextX = from.x;
      let nextY = from.y;
      const tryX = clampPosition({ x: from.x + deltaX, y: from.y });
      if (!collidesAt(tryX)) nextX = tryX.x;
      const tryY = clampPosition({ x: nextX, y: from.y + deltaY });
      if (!collidesAt(tryY)) nextY = tryY.y;
      if (nextX !== from.x || nextY !== from.y) {
        const next = { x: nextX, y: nextY };
        positionRef.current = next; // 다음 입력이 곧바로 이어지도록 즉시 반영
        onPositionChange(next);
        notePlayerMove(next.x - from.x, next.y - from.y);
      }
    },
    [clampPosition, collidesAt, onPositionChange, notePlayerMove],
  );

  // 이동 키는 window에서 받는다 — 이동영역 div에 포커스가 있어야만 동작하던 탓에
  // '맵을 한 번 클릭해야 키보드가 먹고, 채팅창에 타이핑하면 다시 먹통'이 됐다.
  // 글자 입력 중(채팅·서술형 답안)에는 무시한다.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const delta = MOVEMENT_KEYS[event.key];
      if (!delta) return;
      event.preventDefault();
      movePlayer(delta.x, delta.y);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [movePlayer]);

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
    // 클릭한 지점까지 '걸어간다' — 벽·집기를 뚫지 않되, 막혔다고 그 자리에 멈춰 서지도 않는다.
    // NPC는 책상 앞에 있어서 NPC를 누르면 목적지가 충돌 안이 되는데, 예전처럼 무시해 버리면
    // "눌러도 아무 일이 없다"가 된다(다가가려고 누른 건데). 갈 수 있는 데까지 이동한다.
    const from = positionRef.current;
    const steps = Math.max(1, Math.ceil(Math.hypot(target.x - from.x, target.y - from.y) / MOVE_STEP));
    let reachable = from;
    for (let i = 1; i <= steps; i++) {
      const point = {
        x: from.x + ((target.x - from.x) * i) / steps,
        y: from.y + ((target.y - from.y) * i) / steps,
      };
      if (collidesAt(point)) break; // 처음 막히는 지점 직전까지만
      reachable = point;
    }
    if (reachable !== from) {
      onPositionChange(reachable);
      notePlayerMove(reachable.x - from.x, reachable.y - from.y);
    }
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
      onPointerDown={handlePointerDown}
      aria-label="플레이어 이동 영역. 방향키 또는 WASD로 이동할 수 있습니다."
    >
      <div className={styles.objectLayer}>
        {geometry ? (
          npcMarkers.map((marker) => (
            <button
              className={`${styles.npcMarker} ${marker.isActive ? styles.npcMarkerActive : ""}`}
              type="button"
              key={marker.npc_id}
              style={{ left: marker.x, top: marker.y }}
              onClick={() => onNpcClick?.(marker.npc_id)}
              aria-label={`${marker.name}와 대화하기`}
            >
              {marker.isActive ? (
                <span className={styles.npcMarkerBadge} aria-hidden="true">
                  !
                </span>
              ) : null}
              <NpcSprite
                npcId={marker.npc_id}
                facing={
                  guideNpcId === marker.npc_id ? guideTrack.current.facing : "front"
                }
                walking={
                  guideNpcId === marker.npc_id &&
                  guideWalking &&
                  !WALK_DISABLED_NPCS.has(marker.npc_id)
                }
              />
              <span className={styles.npcMarkerName}>{marker.name}</span>
            </button>
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
      <PlayerSprite position={position} facing={playerFacing} walking={playerWalking} />
    </div>
  );
}
