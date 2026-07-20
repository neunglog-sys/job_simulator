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
import { NPC_FRAME, NpcSprite, type NpcFacing } from "./NpcSprite";
import { PlayerSprite, PLAYER_SIZE } from "./PlayerSprite";
import type { Position } from "./types";
import styles from "../../styles/scenarioGame.module.css";

type MovementAreaProps = {
  position: Position;
  onPositionChange: (position: Position) => void;
  onCoachMessage: (message: string) => void;
  // 백엔드 맵 geometry (TMX에서 추출된 walkable·collision·spawns). 있으면 이동 판정·NPC 배치에 사용.
  geometry?: GameMapData["geometry"] | null;
  // 배경 이미지 URL (로드 확인된 것) — overhead 오클루더가 같은 배경을 잘라 그리는 데 사용.
  mapImage?: string | null;
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

const MOVE_STEP = 18;             // 클릭 이동의 경로 샘플링 간격
const MOVE_SPEED = 260;           // 키보드 이동 속도 (px/초) — 프레임 루프 기준
// 화면 확대 배율 (팀 확정 2026-07-20). 배경·NPC·플레이어가 같은 world 래퍼 안에서
// 함께 확대되고, 카메라가 플레이어를 따라가며 맵 밖으로는 나가지 않게 clamp된다.
const ZOOM = 1.25;
const MAP_SIZE = { width: 1920, height: 1080 };
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
  mapImage = null,
  npcs = [],
  activeNpcId = null,
  onNpcClick,
  guideNpcId = null,
  guidePosition = null,
}: MovementAreaProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  // NPC 마커 clamp용 컨테이너 크기 — 플레이어(clampPosition)와 달리 마커는 렌더 시점에
  // area.clientWidth/Height를 직접 읽을 수 없어(첫 렌더엔 ref가 비어있음) state로 들고 간다.
  const [areaSize, setAreaSize] = useState<{ width: number; height: number } | null>(null);
  // 지금 눌려 있는 이동 키 — 프레임 루프가 매 프레임 읽는다 (리렌더 유발 안 함)
  const heldKeysRef = useRef<Set<string>>(new Set());

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

  // 폴리곤 충돌(대각선 구조물 등) — 로컬 좌표로 변환해 둔다
  const collisionPolys = useMemo<Array<Array<[number, number]>>>(() => {
    if (!geometry?.collision_polys) return [];
    return geometry.collision_polys.map((p) =>
      p.points.map(([px, py]) => [px - origin.x, py - origin.y] as [number, number]),
    );
  }, [geometry, origin]);

  // overhead 오클루더 — 배경의 가구 상단부를 잘라 캐릭터 위에 겹친다 (맵 리메이크 규격 v2).
  // z = baseline(가구 밑변): 발이 그보다 위(뒤)면 가려지고, 아래(앞)면 캐릭터가 위에 그려진다.
  // 기존 맵은 overhead가 없어 빈 배열 — 아무것도 렌더하지 않는다.
  const occluders = useMemo(() => {
    if (!geometry?.overhead || !mapImage) return [];
    const stageW = geometry.size?.width ?? 1920;
    const stageH = geometry.size?.height ?? 1080;
    const folderUrl = mapImage.slice(0, mapImage.lastIndexOf("/"));
    return geometry.overhead.flatMap((o) => {
      const box = o.bbox ?? (o.x != null && o.y != null ? { x: o.x, y: o.y, w: o.w ?? 0, h: o.h ?? 0 } : null);
      if (!box || !box.w || !box.h) return [];
      const clipPath = o.points
        ? `polygon(${o.points.map(([px, py]) => `${px - box.x}px ${py - box.y}px`).join(",")})`
        : undefined;
      return [{
        key: o.id ?? `${box.x},${box.y}`,
        left: box.x - origin.x,
        top: box.y - origin.y,
        width: box.w,
        height: box.h,
        zIndex: Math.round(o.baseline - origin.y),
        backgroundImage: `url("${mapImage}")`,
        backgroundPosition: `-${box.x}px -${box.y}px`,
        backgroundSize: `${stageW}px ${stageH}px`,
        clipPath,
        maskUrl: o.mask ? `url("${folderUrl}/${encodeURIComponent(o.mask)}")` : undefined,
      }];
    });
  }, [geometry, mapImage, origin]);

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
    playerWalkTimer.current = setTimeout(() => setPlayerWalking(false), 120);
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
        const rawX = touring ? guidePosition.x : spot.x - origin.x + step;
        const rawY = touring ? guidePosition.y : spot.y - origin.y;
        // 마커는 transform: translate(-50%, -50%)로 좌표 중심에 그려지므로, 스프라이트 절반
        // 폭·높이만큼 안쪽으로 clamp해야 컨테이너(overflow: hidden) 밖으로 잘려나가지 않는다.
        // 한 자리에 인원이 몰려 SLOT_SPREAD로 벌어질 때(4번째, 5번째 인원 등) 경계를 넘던 문제.
        markers.push({
          npc_id: npc.npc_id,
          name: npc.name,
          // 카메라가 있으면 맵 전체가 무대라 이동영역 크기로 자를 필요가 없다 —
          // 맵 경계로만 살짝 여며 스프라이트가 캔버스 밖으로 삐져나가지 않게 한다.
          x: clamp(rawX, -origin.x + NPC_FRAME.width / 2, -origin.x + MAP_SIZE.width - NPC_FRAME.width / 2),
          y: clamp(rawY, -origin.y + NPC_FRAME.height / 2, -origin.y + MAP_SIZE.height - NPC_FRAME.height / 2),
          isActive: npc.npc_id === activeNpcId,
        });
      }
    }
    return markers;
  }, [geometry, npcs, origin, activeNpcId, guideNpcId, guidePosition, areaSize]);

  const collidesAt = useCallback(
    (pos: Position) => {
      if (collisions.length === 0 && collisionPolys.length === 0) return false;
      const footX = pos.x + (PLAYER_SIZE.width - FOOT_WIDTH) / 2;
      const footY = pos.y + PLAYER_SIZE.height - FOOT_HEIGHT;
      if (
        collisions.some(
          (c) =>
            footX < c.x + c.w &&
            footX + FOOT_WIDTH > c.x &&
            footY < c.y + c.h &&
            footY + FOOT_HEIGHT > c.y,
        )
      ) {
        return true;
      }
      if (collisionPolys.length === 0) return false;
      // 폴리곤 판정: 발 박스 꼭짓점 + 중심의 point-in-polygon (레이 캐스팅)
      const probes: Array<[number, number]> = [
        [footX, footY],
        [footX + FOOT_WIDTH, footY],
        [footX, footY + FOOT_HEIGHT],
        [footX + FOOT_WIDTH, footY + FOOT_HEIGHT],
        [footX + FOOT_WIDTH / 2, footY + FOOT_HEIGHT / 2],
      ];
      return collisionPolys.some((poly) =>
        probes.some(([px, py]) => {
          let inside = false;
          for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const [xi, yi] = poly[i];
            const [xj, yj] = poly[j];
            if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
              inside = !inside;
            }
          }
          return inside;
        }),
      );
    },
    [collisions, collisionPolys],
  );

  // 맵 전체의 로컬좌표 경계 — geometry는 스테이지(1920×1080) 좌표, 로컬은 origin만큼 뺀 값.
  // 카메라가 생기기 전엔 이동영역 크기로 잘랐지만, 이제 맵 전체를 돌아다닐 수 있어야 한다.
  const worldBounds = useMemo(() => {
    const size = (geometry?.size as { width: number; height: number } | undefined) ?? MAP_SIZE;
    return {
      minX: -origin.x,
      minY: -origin.y,
      maxX: -origin.x + size.width,
      maxY: -origin.y + size.height,
    };
  }, [geometry, origin]);

  const clampPosition = useCallback(
    (nextPosition: Position) => {
      const area = areaRef.current;
      if (!area) return nextPosition;
      // 맵이 없으면(폴백 배경) 예전처럼 이동영역 안으로 가둔다
      const bounds = geometry
        ? worldBounds
        : { minX: 0, minY: 0, maxX: area.clientWidth, maxY: area.clientHeight };
      return {
        x: clamp(nextPosition.x, bounds.minX, bounds.maxX - PLAYER_SIZE.width),
        y: clamp(nextPosition.y, bounds.minY, bounds.maxY - PLAYER_SIZE.height),
      };
    },
    [geometry, worldBounds],
  );

  // 카메라 — 플레이어를 화면 중앙에 두되 맵 경계를 넘어가지 않는다.
  const camera = useMemo(() => {
    if (!geometry || !areaSize) return { x: 0, y: 0 };
    const viewW = areaSize.width / ZOOM;
    const viewH = areaSize.height / ZOOM;
    const focusX = position.x + PLAYER_SIZE.width / 2;
    const focusY = position.y + PLAYER_SIZE.height / 2;
    const spanX = worldBounds.maxX - worldBounds.minX;
    const spanY = worldBounds.maxY - worldBounds.minY;
    return {
      // 맵이 화면보다 작으면 가운데 정렬 (가장자리에 빈 공간이 생기지 않게)
      x: spanX <= viewW
        ? worldBounds.minX - (viewW - spanX) / 2
        : clamp(focusX - viewW / 2, worldBounds.minX, worldBounds.maxX - viewW),
      y: spanY <= viewH
        ? worldBounds.minY - (viewH - spanY) / 2
        : clamp(focusY - viewH / 2, worldBounds.minY, worldBounds.maxY - viewH),
    };
  }, [geometry, areaSize, position, worldBounds]);

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
  //
  // 키를 누른 '상태'를 모아두고 매 프레임 움직인다 — 예전엔 keydown 이벤트마다 18px씩
  // 튀었는데, OS 키 반복 속도에 끌려다녀서 처음엔 멈칫하고 이후엔 덜컹거렸다.
  // 프레임 루프로 바꾸면 속도가 일정하고 대각선 이동도 자연스럽다.
  useEffect(() => {
    const held = heldKeysRef.current;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (!MOVEMENT_KEYS[event.key]) return;
      event.preventDefault();
      held.add(event.key);
    };
    const onKeyUp = (event: globalThis.KeyboardEvent) => held.delete(event.key);
    const onBlur = () => held.clear(); // 창을 벗어나면 키가 눌린 채로 남지 않게
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      held.clear();
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000); // 탭 전환 등으로 크게 튀는 것 방지
      last = now;
      let dx = 0;
      let dy = 0;
      for (const key of heldKeysRef.current) {
        const d = MOVEMENT_KEYS[key];
        if (!d) continue;
        dx += Math.sign(d.x);
        dy += Math.sign(d.y);
      }
      if (dx === 0 && dy === 0) return;
      const len = Math.hypot(dx, dy) || 1; // 대각선이 빨라지지 않게 정규화
      const step = MOVE_SPEED * dt;
      movePlayer((dx / len) * step, (dy / len) * step);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [movePlayer]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("button")) return;
    const bounds = areaRef.current?.getBoundingClientRect();
    const area = areaRef.current;
    if (!bounds || !area) return;
    const scaleX = area.clientWidth / bounds.width;
    const scaleY = area.clientHeight / bounds.height;
    // 화면 좌표 → 월드 좌표: 배율로 나누고 카메라 오프셋을 더한다 (카메라 없으면 zoom=1·cam=0과 동일)
    const zoom = geometry ? ZOOM : 1;
    const worldX = (event.clientX - bounds.left) * scaleX / zoom + (geometry ? camera.x : 0);
    const worldY = (event.clientY - bounds.top) * scaleY / zoom + (geometry ? camera.y : 0);

    const target = clampPosition({
      x: worldX - PLAYER_SIZE.width / 2,
      y: worldY - PLAYER_SIZE.height / 2,
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
      setAreaSize({ width: area.clientWidth, height: area.clientHeight });
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
      <div
        className={styles.mapWorld}
        style={
          geometry
            ? {
                position: "absolute",
                left: 0,
                top: 0,
                transformOrigin: "0 0",
                // 화면 픽셀 격자에 맞춰 반올림 — 소수점 오프셋이 남으면 픽셀아트가 일렁인다
        transform: `scale(${ZOOM}) translate(${-Math.round(camera.x * ZOOM) / ZOOM}px, ${-Math.round(camera.y * ZOOM) / ZOOM}px)`,
                willChange: "transform",
              }
            : undefined
        }
      >
        {geometry && mapImage ? (
          // 배경을 world 안에 원본 크기로 둔다 — 좌표(스테이지)와 그림이 1:1로 맞아
          // 오클루더 크롭 위치가 어긋나지 않는다. 페이지 배경 레이어는 뒤에 남아 여백을 채운다.
          <img
            src={mapImage}
            alt=""
            aria-hidden="true"
            draggable={false}
            style={{
              position: "absolute",
              left: worldBounds.minX,
              top: worldBounds.minY,
              width: worldBounds.maxX - worldBounds.minX,
              height: worldBounds.maxY - worldBounds.minY,
              imageRendering: "pixelated",
              pointerEvents: "none",
            }}
          />
        ) : null}
      <div className={styles.objectLayer}>
        {occluders.map((o) => (
          <div
            key={o.key}
            className={styles.occluder}
            aria-hidden="true"
            style={{
              // 레이아웃에 필수인 값은 인라인으로 둔다 — CSS 모듈 클래스가 유실되면
              // (머지 사고 등) position:static이 되어 오클루더가 화면을 밀어버린다
              position: "absolute",
              pointerEvents: "none",
              backgroundRepeat: "no-repeat",
              left: o.left,
              top: o.top,
              width: o.width,
              height: o.height,
              zIndex: o.zIndex,
              backgroundImage: o.backgroundImage,
              backgroundPosition: o.backgroundPosition,
              backgroundSize: o.backgroundSize,
              clipPath: o.clipPath,
              WebkitMaskImage: o.maskUrl,
              maskImage: o.maskUrl,
            }}
          />
        ))}
        {geometry ? (
          npcMarkers.map((marker) => (
            <button
              className={`${styles.npcMarker} ${marker.isActive ? styles.npcMarkerActive : ""}`}
              type="button"
              key={marker.npc_id}
              style={{
                left: marker.x,
                top: marker.y,
                // 오클루전 맵에서는 NPC도 y-정렬에 참여 — 가구 뒤 자리면 하반신이 가려진다
                zIndex: occluders.length > 0 ? Math.round(marker.y + NPC_FRAME.height / 2) : undefined,
              }}
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
        {occluders.length > 0 ? (
          // 오클루전 맵: 플레이어를 오클루더와 같은 스태킹 컨텍스트에 넣고 발 y로 z-정렬 —
          // 가구 밑변(baseline)보다 발이 위면 가려지고, 아래면 캐릭터가 가구 위에 그려진다.
          <PlayerSprite
            position={position}
            facing={playerFacing}
            walking={playerWalking}
            zIndex={Math.round(position.y + PLAYER_SIZE.height)}
            smooth={guidePosition != null}
          />
        ) : null}
      </div>
      {occluders.length === 0 ? (
        <PlayerSprite
          position={position}
          facing={playerFacing}
          walking={playerWalking}
          smooth={guidePosition != null}
        />
      ) : null}
      </div>
    </div>
  );
}
