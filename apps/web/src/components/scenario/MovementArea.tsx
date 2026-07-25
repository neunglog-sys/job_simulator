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
  onNpcPositionsChange?: (positions: Record<string, Position>) => void;
  // 온보딩 투어(컷신) — 사수가 신입을 데리고 다니는 동안 그 마커를 이 좌표로 옮긴다.
  guideNpcId?: string | null;
  guidePosition?: Position | null;
  // 투어 중 카메라가 신입 대신 이 지점(사수)을 비추게 한다 — 신입은 제자리에 머무므로,
  // 이걸 넘겨야 사수가 팀원에게 걸어가 소개하는 장면이 화면에 보인다. null이면 평소대로 신입을 따라간다.
  cameraFocus?: Position | null;
  // 투어(컷신) 진행 중 — 동료(담당자)를 자기 자리(spawn)에 '고정해 그린다'(npcMarkers 렌더).
  // (사수가 "이쪽은 부장님이에요" 하고 데려갔는데 정작 부장님이 딴 데로 가 있으면 빈자리 소개가 되니까.)
  // 로밍 정지 자체는 roamingPaused가 담당 — 역할 분리.
  tourActive?: boolean;
  // 지금 대화 중인 NPC — 대화 세션이 살아있는 동안 로밍을 멈추고 플레이어를 바라본다.
  // 세션 종료(부모의 5초 무활동 타임아웃)로 null이 되면 다시 돌아다닌다.
  talkingNpcId?: string | null;
  // 투어(사수의 팀 소개) 등 컷신 중엔 모든 로머를 멈춘다.
  roamingPaused?: boolean;
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

const MOVE_STEP = 18;             // 키보드 방향키 한 번 입력의 기준 크기(부호만 프레임 루프에서 사용)
const MOVE_SPEED = 260;           // 키보드 이동 속도 (px/초) — 프레임 루프 기준
// 화면 확대 배율 (팀 확정 2026-07-20). 배경·NPC·플레이어가 같은 world 래퍼 안에서
// 함께 확대되고, 카메라가 플레이어를 따라가며 맵 밖으로는 나가지 않게 clamp된다.
const ZOOM = 1.25;
const MAP_SIZE = { width: 1920, height: 1080 };
// 같은 spawn 자리를 쓰는 NPC들을 좌우로 벌리는 간격(px) — 맵 자리(3개)보다 인원이 많을 때.
// 투어 앵커 계산(ScenarioGamePage)도 같은 값을 써야 마커와 어긋나지 않는다.
export const SLOT_SPREAD = 92;

// 마커 앵커(marker.y = 요소 중심)에서 스프라이트 발밑까지의 로컬 px (실측).
// 오클루전 z는 '발밑'으로 비교해야 가구 뒤에 서면 가려진다. 이름표를 머리 위로 올려도
// 스프라이트 위치는 그대로 유지되게 .npcMarker에 padding-bottom을 줬으므로(요소 높이 123 유지),
// 발밑은 예전과 같은 markerY+35다. 이 값·padding·이름표 배치는 함께 움직인다.
const NPC_FEET_OFFSET = 35;

// 로밍 한 걸음의 이동 애니메이션 길이(ms) — .npcMarker의 left/top transition과 맞춰야
// 걷기 스프라이트가 이동 시간만큼만 재생된다. 짧을수록 잰걸음("뽈뽈뽈")이 된다.
const ROAM_HOP_MS = 650;

// NPC와 이 거리(로컬 px) 안이어야 대화할 수 있다. 멀리서 마커를 클릭하면 바로 대화하지 않고
// 이 거리까지 걸어간 뒤 대화를 연다(가까이 가서 말 걸기).
const TALK_RADIUS = 140;

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
// 문/모서리 진입 보조(코너 어시스트) — 진행 방향이 막히면 수직으로 이만큼까지 밀어보며
// 통로에 맞으면 미끄러져 들어간다. 좁은 문 앞에서 정확히 정렬 안 해도 자연스럽게 들어가짐.
const DOOR_ASSIST = 20;
const ASSIST_STEP = 2;

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

// 대기 애니메이션이 전원 같은 박자로 흔들리지 않도록 npc_id 기반으로 딜레이를 흩뿌린다.
function idleSwayDelay(npcId: string): number {
  let hash = 0;
  for (let i = 0; i < npcId.length; i++) hash = (hash * 31 + npcId.charCodeAt(i)) >>> 0;
  return (hash % 20) / 10; // 0.0–1.9초
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
  onNpcPositionsChange,
  guideNpcId = null,
  guidePosition = null,
  cameraFocus = null,
  tourActive = false,
  talkingNpcId = null,
  roamingPaused = false,
}: MovementAreaProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  // NPC 마커 clamp용 컨테이너 크기 — 플레이어(clampPosition)와 달리 마커는 렌더 시점에
  // area.clientWidth/Height를 직접 읽을 수 없어(첫 렌더엔 ref가 비어있음) state로 들고 간다.
  const [areaSize, setAreaSize] = useState<{ width: number; height: number } | null>(null);
  // 월드 좌표 1px이 실제 화면에서 몇 px인가 — 게임 화면 전체가 --scenario-stage-scale로
  // 축소돼 있어 ZOOM만으로는 알 수 없다. 잔상(픽셀 어긋남) 억제에 쓴다.
  const [deviceScale, setDeviceScale] = useState(ZOOM);
  // 지금 눌려 있는 이동 키 — 누른 순서대로 보관한다(마지막 것이 유효).
  // 프레임 루프가 매 프레임 읽는다 (리렌더 유발 안 함).
  const heldKeysRef = useRef<string[]>([]);
  // 클릭 이동 목적지 — 프레임 루프가 매 프레임 한 걸음씩 다가간다(즉시 점프하지 않는다).
  // 대각선 클릭 이동이 예전엔 경로를 미리 계산해 한 번에 그 자리로 '점프'해서, 대각선으로
  // 멀리 찍으면 순간이동처럼 보였다. 키보드와 같은 프레임 루프를 타면 자연히 애니메이션된다.
  const walkTargetRef = useRef<Position | null>(null);
  // 멀리서 클릭한 NPC에게 '다가가서 대화하기'용 — 이 NPC를 쫓아 걸어가고(RAF 루프), 근처(TALK_RADIUS)에
  // 도착하면 onNpcClick으로 대화를 연다. 걸어가는 동안 이 NPC는 로밍을 멈춘다(도망 방지).
  const approachRef = useRef<string | null>(null);
  const approachBestRef = useRef(Infinity); // 접근 중 대상까지 최소 도달 거리 — 정체(막힘) 감지용
  const approachStallRef = useRef(0); // 더 못 가까워진 시간(초) — 일정 이상이면 접근 포기
  // NPC들의 현재 로컬 중심 좌표(마커 위치) — RAF 루프가 접근 대상의 최신 위치를 읽는 데 쓴다.
  const npcPosRef = useRef<Record<string, { x: number; y: number }>>({});
  // 최신 onNpcClick을 RAF 루프에서 부르기 위한 ref.
  const onNpcClickRef = useRef(onNpcClick);
  onNpcClickRef.current = onNpcClick;

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

  // 넛지 체크가 플레이어의 최신 좌표를 읽기 위한 ref — effect를 position 변화마다 재실행하지
  // 않기 위해 별도로 둔다 (movePlayer용 positionRef와 동일한 패턴, 아래에서 재선언됨).
  const livePositionRef = useRef(position);
  livePositionRef.current = position;

  // 넛지 체크가 "이 npc가 지금 온보딩 투어를 이끄는 중인지"를 최신값으로 읽기 위한 ref —
  // guidePosition은 투어 중 매 프레임 바뀌므로 patrol effect의 deps에 넣으면 타이머가 계속
  // 리셋된다(위 livePositionRef와 동일한 이유의 패턴).
  const guideNpcIdRef = useRef(guideNpcId);
  guideNpcIdRef.current = guideNpcId;

  // 로밍 effect가 "지금 대화 중인 NPC"와 "컷신으로 로밍 정지 여부"를 최신값으로 읽기 위한 ref —
  // props를 deps로 두면 매 갱신마다 로밍 타이머가 리셋돼 전 NPC 목적지·위치가 초기화된다.
  // ref로 흘려 effect는 그대로 두고, step()이 매 틱 읽어 정지 대상을 판단한다.
  const talkingNpcIdRef = useRef<string | null>(talkingNpcId);
  talkingNpcIdRef.current = talkingNpcId;
  const roamingPausedRef = useRef(roamingPaused);
  roamingPausedRef.current = roamingPaused;

  // 사수 안내 — geometry.npc_paths의 스폰→안내 지점으로 한 번만 리드하고, 도착 후 플레이어가
  // 안 따라오면 일정 주기로 말을 건다(팀 결정 2026-07-23 갱신: 왕복 순찰 → 1회 안내+넛지).
  // 좌표는 collision 배열 실측 검증됨 — kts-03/find_patrol_points.py. 온보딩 투어와 무관하게 항상 동작.
  // 단, 이 NPC 자신이 지금 온보딩 투어를 이끄는 중이면 넛지는 쉰다 — 안 그러면 투어 대사
  // 중간에 AI 코치가 "이쪽으로 와보세요" 같은 넛지를 끼얹어 방해한다.
  // 좌표는 spawns와 같은 스테이지 좌표계라 마커에 쓸 땐 origin을 빼서 로컬화한다.
  const [patrolTargets, setPatrolTargets] = useState<Record<string, Position>>({});
  const [patrolFacing, setPatrolFacing] = useState<Record<string, NpcFacing>>({});
  const [patrolWalking, setPatrolWalking] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!onNpcPositionsChange) return;
    onNpcPositionsChange(
      Object.fromEntries(
        Object.entries(patrolTargets).map(([npcId, target]) => [
          npcId,
          { x: target.x - origin.x, y: target.y - origin.y },
        ]),
      ),
    );
  }, [patrolTargets, origin.x, origin.y, onNpcPositionsChange]);
  useEffect(() => {
    const paths = geometry?.npc_paths ?? [];
    if (paths.length === 0) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const intervals: ReturnType<typeof setInterval>[] = [];

    // path.points는 spawns와 같은 스테이지 좌표(마커 중심) — collidesAt과 같은 규약
    // (PLAYER_SIZE 박스 좌상단, origin 뺀 로컬)으로 오가려면 반씩 보정해야 한다.
    const toLocal = (p: Position): Position => ({
      x: p.x - origin.x - PLAYER_SIZE.width / 2,
      y: p.y - origin.y - PLAYER_SIZE.height / 2,
    });
    // collidesAt(발밑 박스+폴리곤)과 동일 판정 — 이 effect는 그 콜백보다 먼저 선언돼 deps에
    // 넣을 수 없다(TDZ). collisions/collisionPolys는 더 앞서 선언되어 안전하니 직접 들고 온다.
    const collidesLocal = (p: Position) => {
      const footX = p.x + (PLAYER_SIZE.width - FOOT_WIDTH) / 2;
      const footY = p.y + PLAYER_SIZE.height - FOOT_HEIGHT;
      if (
        collisions.some(
          (c) => footX < c.x + c.w && footX + FOOT_WIDTH > c.x && footY < c.y + c.h && footY + FOOT_HEIGHT > c.y,
        )
      ) {
        return true;
      }
      if (collisionPolys.length === 0) return false;
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
            if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
          }
          return inside;
        }),
      );
    };
    // 목표까지 직선 경로 전체를 훑는다(8px 간격) — 앰비언트 로밍(NPC 상하좌우 걸음)의
    // pathClear와 동일한 방식. 한 곳이라도 막히면 이 걸음은 못 딛는다.
    const pathClear = (a: Position, b: Position) => {
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const stepsN = Math.max(1, Math.ceil(dist / 8));
      for (let i = 1; i <= stepsN; i++) {
        const t = i / stepsN;
        if (collidesLocal({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return false;
      }
      return true;
    };
    // 한 걸음(hop) 거리 — 유저 이동 속도(MOVE_SPEED)와 실제 체감 속도가 같아지도록,
    // 마커 transition 길이(ROAM_HOP_MS, 다른 로밍 NPC와 동일)만큼 그 속도로 걸을 거리로 잡는다.
    const HOP_DIST = MOVE_SPEED * (ROAM_HOP_MS / 1000);

    for (const path of paths) {
      if (path.points.length < 2) continue;
      const npcId = path.npc_id;
      const pauseMs = path.pause_ms ?? 1500;
      const from = path.points[0];
      const to = path.points[1];
      setPatrolTargets((prev) => ({ ...prev, [npcId]: from }));

      const startNudge = () => {
        // 안내 도착 — prompt가 있으면 플레이어가 안 따라오면 주기적으로 말을 건다.
        if (!path.prompt) return;
        const radius = path.nudge_radius ?? 240;
        const intervalMs = path.nudge_interval_ms ?? 6000;
        const maxNudges = path.nudge_max ?? 3;
        const targetLocalX = to.x - origin.x;
        const targetLocalY = to.y - origin.y;
        let count = 0;
        const timer = setInterval(() => {
          if (guideNpcIdRef.current === npcId) return; // 지금 이 NPC가 투어 진행 중 — 넛지 보류
          const p = livePositionRef.current;
          const dist = Math.hypot(
            p.x + PLAYER_SIZE.width / 2 - targetLocalX,
            p.y + PLAYER_SIZE.height / 2 - targetLocalY,
          );
          if (dist <= radius) {
            clearInterval(timer);
            return;
          }
          count += 1;
          onCoachMessage(path.prompt as string);
          if (count >= maxNudges) clearInterval(timer);
        }, intervalMs);
        intervals.push(timer);
      };

      timers.push(
        setTimeout(() => {
          let last = { x: from.x, y: from.y }; // 스테이지 좌표 기준 현재 위치
          let stuck = 0;
          let arrived = false;
          let hopTimer: ReturnType<typeof setInterval> | null = null;

          const arrive = () => {
            arrived = true;
            if (hopTimer) clearInterval(hopTimer);
            setPatrolTargets((prev) => ({ ...prev, [npcId]: to }));
            setPatrolWalking((prev) => ({ ...prev, [npcId]: false }));
            startNudge();
          };

          const step = () => {
            if (arrived) return;
            const gdx = to.x - last.x;
            const gdy = to.y - last.y;
            if (Math.abs(gdx) + Math.abs(gdy) < 6) {
              arrive();
              return;
            }
            // 대각선 금지: 남은 거리가 큰 축부터 시도, 막히면 다른 축(다른 로밍 NPC와 동일 규칙).
            const toward: Array<[number, number]> =
              Math.abs(gdx) >= Math.abs(gdy)
                ? [[Math.sign(gdx), 0], [0, Math.sign(gdy)]]
                : [[0, Math.sign(gdy)], [Math.sign(gdx), 0]];
            for (const [dx0, dy0] of toward) {
              if (dx0 === 0 && dy0 === 0) continue;
              const rem = dx0 !== 0 ? Math.abs(gdx) : Math.abs(gdy);
              const dist = Math.min(HOP_DIST, rem);
              const target = { x: last.x + dx0 * dist, y: last.y + dy0 * dist };
              if (!pathClear(toLocal(last), toLocal(target))) continue;
              setPatrolFacing((prev) => ({
                ...prev,
                [npcId]: dx0 !== 0 ? (dx0 > 0 ? "screen_right" : "screen_left") : dy0 > 0 ? "front" : "back",
              }));
              setPatrolWalking((prev) => (prev[npcId] ? prev : { ...prev, [npcId]: true }));
              setPatrolTargets((prev) => ({ ...prev, [npcId]: target }));
              last = target;
              stuck = 0;
              return;
            }
            // 두 축 다 막힘 — 몇 번 재시도해도 안 되면 포기하고 그 자리에서 넛지로 안내.
            if (++stuck > 4) arrive();
          };

          step();
          if (!arrived) {
            hopTimer = setInterval(step, ROAM_HOP_MS);
            intervals.push(hopTimer);
          }
        }, pauseMs),
      );
    }

    return () => {
      timers.forEach(clearTimeout);
      intervals.forEach(clearInterval);
    };
  }, [geometry, origin, collisions, collisionPolys, onCoachMessage]);

  // 투어 중인 사수의 진행 방향 — 좌표 변화의 지배 축으로 판정해 스프라이트가 걷는 쪽을 본다.
  // ref에 이전 좌표와 함께 저장: 좌표가 실제로 바뀐 렌더에서만 갱신 (StrictMode 이중 렌더 안전).
  const guideTrack = useRef<{ pos: Position | null; facing: NpcFacing }>({
    pos: null,
    facing: "front",
  });
  // 사수 컷신 한 걸음(코너~코너 직선)의 소요 시간 = 이 marker CSS transition 길이. ScenarioGamePage가
  // 걸음마다 guidePosition을 코너 좌표로 바꿔 넣는데, 그쪽 예약 간격(tourHopDurationMs)과 반드시 같은
  // 공식·같은 상·하한이어야 걸음이 어긋나지 않는다. MAX는 가장 긴 직선 구간(≈720px, 3273ms)을 등속으로
  // 활공하도록 3600ms(ScenarioGamePage TOUR_HOP_MAX_MS와 동일) — 캡에 걸리면 그 직선만 빨라 보여 속도 낮춤에 맞춰 함께 올림.
  const GUIDE_HOP_MIN_MS = 150;
  const GUIDE_HOP_MAX_MS = 3600;
  const GUIDE_HOP_SPEED_PX_S = 220; // 사용자 피드백 "직진 시 너무 빠름" → 260→220으로 살짝 낮춤(사수·따라가는 신입 공통)
  // (ScenarioGamePage TOUR_HOP_SPEED_PX_S와 반드시 같은 값이어야 걸음 예약과 CSS 전이가 어긋나지 않는다)
  const guideHopMsRef = useRef(GUIDE_HOP_MIN_MS);
  if (guidePosition) {
    // 투어가 막 시작된 첫 이동은 guideTrack.current.pos가 아직 null이라 거리 계산이 빠진다 —
    // 하필 이게 제일 긴 이동(자기 자리 → 첫 소개 동료)이라 놓치면 그대로 순간이동처럼 보인다.
    // 이 NPC의 순찰 도착 지점(patrolTargets, 곧 투어 시작 직전 자기 제자리)을 기준점으로 대신 쓴다.
    const patrolFallback = guideNpcId ? patrolTargets[guideNpcId] : undefined;
    const prev =
      guideTrack.current.pos ??
      (patrolFallback ? { x: patrolFallback.x - origin.x, y: patrolFallback.y - origin.y } : null);
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
      const dist = Math.hypot(dx, dy);
      guideHopMsRef.current = Math.min(
        GUIDE_HOP_MAX_MS,
        Math.max(GUIDE_HOP_MIN_MS, (dist / GUIDE_HOP_SPEED_PX_S) * 1000),
      );
    }
    guideTrack.current.pos = guidePosition;
  } else {
    guideTrack.current = { pos: null, facing: "front" };
  }

  // 마커 이동은 CSS transition(가변 길이)이라, 좌표가 바뀔 때마다 그 시간만큼만 걷기 애니메이션을 켠다.
  const [guideWalking, setGuideWalking] = useState(false);
  useEffect(() => {
    if (!guidePosition) {
      setGuideWalking(false); // 투어 종료 — 원위치로 돌아온 사수가 제자리에서 걷기 애니메이션이 남지 않게 끈다
      return;
    }
    setGuideWalking(true);
    const timer = setTimeout(() => setGuideWalking(false), guideHopMsRef.current);
    return () => clearTimeout(timer);
  }, [guidePosition]);

  // 주인공 바라보는 방향·걷기 — 이동 delta의 지배 축으로 판정, 입력이 멎으면 220ms 뒤 idle 복귀
  // (키 리피트 간격보다 길어야 걷는 중에 끊기지 않는다)
  const [playerFacing, setPlayerFacing] = useState<NpcFacing>("front");
  const [playerWalking, setPlayerWalking] = useState(false);
  const playerWalkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // holdMs = 이번 이동 뒤 걷기 애니메이션을 유지할 시간. 키보드는 매 프레임 호출되니 120ms면
  // 충분하지만, 투어(컷신)는 걸음(leg)당 한 번만 호출되므로 그 leg 소요시간만큼 길게 잡아야
  // 걷는 도중 다리가 멈추지 않는다.
  const notePlayerMove = useCallback((dx: number, dy: number, holdMs = 120) => {
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
    playerWalkTimer.current = setTimeout(() => setPlayerWalking(false), holdMs);
  }, []);

  // 투어(컷신) 중 신입은 키보드가 아니라 position prop으로 사수 뒤를 따라 걷는다. 이번 걸음(leg)
  // 소요시간은 사수 마커(guideHopMsRef)와 "똑같이 렌더 중 동기 계산"한다 — 예전엔 useEffect(렌더 뒤)
  // 에서 계산해, PlayerSprite가 늘 직전 걸음 값(첫 걸음은 초기 150ms)으로 그려져 첫 이동이 확 튀었다.
  const playerHopMsRef = useRef(GUIDE_HOP_MIN_MS);
  const tourPlayerTrack = useRef<Position | null>(null);
  const playerHopDeltaRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  if (guidePosition != null) {
    const prev = tourPlayerTrack.current;
    if (prev && (prev.x !== position.x || prev.y !== position.y)) {
      const dx = position.x - prev.x;
      const dy = position.y - prev.y;
      const dist = Math.hypot(dx, dy);
      playerHopMsRef.current = Math.min(
        GUIDE_HOP_MAX_MS,
        Math.max(GUIDE_HOP_MIN_MS, (dist / GUIDE_HOP_SPEED_PX_S) * 1000),
      );
      playerHopDeltaRef.current = { dx, dy }; // 방향·걷기 애니메이션은 아래 effect가 이 delta로 켠다
    }
    tourPlayerTrack.current = position;
  } else {
    tourPlayerTrack.current = null; // 투어 아닐 때는 관여하지 않는다(키보드가 애니메이션 담당)
  }

  // 방향(facing)·걷기(walking)는 state라 렌더 중 setState가 불가 — position이 실제로 바뀐 뒤 effect
  // 에서 위 동기 블록이 심어둔 이번 걸음 delta를 소비해 켠다(사수 guideWalking effect와 같은 결).
  // 사수만 움직인 렌더(guidePosition 변화, position 동일)에는 좌표 동일성으로 재실행을 막는다.
  const playerAnimAppliedRef = useRef<Position | null>(null);
  useEffect(() => {
    if (guidePosition == null) {
      playerAnimAppliedRef.current = null;
      return;
    }
    if (playerAnimAppliedRef.current === position) return; // 신입은 안 움직였다 → 애니메이션 유지
    playerAnimAppliedRef.current = position;
    const { dx, dy } = playerHopDeltaRef.current;
    if (dx === 0 && dy === 0) return;
    notePlayerMove(dx, dy, playerHopMsRef.current + 60); // 이 leg 동안 걷기 유지
  }, [position, guidePosition, notePlayerMove]);

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
        // 투어 사수: 컷신(guidePosition)이 위치의 유일한 권한이다. 투어 중엔 안내 위치에 그리고,
        // 투어가 끝나면 자기 자리(원위치)로 돌려놓는다. 예전엔 컷신이 끝나는 순간 guidePosition이
        // null이 되면서 레거시 npc_paths 리드(patrolTargets)로 넘어가 사수가 딴 자리로 흘러가고
        // (드리프트), 그 직선 이동이 가구를 가로질러 '뚫고 가는' 것처럼 보였다 → 리드 자체를 안 탄다.
        const isTourGuide = guideNpcId != null && guideNpcId === npc.npc_id;
        const touring = isTourGuide && guidePosition;
        // 그 외 NPC는 순찰 경로(geometry.npc_paths)가 있으면 자기 자리 대신 순찰 목표점에 그린다.
        // 단 투어(컷신) 중엔 앰비언트 로밍이 남긴 좌표를 무시하고 전부 자기 자리(spawn)에 고정한다 —
        // 로밍은 loading 단계(투어 진입 전)에 잠깐 돌아 동료를 자리 밖으로 흩어놓는데, 그 상태로
        // 얼어붙으면 사수가 원래 자리로 가서 '빈자리 소개'를 하게 된다. 투어 동안은 다들 제 데스크에.
        const patrolTarget = isTourGuide || tourActive ? null : patrolTargets[npc.npc_id];
        const rawX = touring
          ? guidePosition.x
          : patrolTarget
            ? patrolTarget.x - origin.x
            : spot.x - origin.x + step;
        const rawY = touring
          ? guidePosition.y
          : patrolTarget
            ? patrolTarget.y - origin.y
            : spot.y - origin.y;
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
  }, [geometry, npcs, origin, activeNpcId, guideNpcId, guidePosition, patrolTargets, tourActive, areaSize]);
  // RAF 루프(접근 이동)가 대상 NPC의 최신 위치를 deps 없이 읽도록 ref로 흘려둔다.
  npcPosRef.current = Object.fromEntries(npcMarkers.map((m) => [m.npc_id, { x: m.x, y: m.y }]));

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

  /** 화면 픽셀 격자에 맞춘 좌표 — 소수점 위치로 그리면 확대된 픽셀아트에 잔상이 남는다.
   *  (상태값은 소수점을 유지해야 매 프레임 누적 이동이 매끄럽다) */
  const snap = useCallback(
    (value: number) =>
      geometry && deviceScale > 0 ? Math.round(value * deviceScale) / deviceScale : value,
    [geometry, deviceScale],
  );

  // 카메라 — 플레이어를 화면 중앙에 두되 맵 경계를 넘어가지 않는다.
  const camera = useMemo(() => {
    if (!geometry || !areaSize) return { x: 0, y: 0 };
    const viewW = areaSize.width / ZOOM;
    const viewH = areaSize.height / ZOOM;
    // 투어 중엔 신입이 제자리에 머무므로 카메라가 사수(cameraFocus)를 비춘다 — 그래야 팀원 소개가
    // 화면에 잡힌다. 평소엔 신입(position)을 따라간다.
    const focus = cameraFocus ?? position;
    const focusX = focus.x + PLAYER_SIZE.width / 2;
    const focusY = focus.y + PLAYER_SIZE.height / 2;
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
  }, [geometry, areaSize, position, cameraFocus, worldBounds]);

  // 최신 좌표를 ref로 들고 간다 — 키를 꾹 누르면 키 리피트가 리렌더보다 빨라서, 클로저의
  // position으로 계산하면 그 사이 입력들이 같은 낡은 좌표를 읽고 마지막 것만 남는다(이동 유실).
  const positionRef = useRef(position);
  positionRef.current = position;

  const movePlayer = useCallback(
    (deltaX: number, deltaY: number) => {
      const from = positionRef.current;
      const freeAt = (x: number, y: number) => {
        const c = clampPosition({ x, y });
        return collidesAt(c) ? null : c;
      };
      // 어시스트 두 다리(수직 밀기, 이어지는 전진)의 양 끝점만 비어 있는지 보면, 벽 모서리 두 개가
      // 맞물린 자리에서 발판박스가 대각선으로 파고들어 통과할 수 있다(끝점은 둘 다 안 겹쳐도
      // 그 사이 직선 경로는 모서리를 스친다) — 책상·기둥 안쪽에 끼여 못 나오던 원인.
      // 경로를 잘게 훑어서(4px 간격) 진짜로 안 막힌 통로일 때만 어시스트를 허용한다.
      const pathClear = (x0: number, y0: number, x1: number, y1: number) => {
        const dist = Math.hypot(x1 - x0, y1 - y0);
        const steps = Math.max(1, Math.ceil(dist / 4));
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          if (collidesAt({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t })) return false;
        }
        return true;
      };
      const cur = { x: from.x, y: from.y };
      // 한 축 이동 — 막히면 진행 방향에 수직으로 살짝 밀어(코너 어시스트) 문/모서리로 미끄러진다.
      const slide = (dx: number, dy: number) => {
        if (dx === 0 && dy === 0) return;
        const direct = freeAt(cur.x + dx, cur.y + dy);
        if (direct) {
          cur.x = direct.x;
          cur.y = direct.y;
          return;
        }
        for (let off = ASSIST_STEP; off <= DOOR_ASSIST; off += ASSIST_STEP) {
          for (const s of [off, -off]) {
            const px = dx === 0 ? s : 0; // 세로 이동이면 좌우로, 가로 이동이면 상하로 민다
            const py = dy === 0 ? s : 0;
            const shifted = freeAt(cur.x + px, cur.y + py);
            if (!shifted) continue;
            if (!pathClear(cur.x, cur.y, shifted.x, shifted.y)) continue;
            const moved = freeAt(shifted.x + dx, shifted.y + dy);
            if (!moved) continue;
            if (!pathClear(shifted.x, shifted.y, moved.x, moved.y)) continue;
            cur.x = moved.x;
            cur.y = moved.y;
            return;
          }
        }
      };
      slide(deltaX, 0);
      slide(0, deltaY);
      if (cur.x !== from.x || cur.y !== from.y) {
        positionRef.current = { ...cur }; // 다음 입력이 곧바로 이어지도록 즉시 반영
        onPositionChange({ ...cur });
        notePlayerMove(cur.x - from.x, cur.y - from.y);
      }
    },
    [clampPosition, collidesAt, onPositionChange, notePlayerMove],
  );

  // NPC 앰비언트 로밍 — 매장/오피스를 돌아다니게 한다(사용자 요청 2026-07-24).
  // 기본은 손님(role에 고객/손님/컨슈머)만 — 직원(점장=계산대, 사수=바)은 자기 자리를 지킨다(kts-03).
  // roam_all이면 손님 구분 없이 전원 대상 — 오피스형 시나리오(sns-01)는 모두가 돌아다닌다.
  // 어느 쪽이든 npc_paths(가이드/순찰) NPC는 제외 — 스크립트 경로를 따르므로 로밍과 충돌하면 안 된다.
  // 2~3초마다 갈 수 있는 목적지로 옮긴다. collidesAt(가구)+clampPosition(walkable 경계)으로
  // 검증해 벽·집기·못 가는 곳으로 새지 않는다. 마커 CSS transition(900ms)이 걷기 연출.
  useEffect(() => {
    const spawns = geometry?.spawns;
    if (!spawns || npcs.length === 0) return;
    // 투어 등 컷신 중 로밍 정지는 roamingPaused(아래 step에서 per-tick 확인)가 담당한다.
    // 동료를 자기 자리(spawn)에 '보이게' 고정하는 건 별개로 tourActive가 npcMarkers 렌더에서 처리.
    const byId = new Map(spawns.map((s) => [s.id, s]));
    const roamAll = geometry?.roam_all === true;
    const guidedIds = new Set((geometry?.npc_paths ?? []).map((p) => p.npc_id));
    const roamers = npcs.filter(
      (n) =>
        n.spawn &&
        byId.has(n.spawn) &&
        !guidedIds.has(n.npc_id) &&
        // 현재 미션 담당 NPC는 제자리에 세운다 — 플레이어가 찾아가서 말 거는 흐름(퀴즈·업무 순차 진행).
        // 안 그러면 담당 NPC가 플레이어 쪽으로 배회해 와서 근접/대화가 저절로 열린다(태능 피드백).
        n.npc_id !== activeNpcId &&
        (roamAll || /고객|손님|컨슈머/.test(n.role)),
    );
    if (roamers.length === 0) return;

    // roam_area가 있으면 그 안을 자유롭게(매장 플로어), 없으면 스폰 주변으로 제한(폴백).
    // 와인바 안쪽·창고는 roam_area 밖으로 잡아 손님이 못 들어가게 한다.
    const area = geometry?.roam_area ?? null;
    const inArea = (x: number, y: number, spot: Position) =>
      area
        ? x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h
        : Math.hypot(x - spot.x, y - spot.y) <= 120;
    const DIRS: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const intervals: ReturnType<typeof setInterval>[] = [];

    const toLocal = (sx: number, sy: number) => ({
      x: sx - origin.x - PLAYER_SIZE.width / 2,
      y: sy - origin.y - PLAYER_SIZE.height / 2,
    });

    for (const npc of roamers) {
      const spot = byId.get(npc.spawn as string);
      if (!spot) continue;
      let last = { x: spot.x, y: spot.y }; // 직전 목표(스테이지 좌표)

      // 목표점만이 아니라 직선 경로 전체를 훑는다 — 안 그러면 진열대·벽을 관통해 걷는다(발밑
      // 박스로 8px 간격 충돌 판정 + walkable 경계 확인). 한 곳이라도 막히면 이 방향은 못 간다.
      const pathClear = (dx0: number, dy0: number, dist: number) => {
        const stepsN = Math.max(1, Math.ceil(dist / 8));
        for (let k = 1; k <= stepsN; k++) {
          const t = k / stepsN;
          const p = toLocal(last.x + dx0 * dist * t, last.y + dy0 * dist * t);
          const c = clampPosition(p);
          if (collidesAt(p) || Math.abs(c.x - p.x) > 1 || Math.abs(c.y - p.y) > 1) return false;
        }
        return true;
      };
      // 목적지 조건 두 가지(사용자 피드백 영상: NPC가 벽·화분에 붙어 제자리 서성임):
      //  (1) 벽·집기에서 GOAL_MARGIN만큼 떨어진 '열린 바닥' — 벽에 코 박고 서성이지 않게.
      //  (2) 지금 위치에서 minTravel 이상 떨어진 곳 우선 — 제자리 맴돌지 않고 매장을 가로지르게.
      const GOAL_MARGIN = 30;
      const minTravel = area ? Math.min(area.w, area.h) * 0.6 : 150;
      const isOpen = (gx: number, gy: number) =>
        !collidesAt(toLocal(gx, gy)) &&
        !collidesAt(toLocal(gx + GOAL_MARGIN, gy)) &&
        !collidesAt(toLocal(gx - GOAL_MARGIN, gy)) &&
        !collidesAt(toLocal(gx, gy + GOAL_MARGIN)) &&
        !collidesAt(toLocal(gx, gy - GOAL_MARGIN));
      const pickGoal = () => {
        let fallback: Position | null = null; // 먼 곳을 못 찾으면 아무 열린 바닥이라도
        for (let i = 0; i < 60; i++) {
          const gx = area ? area.x + Math.random() * area.w : spot.x + (Math.random() - 0.5) * 200;
          const gy = area ? area.y + Math.random() * area.h : spot.y + (Math.random() - 0.5) * 200;
          if (!isOpen(gx, gy)) continue;
          if (!fallback) fallback = { x: gx, y: gy };
          if (Math.hypot(gx - last.x, gy - last.y) >= minTravel) return { x: gx, y: gy };
        }
        return fallback ?? { x: last.x, y: last.y };
      };
      let goal = pickGoal();
      let stuck = 0;
      let bestDist = Infinity; // 이 목적지까지 도달한 최소 맨해튼 거리 — 우회 실패(맴돌기) 감지
      let noProgress = 0; // 목적지에 더 못 가까워진 연속 스텝 수
      const nextGoal = () => {
        goal = pickGoal();
        stuck = 0;
        bestDist = Infinity;
        noProgress = 0;
      };

      const step = () => {
        // 정지 조건 두 가지: (1) 투어 등 컷신 중(전 로머 정지) (2) 이 NPC가 지금 대화 중.
        // 세션은 부모가 관리(5초 무활동 시 종료) — 여기선 상태만 읽어 멈춘다. 플레이어를 바라보는 건
        // 아래 '대화 중 NPC 시선' 효과가 로머·직원 공통으로 처리한다.
        // (3) 플레이어가 다가오는 중인 대상(approachRef)도 멈춘다 — 안 그러면 도망가는 표적이 된다.
        if (
          roamingPausedRef.current ||
          talkingNpcIdRef.current === npc.npc_id ||
          approachRef.current === npc.npc_id
        ) {
          setPatrolWalking((prev) => (prev[npc.npc_id] ? { ...prev, [npc.npc_id]: false } : prev));
          return;
        }
        // 무편향 랜덤워크는 확산이 느려 한 구역만 맴돈다(사용자: "특정 구역에서만 움직여").
        // 매장 어딘가로 '목적지'를 잡고 그쪽으로 직진 — 실제 손님처럼 플로어를 가로지른다.
        const gdx = goal.x - last.x;
        const gdy = goal.y - last.y;
        if (Math.abs(gdx) + Math.abs(gdy) < 60) {
          nextGoal(); // 도착 — 다음 목적지
          return;
        }
        // 대각선 금지: 남은 거리가 큰 축부터 한 축씩 시도, 막히면 다른 축, 그래도 막히면 랜덤 탈출.
        const toward: Array<[number, number]> =
          Math.abs(gdx) >= Math.abs(gdy)
            ? [[Math.sign(gdx), 0], [0, Math.sign(gdy)]]
            : [[0, Math.sign(gdy)], [Math.sign(gdx), 0]];
        const candidates = [...toward, ...[...DIRS].sort(() => Math.random() - 0.5)];
        for (const [dx0, dy0] of candidates) {
          if (dx0 === 0 && dy0 === 0) continue; // 이미 그 축은 정렬됨
          const rem = dx0 !== 0 ? Math.abs(gdx) : Math.abs(gdy);
          const dist = Math.min(40 + Math.random() * 70, Math.max(40, rem)); // 40~110px, 목적지 넘지 않게
          const tx = last.x + dx0 * dist;
          const ty = last.y + dy0 * dist;
          if (!inArea(tx, ty, spot)) continue;
          if (!pathClear(dx0, dy0, dist)) continue;
          setPatrolFacing((prev) => ({
            ...prev,
            [npc.npc_id]: dx0 !== 0 ? (dx0 > 0 ? "screen_right" : "screen_left") : dy0 > 0 ? "front" : "back",
          }));
          setPatrolWalking((prev) => ({ ...prev, [npc.npc_id]: true }));
          setPatrolTargets((prev) => ({ ...prev, [npc.npc_id]: { x: tx, y: ty } }));
          last = { x: tx, y: ty };
          stuck = 0;
          // 장애물에 막혀 목적지 쪽으로 못 가고 옆에서 맴돌면(경로탐색이 없어 생기는 지역최소)
          // 몇 스텝 안에 목적지를 포기한다 — 안 그러면 진열대 옆에서 위아래로만 튕긴다(영상 오건우).
          const nd = Math.abs(goal.x - tx) + Math.abs(goal.y - ty);
          if (nd < bestDist - 8) {
            bestDist = nd;
            noProgress = 0;
          } else if (++noProgress > 3) {
            nextGoal();
          }
          timers.push(
            setTimeout(() => setPatrolWalking((prev) => ({ ...prev, [npc.npc_id]: false })), ROAM_HOP_MS),
          );
          return;
        }
        // 사방이 막힘 — 몇 번 연속 막히면 목적지를 새로 잡아 빠져나온다.
        if (++stuck > 2) nextGoal();
      };

      // 잰걸음으로 자주 움직이게(사용자: "더 뽈뽈뽈") — 0.9~1.4초 간격. NPC마다 살짝 어긋나게.
      const period = 900 + (npc.npc_id.length % 3) * 250; // 0.9/1.15/1.4초
      timers.push(
        setTimeout(() => {
          step();
          intervals.push(setInterval(step, period));
        }, idleSwayDelay(npc.npc_id) * 500),
      );
    }

    return () => {
      timers.forEach(clearTimeout);
      intervals.forEach(clearInterval);
    };
    // activeNpcId가 바뀌면 담당 NPC가 바뀌므로 로밍 대상을 다시 잡는다(옛 담당은 다시 로밍, 새 담당은 고정).
  }, [geometry, npcs, origin, collidesAt, clampPosition, activeNpcId]);

  // patrolTargets(로머의 현재 위치)를 아래 시선 효과가 deps 없이 최신값으로 읽기 위한 ref.
  const patrolTargetsRef = useRef(patrolTargets);
  patrolTargetsRef.current = patrolTargets;

  // 대화 중인 NPC는 플레이어를 바라본다(사용자 요청) — 돌아다니는 손님이든 자리 지키는 직원이든 공통.
  // 대화 시작·플레이어 이동마다 그 NPC의 위치에서 플레이어 쪽으로 방향을 다시 잡는다(position deps).
  // 세션이 끝나 talkingNpcId가 null이 되면 갱신을 멈춰, 로머는 다시 로밍·직원은 마지막 방향을 유지.
  useEffect(() => {
    if (!talkingNpcId) return;
    const npc = npcs.find((n) => n.npc_id === talkingNpcId);
    const pt = patrolTargetsRef.current[talkingNpcId];
    const spot = npc?.spawn ? geometry?.spawns?.find((s) => s.id === npc.spawn) : null;
    const stage = pt ?? (spot ? { x: spot.x, y: spot.y } : null);
    if (!stage) return;
    const fdx = position.x + PLAYER_SIZE.width / 2 - (stage.x - origin.x);
    const fdy = position.y + PLAYER_SIZE.height / 2 - (stage.y - origin.y);
    const facing: NpcFacing =
      Math.abs(fdx) >= Math.abs(fdy) ? (fdx > 0 ? "screen_right" : "screen_left") : fdy > 0 ? "front" : "back";
    setPatrolFacing((prev) => (prev[talkingNpcId] === facing ? prev : { ...prev, [talkingNpcId]: facing }));
  }, [position, talkingNpcId, npcs, geometry, origin]);

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
      if (!held.includes(event.key)) held.push(event.key); // 키 반복으로 중복 쌓이지 않게
    };
    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      const at = held.indexOf(event.key);
      if (at >= 0) held.splice(at, 1);
    };
    const onBlur = () => held.splice(0); // 창을 벗어나면 키가 눌린 채로 남지 않게
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      held.splice(0);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000); // 탭 전환 등으로 크게 튀는 것 방지
      last = now;
      // 대각선 이동은 쓰지 않는다 — 두 축이 동시에 소수점으로 움직이면 확대 화면에서
      // 잔상이 두드러진다. 가장 마지막에 누른 방향 하나로만 걷는다(팀 결정).
      const held = heldKeysRef.current;
      const active = held.length ? MOVEMENT_KEYS[held[held.length - 1]] : undefined;
      const step = MOVE_SPEED * dt;
      if (active) {
        walkTargetRef.current = null; // 키보드가 우선 — 클릭 이동 중이었다면 취소
        approachRef.current = null; // 키보드로 직접 움직이면 접근 이동도 취소
        movePlayer(Math.sign(active.x) * step, Math.sign(active.y) * step);
        return;
      }
      // NPC 접근 이동: 멀리서 클릭한 NPC의 '현재' 위치를 매 프레임 쫓아 걸어가고(로밍으로 살짝
      // 움직였어도 따라감), TALK_RADIUS 안에 들면 그때 대화를 연다. 좌표·정지를 한 곳에서 다뤄 어긋남이 없다.
      const approaching = approachRef.current;
      if (approaching) {
        const np = npcPosRef.current[approaching];
        if (!np) {
          approachRef.current = null; // 대상이 사라짐 — 취소
        } else {
          const c = positionRef.current;
          const d = Math.hypot(c.x + PLAYER_SIZE.width / 2 - np.x, c.y + PLAYER_SIZE.height / 2 - np.y);
          if (d < TALK_RADIUS) {
            approachRef.current = null;
            walkTargetRef.current = null;
            onNpcClickRef.current?.(approaching); // 도착 — 대화 시작
            return;
          }
          // 계속 가까워지면 정체 타이머 리셋, 아니면(가구에 막힘 등) 누적 — 0.8초 넘게 못 가까워지면 포기.
          // 경로탐색이 없어 직선이 막히면 못 가는데, 무한정 밀지 않고 멈춘다(플레이어가 직접 돌아가서 다시 클릭).
          if (d < approachBestRef.current - 2) {
            approachBestRef.current = d;
            approachStallRef.current = 0;
          } else {
            approachStallRef.current += dt;
            if (approachStallRef.current > 0.8) {
              approachRef.current = null;
              walkTargetRef.current = null;
              return;
            }
          }
          walkTargetRef.current = { x: np.x - PLAYER_SIZE.width / 2, y: np.y - PLAYER_SIZE.height / 2 };
        }
      }
      // 클릭 이동: 목표 지점까지 매 프레임 한 걸음씩 다가간다(대각선도 자연스럽게 애니메이션됨).
      const target = walkTargetRef.current;
      if (!target) return;
      const cur = positionRef.current;
      const dx = target.x - cur.x;
      const dy = target.y - cur.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) {
        walkTargetRef.current = null;
        return;
      }
      const hopStep = Math.min(dist, step);
      // 직교 이동만 — 대각선(두 축 동시)으로 가면 확대 화면에서 잔상이 생기고, 집기 모서리에
      // 발판박스가 파고들어 이상하게 막힌다. 키보드·로밍과 같은 규칙: 남은 거리가 큰 축부터
      // 한 축씩 시도하고, 그 축이 막히면 다른 축으로 돌아 벽을 따라 미끄러진다.
      const stepX = Math.sign(dx) * Math.min(Math.abs(dx), hopStep);
      const stepY = Math.sign(dy) * Math.min(Math.abs(dy), hopStep);
      const axes: Array<[number, number]> =
        Math.abs(dx) >= Math.abs(dy)
          ? [[stepX, 0], [0, stepY]]
          : [[0, stepY], [stepX, 0]];
      let moved = false;
      for (const [ax, ay] of axes) {
        if (ax === 0 && ay === 0) continue;
        movePlayer(ax, ay);
        if (positionRef.current.x !== cur.x || positionRef.current.y !== cur.y) {
          moved = true;
          break;
        }
      }
      if (!moved) {
        walkTargetRef.current = null; // 두 축 다 막힘 — 막힌 지점까지 왔으니 멈춘다
      }
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
    approachRef.current = null; // 지도를 직접 클릭해 이동하면 NPC 접근 이동은 취소
    // 클릭한 지점까지 '걸어간다' — 벽·집기를 뚫지 않되, 막혔다고 그 자리에 멈춰 서지도 않는다.
    // NPC는 책상 앞에 있어서 NPC를 누르면 목적지가 충돌 안이 되는데, 예전처럼 무시해 버리면
    // "눌러도 아무 일이 없다"가 된다(다가가려고 누른 건데). 갈 수 있는 데까지 이동한다.
    // 실제 이동은 프레임 루프가 매 프레임 한 걸음씩 수행한다(여기서 즉시 점프하면 대각선
    // 클릭이 순간이동처럼 보인다 — 키보드처럼 애니메이션되도록 목표 지점만 넘겨준다).
    walkTargetRef.current = target;
  };

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;

    const resizeObserver = new ResizeObserver(() => {
      setAreaSize({ width: area.clientWidth, height: area.clientHeight });
      const rect = area.getBoundingClientRect();
      if (area.clientWidth > 0) {
        setDeviceScale((rect.width / area.clientWidth) * ZOOM * (window.devicePixelRatio || 1));
      }
      // 최신 위치는 ref에서 읽는다. position을 의존성에 넣으면 이동하는 동안(60fps)
      // 매 프레임 observer를 끊고 다시 붙이는데, observe()는 붙자마자 콜백을 한 번
      // 부르기 때문에 프레임마다 setState가 돌아 맵 전체가 다시 그려졌다.
      const current = positionRef.current;
      const nextPosition = clampPosition(current);
      if (nextPosition.x !== current.x || nextPosition.y !== current.y) {
        onPositionChange(nextPosition);
      }
    });
    resizeObserver.observe(area);
    return () => resizeObserver.disconnect();
  }, [clampPosition, onPositionChange]);

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
                // 실제 화면 픽셀 격자에 맞춰 반올림 — 어긋난 채로 두면 확대된 픽셀아트가 일렁인다
        transform: `scale(${ZOOM}) translate(${-snap(camera.x)}px, ${-snap(camera.y)}px)`,
                // 소개 대상을 잠깐 비출 때(cameraFocus)만 부드럽게 팬한다 — 시선이 툭 끊기지 않게.
                // 신입을 따라갈 때는 트랜지션을 걸지 않는다. 신입은 매 프레임 몇 px씩 걷는데 여기에
                // 트랜지션이 걸리면 맵이 뒤늦게 미끄러져 걸음이 붕 뜬 것처럼 보인다(걷기 이상 증상의 원인).
                transition: cameraFocus != null ? "transform 450ms ease-in-out" : undefined,
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
          npcMarkers.map((marker) => {
            // 걷는 중이 아닌 NPC는 전부 잔잔한 제자리 흔들림을 켠다 — 도착해 대기 중인 사수도,
            // 애초에 순찰 경로가 없는 나머지 NPC도 포함(팀 요청 2026-07-23 갱신).
            const isWalking =
              !WALK_DISABLED_NPCS.has(marker.npc_id) &&
              ((guideNpcId === marker.npc_id && guideWalking) ||
                // 투어 중 동료는 자기 자리에서 idle(흔들림)만 — 로밍 중이던 걷기 상태가 남아
                // 제자리에서 걷는 것처럼 보이지 않게 한다.
                (!tourActive && Boolean(patrolWalking[marker.npc_id])));
            return (
              <button
                className={`${styles.npcMarker} ${marker.isActive ? styles.npcMarkerActive : ""} ${
                  isWalking ? "" : styles.npcIdleSway
                }`}
                type="button"
                key={marker.npc_id}
                style={{
                  left: marker.x,
                  top: marker.y,
                  // 오클루전 맵에서는 NPC도 y-정렬에 참여 — 가구 뒤 자리면 하반신이 가려진다
                  zIndex: occluders.length > 0 ? Math.round(marker.y + NPC_FEET_OFFSET) : undefined,
                  animationDelay: isWalking ? undefined : `${idleSwayDelay(marker.npc_id)}s`,
                  // 투어 중엔(원위치 복귀 걸음 포함) guidePosition이 set이라 걸음(leg) 소요시간만큼 활공한다.
                  // 복귀는 ScenarioGamePage가 planGuideHops로 걸어서 마치고, 도착해서야 guidePosition=null이
                  // 되므로 이때의 0ms는 이미 spawn 좌표에 도착한 마커의 잔여(<16px) 스냅일 뿐 — 크로스맵 활공 아님.
                  transitionDuration:
                    guideNpcId === marker.npc_id
                      ? guidePosition != null
                        ? `${guideHopMsRef.current}ms`
                        : "0ms"
                      : // 투어 시작 순간, 로밍으로 흩어졌던 동료를 자기 자리로 되돌릴 때 650ms
                        // CSS 전이로 맵을 가로질러 '대각선 활공'하지 않도록 즉시 스냅한다.
                        tourActive
                        ? "0ms"
                        : undefined,
                }}
                onClick={() => {
                  if (!onNpcClick) return; // 대화 불가 상태(온보딩·모달 등)면 다가가지도 않는다
                  // 가까우면 바로 대화. 멀면 그 자리서 대화하지 않고 그 NPC에게 걸어간 뒤(RAF 루프가
                  // 도착하면 onNpcClick 호출) 대화한다 — "가까이 가서 말 걸기".
                  const c = positionRef.current;
                  const d = Math.hypot(
                    c.x + PLAYER_SIZE.width / 2 - marker.x,
                    c.y + PLAYER_SIZE.height / 2 - marker.y,
                  );
                  if (d < TALK_RADIUS) {
                    approachRef.current = null;
                    onNpcClick?.(marker.npc_id);
                  } else {
                    approachRef.current = marker.npc_id;
                    approachBestRef.current = d; // 정체 감지 초기화
                    approachStallRef.current = 0;
                  }
                }}
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
                    // 가이드 컷신이 '실제로 진행 중'(guidePosition 있음)일 때만 컷신 방향을 쓴다.
                    // 컷신이 아닐 땐 patrolFacing을 써야 클릭 시 플레이어를 바라보는 게 가이드에게도 먹는다.
                    guideNpcId === marker.npc_id && guidePosition
                      ? guideTrack.current.facing
                      : (patrolFacing[marker.npc_id] ?? "front")
                  }
                  walking={isWalking}
                />
                <span className={styles.npcMarkerName}>{marker.name}</span>
              </button>
            );
          })
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
            position={{ x: snap(position.x), y: snap(position.y) }}
            facing={playerFacing}
            walking={playerWalking}
            zIndex={Math.round(position.y + PLAYER_SIZE.height)}
          />
        ) : null}
      </div>
      {occluders.length === 0 ? (
        <PlayerSprite
          position={{ x: snap(position.x), y: snap(position.y) }}
          facing={playerFacing}
          walking={playerWalking}
        />
      ) : null}
      </div>
    </div>
  );
}
