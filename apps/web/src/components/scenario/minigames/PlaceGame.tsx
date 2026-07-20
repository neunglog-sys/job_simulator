import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { UserCircle } from "@phosphor-icons/react";
import base from "../../../styles/minigame.module.css";
import styles from "../../../styles/placeGame.module.css";
import { PixelSprite } from "./PixelSprite";
import { SCENE } from "./types";
import {
  GameHud,
  ResultBar,
  clampScore,
  elapsedSeconds,
  scoringOf,
  useCountdown,
  type EngineProps,
} from "./shared";

/**
 * place 엔진 — 조각 카트에서 골라 슬롯에 배치한다. 6개 시나리오가 쓴다.
 *
 * 두 모드:
 * - 기본: 아무 조각이나 아무 빈 슬롯에 놓이고, 제출 시 최종 상태로 채점한다.
 *   (오배치가 가능해야 wrong_slot_penalty·forbidden 배치가 성립한다 — hr-01·ys-01)
 * - fit: any (stn-05): 어디든 꽂히되 틀리면 그 자리가 계속 새는 시각 피드백이 남고,
 *   빼서 재배치할 수 있지만 잘못 꽂은 '사건'의 감점은 유지된다(브루트포스 방지).
 *
 * 레이아웃 두 가지(채점과 무관한 표시층):
 * - 맵 모드: 모든 slot에 at:[x,y](논리 캔버스 960×440)가 있으면 배치도 위 실제
 *   위치에 슬롯을 그린다. 트레이는 2줄(참석자 / 자료·소품)이고 조각을 드래그해
 *   슬롯에 놓을 수 있다. 접근성 폴백으로 기존 클릭-선택 → 슬롯-클릭도 그대로 동작한다.
 *   배경은 두 갈래:
 *   · scene 없음(ms-03 회의실) — 기존 CSS/SVG 배치도(테이블+의자 위에서 본 뷰) 그대로.
 *   · scene 있음(hr-01·cln-01) — public/assets/minigames/<scene>.svg 도트 씬을
 *     캔버스에 꽉 채워 깔고(RouteGame map 배경 패턴, pixelated) 슬롯은 컴팩트 패드로
 *     올린다. 씬 파일이 없거나 로드에 실패하면 맵 모드로 올리지 않고 기존 목록 UI로
 *     폴백한다 — 아트 추가 전과 동일 화면(회귀 금지).
 * - 목록 모드(at 없는 게임 + 씬 파일이 아직 없는 scene 게임): 기존 그리드 배치판 + 단일 카트.
 *
 * 확장 필드: marker(ms-03 명패)·visual_cues(라벨 마커)·accepts null(stn-05 정상 구간)·
 * stains(cln-01 문지르기/교체 — sprite 도트 렌더, 씬 아트 맵에선 표시 전용 at 좌표로
 * 침대 위 오버레이. at·씬 아트가 없으면 기존 얼룩 행 UI 그대로)·
 * forbidden {id, slots?}(cln-01·hr-01)·escalate(보고 버튼).
 * 채점은 파일 scoring 주석이 명세다 — 한 조각(사건)에는 가장 무거운 감점 하나만 적용한다.
 */

type PlaceSlot = {
  id: string;
  accepts?: string | null;
  marker?: string;
  label?: string;
  at?: [number, number];
};
/** at 은 표시 전용(씬 아트 맵 위 오버레이 위치) — 채점·resolve 계약과 무관하다. */
type PlaceStain = { id: string; sprite?: string; resolve?: string; at?: [number, number] };
type ForbiddenRule = { id: string; slots?: string[]; reason?: string };
type PlaceData = {
  scene?: string;
  fit?: string;
  slots?: PlaceSlot[];
  pieces?: string[];
  extras?: Array<string | { id: string; reason?: string }>;
  forbidden?: ForbiddenRule[];
  stains?: PlaceStain[];
  visual_cues?: Record<string, string>;
  escalate?: { label?: string; when?: string | string[] };
};

type StainState = { progress: number; resolved: boolean; hint: string | null };

type Summary = {
  score: number;
  correctSlots: number;
  slotCount: number;
  resolvedStains: number;
  stainCount: number;
  wrongCount: number;
  extraCount: number;
  forbiddenCount: number;
  missedCount: number;
};

/** 스프라이트가 있으면 도트로 그리고, 없으면 id·단서를 라벨 마커로 폴백(SortGame과 같은 규약). */
const pretty = (raw: string) => raw.replace(/_/g, " ");

/** slot.at 이 숫자 [x, y] 쌍일 때만 좌표로 인정한다(데이터 방어). */
const slotAt = (slot: PlaceSlot): [number, number] | null => {
  const at: unknown = slot.at;
  return Array.isArray(at) && at.length === 2 && typeof at[0] === "number" && typeof at[1] === "number"
    ? [at[0], at[1]]
    : null;
};

/** stain.at 도 같은 방어 — 좌표가 아니면 맵 오버레이 대신 기존 얼룩 행에 남는다. */
const stainAt = (stain: PlaceStain): [number, number] | null => {
  const at: unknown = stain.at;
  return Array.isArray(at) && at.length === 2 && typeof at[0] === "number" && typeof at[1] === "number"
    ? [at[0], at[1]]
    : null;
};

/** 참석자류 조각 — 맵 모드 트레이 윗줄 + 사람 아이콘(UserCircle)으로 그린다. */
const isPerson = (id: string) => id.startsWith("참석자") || id.startsWith("진행자");

/** 배지·명패 색 어휘 → 표시색. 글자가 아니라 색으로 짝을 맞추는 규약(_SCHEMA.md 규칙 1)의
 *  표시층이다. 전부 어두운 바탕에서 4.5:1 이상 나오는 밝은 톤으로 고른다. */
const BADGE_COLORS: ReadonlyArray<readonly [string, string]> = [
  ["빨강", "#ff9191"],
  ["파랑", "#8dbcff"],
  ["초록", "#71dcaa"],
  ["노랑", "#ffd76e"],
  ["금", "#f2c14e"],
  ["회색", "#b9bfcc"],
];
const colorOf = (id: string) =>
  BADGE_COLORS.find(([word]) => id.includes(word))?.[1] ?? "#cfd5e8";

type DragRef = { key: string; pointerId: number; startX: number; startY: number; active: boolean };

export function PlaceGame({ game, onComplete }: EngineProps) {
  const data = game.data as PlaceData;
  const fitAny = data.fit === "any";
  const slots = useMemo(() => data.slots ?? [], [data.slots]);
  const stains = useMemo(() => data.stains ?? [], [data.stains]);
  const cues = data.visual_cues ?? {};

  // 같은 id가 여러 번 있으면 조각이 그만큼 있다는 뜻(cln-01 타월 2장 등) — 인스턴스 키로 구분
  const pieces = useMemo(
    () => (data.pieces ?? []).map((id, i) => ({ key: `${id}#${i}`, id })),
    [data.pieces],
  );
  const pieceIdByKey = useMemo(() => new Map(pieces.map((p) => [p.key, p.id])), [pieces]);

  const extraIds = useMemo(() => {
    const set = new Set<string>();
    for (const item of data.extras ?? []) set.add(typeof item === "string" ? item : item.id);
    return set;
  }, [data.extras]);

  const forbiddenRules = useMemo(() => data.forbidden ?? [], [data.forbidden]);
  const escalateTargets = useMemo(() => {
    const when = data.escalate?.when;
    const list = Array.isArray(when) ? when : typeof when === "string" ? [when] : [];
    return new Set(list);
  }, [data.escalate]);

  // 교체용 조각(cln-01 새_시트) — 어느 슬롯도 받지 않고 함정도 아닌 조각.
  // 슬롯 채점과 별개 채점 단위로 세지 않는다(이중 계산 금지 — _SCHEMA.md).
  const replacementIds = useMemo(() => {
    const accepted = new Set(slots.map((s) => s.accepts).filter((a): a is string => typeof a === "string"));
    const set = new Set<string>();
    for (const p of pieces) {
      if (accepted.has(p.id) || extraIds.has(p.id) || escalateTargets.has(p.id)) continue;
      if (forbiddenRules.some((r) => r.id === p.id)) continue;
      set.add(p.id);
    }
    return set;
  }, [slots, pieces, extraIds, escalateTargets, forbiddenRules]);

  // 씬 배경 로드 — scene 파일을 미리 로드해 '성공했을 때만' 씬 아트 맵 모드로 올린다.
  // 파일이 없으면(아트 미제작) 실패로 남아 기존 목록 렌더 그대로다.
  const sceneUrl = data.scene
    ? `${import.meta.env.BASE_URL}assets/minigames/${encodeURIComponent(data.scene)}.svg`
    : null;
  const [sceneOk, setSceneOk] = useState(false);
  useEffect(() => {
    setSceneOk(false);
    if (!sceneUrl) return;
    let alive = true;
    const probe = new Image();
    probe.onload = () => {
      if (alive) setSceneOk(true);
    };
    probe.src = sceneUrl;
    return () => {
      alive = false;
    };
  }, [sceneUrl]);

  // 맵 모드 게이트 — 위 docblock 참조. scene 게임은 씬 파일이 로드된 뒤에만 맵 모드다.
  const allLocated = useMemo(
    () => slots.length > 0 && slots.every((s) => slotAt(s) !== null),
    [slots],
  );
  const sceneArt = allLocated && sceneUrl !== null && sceneOk; // 도트 씬 배경 맵(hr-01·cln-01)
  const mapMode = allLocated && (data.scene ? sceneArt : true);

  // 얼룩 표시 분기(표시층만) — 씬 아트 맵에서는 at 있는 얼룩을 씬 위 오버레이로 그리고,
  // at 이 없거나 씬 아트 맵이 아니면(미래의 목록형 stains 게임 포함) 기존 행 UI 그대로다.
  // 어느 쪽이든 문지르기/교체는 같은 핸들러를 태운다 — resolve·채점 규약 불변.
  const stainsOnMap = sceneArt ? stains.filter((s) => stainAt(s) !== null) : [];
  const stainsInRow = sceneArt ? stains.filter((s) => stainAt(s) === null) : stains;

  // 맵 가구 지오메트리 — 데이터(슬롯 좌표)에서 유도한다. 씬 아트 배경이 깔리는
  // 게임(sceneArt)은 아트가 곧 가구라 유도 지오메트리를 그리지 않는다.
  // marker 있는 슬롯 = 좌석(의자를 그린다), 없는 슬롯 = 테이블 위 거치대(테이블 범위 산출).
  const mapScene = useMemo(() => {
    if (!mapMode || sceneArt) return null;
    const located = slots
      .map((slot) => ({ slot, at: slotAt(slot) }))
      .filter((e): e is { slot: PlaceSlot; at: [number, number] } => e.at !== null);
    const seats = located.filter((e) => e.slot.marker);
    const docks = located.filter((e) => !e.slot.marker);
    const anchor = (docks.length > 0 ? docks : located).map((e) => e.at);
    const xs = anchor.map((p) => p[0]);
    const ys = anchor.map((p) => p[1]);
    const table = {
      x: Math.min(...xs) - 100,
      y: Math.min(...ys) - 40,
      w: Math.max(...xs) - Math.min(...xs) + 200,
      h: Math.max(...ys) - Math.min(...ys) + 84,
    };
    const cx = table.x + table.w / 2;
    const cy = table.y + table.h / 2;
    const chairs = seats.map(({ slot, at: [x, y] }) => {
      const dx = x - cx;
      const dy = y - cy;
      const horiz = Math.abs(dx) > Math.abs(dy);
      // 등받이 — 테이블 반대쪽 면에 붙인다
      const back = horiz
        ? { x: x + Math.sign(dx) * 81 - 5, y: y - 30, w: 10, h: 60 }
        : { x: x - 30, y: y + Math.sign(dy) * 44 - 5, w: 60, h: 10 };
      return { id: slot.id, x, y, gold: (slot.marker ?? "").includes("금"), back };
    });
    return { table, chairs };
  }, [mapMode, sceneArt, slots]);

  const [placed, setPlaced] = useState<Record<string, string>>({}); // slotId → pieceKey
  const [selected, setSelected] = useState<string | null>(null); // pieceKey
  const [consumed, setConsumed] = useState<Record<string, boolean>>({}); // 얼룩 교체에 쓴 조각
  const [stainState, setStainState] = useState<Record<string, StainState>>({});
  const [escalated, setEscalated] = useState(false);
  const [wrongEvents, setWrongEvents] = useState(0); // fit:any — 잘못 꽂은 사건(빼도 유지)
  const [extrasUsed, setExtrasUsed] = useState<Record<string, boolean>>({}); // fit:any — 쓴 함정 조각
  const [done, setDone] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const finished = useRef(false);

  // 드래그 배치(맵 모드) — 포인터 이벤트라 터치도 같은 코드로 동작한다.
  // 클릭-선택 → 슬롯-클릭 폴백은 그대로 살아 있다(접근성·비포인터 환경).
  const [drag, setDrag] = useState<{ key: string; x: number; y: number } | null>(null);
  const [dropHover, setDropHover] = useState<string | null>(null);
  const dragRef = useRef<DragRef | null>(null);
  // 드래그 직후 따라오는 유령 click 무시 시한(wall-clock). 드롭이 성공하면 포인터 캡처를
  // 쥔 트레이 버튼이 언마운트되고, 브라우저가 뒤따르는 click을 포인터 아래 요소(=방금 채운
  // 슬롯)로 떨어뜨릴 수 있다. 이 click이 clickSlot의 '빈손 클릭 = 배치 해제'로 해석되면
  // 조각이 곧장 트레이로 되돌아가 "배치해도 트레이에 남는" 버그가 된다(ms-03 디자이너
  // 피드백) — 시한 안의 첫 click은 어느 핸들러가 받든 한 번만 소비하고 무시한다.
  const suppressClickUntil = useRef(0);

  /** 드래그 직후의 유령 click이면 소비하고 true — 트레이·슬롯 클릭 핸들러 공통 게이트. */
  const consumeGhostClick = () => {
    if (Date.now() >= suppressClickUntil.current) return false;
    suppressClickUntil.current = 0;
    return true;
  };

  const forbiddenAnywhere = (pieceId: string) =>
    forbiddenRules.some((r) => r.id === pieceId && !r.slots);
  const forbiddenAt = (pieceId: string, slotId: string) =>
    forbiddenRules.some((r) => r.id === pieceId && (!r.slots || r.slots.includes(slotId)));

  const escalateMode =
    typeof game.scoring?.escalate_mode === "string" ? game.scoring.escalate_mode : "대체";

  const finish = () => {
    if (finished.current) return;
    finished.current = true;

    const acceptSlots = slots.filter((s) => s.accepts != null);
    const slotCount = Math.max(1, scoringOf(game, "slot_count", acceptSlots.length));
    const stainCount = scoringOf(game, "stain_count", stains.length);

    const correctSlots = slots.filter((s) => {
      if (s.accepts == null) return false;
      const key = placed[s.id];
      return key != null && pieceIdByKey.get(key) === s.accepts;
    }).length;
    const resolvedStains = stains.filter((s) => stainState[s.id]?.resolved).length;

    // 감점 — 조각(사건)당 가장 무거운 것 하나만(중첩 금지)
    const placedSlotByKey = new Map(Object.entries(placed).map(([slotId, key]) => [key, slotId]));
    const slotById = new Map(slots.map((s) => [s.id, s]));
    let forbiddenCount = 0;
    let missedCount = 0;
    let extraCount = 0;
    let wrongCount = 0;

    for (const p of pieces) {
      const slotId = placedSlotByKey.get(p.key);
      const slot = slotId ? slotById.get(slotId) : undefined;
      const isTarget = escalateTargets.has(p.id);
      // 대체 모드의 보고 대상·전면 금지 조각: 배치=forbidden, 방치+미보고=missed
      if ((isTarget && escalateMode === "대체") || forbiddenAnywhere(p.id)) {
        if (slot) forbiddenCount += 1;
        else if (isTarget && !escalated) missedCount += 1;
        continue;
      }
      if (!slot) continue;
      if (forbiddenAt(p.id, slot.id)) {
        forbiddenCount += 1; // hr-01 이력서를 대기실·복도(오픈 공간)에 배치
        continue;
      }
      if (fitAny) continue; // fit:any 는 배치 '사건'에서 이미 셌다
      if (extraIds.has(p.id)) {
        extraCount += 1;
        continue;
      }
      if (slot.accepts !== p.id) wrongCount += 1;
    }
    if (fitAny) {
      extraCount = Object.keys(extrasUsed).length;
      wrongCount = wrongEvents;
    }
    if (escalateMode === "병행필수" && escalateTargets.size > 0 && !escalated) missedCount += 1;

    const raw =
      ((correctSlots + resolvedStains) / (slotCount + stainCount)) * 100 -
      forbiddenCount * scoringOf(game, "forbidden_penalty", 40) -
      missedCount * scoringOf(game, "missed_escalate_penalty", 40) -
      extraCount * scoringOf(game, "extra_penalty", 15) -
      wrongCount * scoringOf(game, "wrong_slot_penalty", 0);

    const score = clampScore(raw);
    setSummary({
      score,
      correctSlots,
      slotCount,
      resolvedStains,
      stainCount,
      wrongCount,
      extraCount,
      forbiddenCount,
      missedCount,
    });
    setDone(true);
    onComplete({
      accuracy: score,
      time_seconds: elapsedSeconds(startedAt),
      mistakes: forbiddenCount + missedCount + extraCount + wrongCount,
    });
  };

  const { remaining, startedAt } = useCountdown(game.time_limit, done, finish);

  const pickPiece = (key: string) => {
    if (done) return;
    setSelected((cur) => (cur === key ? null : key));
  };

  /** 조각을 슬롯에 놓는다 — 클릭 배치와 드래그 드롭이 같은 경로를 탄다(채점 규칙 단일화). */
  const placePiece = (slot: PlaceSlot, key: string) => {
    const pieceId = pieceIdByKey.get(key);
    if (!pieceId) return;
    // 배치(있던 조각은 카트로 교체 복귀)
    setPlaced((cur) => ({ ...cur, [slot.id]: key }));
    setSelected(null);
    if (fitAny) {
      // 사건당 감점 — 빼도 무효화되지 않는다. 함정 조각은 extra 감점 하나만(중첩 금지).
      if (extraIds.has(pieceId)) setExtrasUsed((cur) => ({ ...cur, [pieceId]: true }));
      else if (slot.accepts !== pieceId) setWrongEvents((n) => n + 1);
    }
  };

  const clickSlot = (slot: PlaceSlot) => {
    if (consumeGhostClick() || done) return;
    const existing = placed[slot.id];
    if (!selected) {
      // 빈손으로 채워진 슬롯 클릭 → 조각을 카트로 되돌린다(재배치 허용)
      if (existing) {
        setPlaced((cur) => {
          const next = { ...cur };
          delete next[slot.id];
          return next;
        });
      }
      return;
    }
    placePiece(slot, selected);
  };

  /** 뷰포트 좌표에서 드롭 대상 id — 맵 슬롯(data-slot-id)·씬 아트 얼룩(data-stain-id)을
   *  같은 규칙으로 판정한다. 드래그 고스트가 포인터 위쪽(-110%)에 떠 있어 사용자는
   *  '카드가 대상에 겹친' 순간 놓는다 — 포인터 지점이 살짝 빗나가면 고스트가 있던 위쪽
   *  지점들도 차례로 판정해, 드롭 미스로 조각이 트레이로 튕겨 돌아가는 것을 막는다
   *  (포인터 직격이 우선). dropHover 하이라이트도 같은 판정을 쓰므로 미리보기와 실제
   *  드롭이 늘 일치한다. 슬롯·얼룩 id 는 데이터에서 서로 겹치지 않는다. */
  const dropIdAtPoint = (x: number, y: number): string | null => {
    for (const lift of [0, 26, 52]) {
      const el = document.elementFromPoint(x, y - lift);
      const hit = el instanceof Element ? el.closest("[data-slot-id], [data-stain-id]") : null;
      const id = hit?.getAttribute("data-slot-id") ?? hit?.getAttribute("data-stain-id");
      if (id) return id;
    }
    return null;
  };

  const dragStart = (e: ReactPointerEvent<HTMLButtonElement>, key: string) => {
    if (done || dragRef.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragRef.current = { key, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, active: false };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 캡처 실패해도 클릭-선택 폴백이 있다
    }
  };

  const dragMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const st = dragRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    if (!st.active) {
      // 6px 임계 전에는 탭/클릭으로 취급 — 클릭 폴백과 충돌하지 않는다
      if (Math.hypot(e.clientX - st.startX, e.clientY - st.startY) < 6) return;
      st.active = true;
    }
    setDrag({ key: st.key, x: e.clientX, y: e.clientY });
    setDropHover(dropIdAtPoint(e.clientX, e.clientY));
  };

  const dragEnd = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const st = dragRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDrag(null);
    setDropHover(null);
    if (!st.active) return; // 이동 없는 탭 — 뒤따르는 click 이벤트가 선택을 토글한다
    // 유령 click 소비 시한 — 언마운트 재렌더 커밋이 끼어도 같은 제스처의 click 은 이 안에 온다
    suppressClickUntil.current = Date.now() + 250;
    if (done) return;
    const dropId = dropIdAtPoint(e.clientX, e.clientY);
    const slot = dropId ? slots.find((s) => s.id === dropId) : undefined;
    if (slot) {
      placePiece(slot, st.key);
      return;
    }
    // 씬 아트 얼룩에 드롭 — 클릭(선택 → 얼룩 탭) 경로와 같은 resolve 판정을 태운다
    const stain = dropId ? stains.find((s) => s.id === dropId) : undefined;
    if (stain) applyPieceToStain(stain, st.key);
  };

  const dragCancel = () => {
    dragRef.current = null;
    setDrag(null);
    setDropHover(null);
  };

  const clickTrayPiece = (key: string) => {
    if (consumeGhostClick()) return;
    pickPiece(key);
  };

  /** 손에 든/드래그한 조각을 얼룩에 적용 — 클릭 선택과 드래그 드롭이 같은 경로를
   *  탄다(resolve 판정 단일화). 성공 조건·상태 변화는 기존 클릭 규약 그대로다. */
  const applyPieceToStain = (stain: PlaceStain, key: string) => {
    const cur = stainState[stain.id] ?? { progress: 0, resolved: false, hint: null };
    if (cur.resolved) return;
    const resolve = stain.resolve ?? "문지르기";
    const pieceId = pieceIdByKey.get(key);
    if (resolve === "교체" && pieceId && replacementIds.has(pieceId)) {
      // 교체 조각을 얼룩 자리에 깐다 — 슬롯 채점과 별개(이중 계산 금지)
      setConsumed((used) => ({ ...used, [key]: true }));
      setSelected(null);
      setStainState((all) => ({ ...all, [stain.id]: { progress: 100, resolved: true, hint: null } }));
    } else {
      setStainState((all) => ({
        ...all,
        [stain.id]: { ...cur, hint: "이 조각으로는 처리할 수 없습니다" },
      }));
    }
  };

  const clickStain = (stain: PlaceStain) => {
    // 유령 click 게이트 — 맵 얼룩에 드롭한 직후 따라오는 click 이 '빈손 문지르기'로
    // 해석되지 않게 한다(목록 모드는 드래그가 없어 게이트가 항상 통과 — 동작 불변).
    if (consumeGhostClick() || done) return;
    const cur = stainState[stain.id] ?? { progress: 0, resolved: false, hint: null };
    if (cur.resolved) return;
    const resolve = stain.resolve ?? "문지르기";

    if (selected) {
      applyPieceToStain(stain, selected);
      return;
    }

    // 빈손 클릭 = 문지르기(연타)
    if (resolve === "문지르기") {
      const progress = Math.min(100, cur.progress + 25);
      setStainState((all) => ({
        ...all,
        [stain.id]: { progress, resolved: progress >= 100, hint: null },
      }));
    } else {
      // 교체 대상 — 문질러도 지워지지 않는 피드백으로 발견하게 한다(cln-01 돌발 근거)
      setStainState((all) => ({
        ...all,
        [stain.id]: {
          progress: Math.min(60, cur.progress + 20),
          resolved: false,
          hint: "문질러도 지워지지 않습니다 — 교체가 필요해 보입니다",
        },
      }));
    }
  };

  const verdictOf = (slot: PlaceSlot, pieceId: string | null): "ok" | "bad" | undefined =>
    done
      ? slot.accepts == null
        ? pieceId
          ? "bad"
          : "ok"
        : pieceId === slot.accepts
          ? "ok"
          : "bad"
      : undefined;

  const placedKeys = useMemo(() => new Set(Object.values(placed)), [placed]);
  const cartPieces = pieces.filter((p) => !placedKeys.has(p.key) && !consumed[p.key]);
  const personCart = cartPieces.filter((p) => isPerson(p.id));
  const propCart = cartPieces.filter((p) => !isPerson(p.id));
  // 참석자 조각이 아예 없는 게임(hr-01)은 트레이 참석자 줄 자체를 그리지 않는다
  // — 전부 배치한 뒤의 '모두 배치했습니다'(ms-03)와 구분한다.
  const hasPersonPieces = pieces.some((p) => isPerson(p.id));
  const filledCount = slots.filter((s) => s.accepts != null && placed[s.id]).length;
  const resolvedCount = stains.filter((s) => stainState[s.id]?.resolved).length;
  const acceptTotal = slots.filter((s) => s.accepts != null).length;
  const dragPieceId = drag ? pieceIdByKey.get(drag.key) ?? null : null;

  /** 슬롯 안에 배치된 조각 표시 — 사람은 색 배지 아이콘, 물건은 도트/라벨 칩. */
  const renderPlaced = (pieceId: string, compact: boolean) =>
    isPerson(pieceId) ? (
      <span className={styles.occupant} style={{ color: colorOf(pieceId) }}>
        <UserCircle size={compact ? 20 : 24} weight="fill" aria-hidden="true" />
        <span className={styles.occupantName}>{pretty(pieceId)}</span>
      </span>
    ) : (
      <span className={styles.dockItem} style={{ color: colorOf(pieceId) }}>
        <PixelSprite
          id={pieceId}
          label={pretty(pieceId)}
          size={compact ? 28 : 36}
          fallbackClassName={styles.dockPiece}
        />
      </span>
    );

  /** 맵 모드 트레이 조각 버튼 — 드래그와 클릭-선택 둘 다 받는다. */
  const trayButton = (p: { key: string; id: string }) => {
    const cue = cues[p.id];
    const person = isPerson(p.id);
    return (
      <button
        key={p.key}
        type="button"
        className={`${styles.piece} ${styles.trayPiece}${person ? ` ${styles.personPiece}` : ""}`}
        data-selected={selected === p.key}
        data-dragging={!done && drag && drag.key === p.key ? true : undefined}
        aria-pressed={selected === p.key}
        disabled={done}
        onClick={() => clickTrayPiece(p.key)}
        onPointerDown={(e) => dragStart(e, p.key)}
        onPointerMove={dragMove}
        onPointerUp={dragEnd}
        onPointerCancel={dragCancel}
        aria-label={`${pretty(p.id)} 조각${cue ? `, ${pretty(cue)}` : ""} — 드래그해 놓거나 눌러서 선택`}
      >
        {person ? (
          <span className={styles.personBody} style={{ color: colorOf(p.id) }}>
            <UserCircle size={26} weight="fill" aria-hidden="true" />
            <span className={styles.personName}>{pretty(p.id)}</span>
          </span>
        ) : (
          <PixelSprite id={p.id} label={pretty(p.id)} size={40} fallbackClassName={styles.pieceName} />
        )}
        {cue ? <span className={styles.pieceCue}>{pretty(cue)}</span> : null}
      </button>
    );
  };

  return (
    <div className={base.shell}>
      <GameHud
        label="배치 진행"
        count={filledCount + resolvedCount}
        total={acceptTotal + stains.length}
        remaining={remaining}
        timeLimit={game.time_limit}
      />

      {stainsInRow.length > 0 ? (
        <div className={styles.stainRow} role="group" aria-label="얼룩 정비">
          {stainsInRow.map((stain) => {
            const st = stainState[stain.id] ?? { progress: 0, resolved: false, hint: null };
            return (
              <button
                key={stain.id}
                type="button"
                className={styles.stain}
                data-resolved={st.resolved}
                disabled={done || st.resolved}
                onClick={() => clickStain(stain)}
                aria-label={`얼룩: ${pretty(stain.sprite ?? stain.id)}${st.resolved ? " (처리 완료)" : ""}`}
              >
                {stain.sprite ? (
                  // 얼룩 도트 스프라이트 — 파일이 없으면 기존 텍스트 칩으로 폴백(PixelSprite 규약)
                  <PixelSprite
                    id={stain.sprite}
                    label={pretty(stain.sprite)}
                    size={40}
                    fallbackClassName={styles.stainName}
                  />
                ) : (
                  <span className={styles.stainName}>{pretty(stain.id)}</span>
                )}
                <span className={styles.stainBar} aria-hidden="true">
                  <span className={styles.stainBarFill} style={{ width: `${st.progress}%` }} />
                </span>
                {st.resolved ? (
                  <span className={styles.stainDone}>처리 완료</span>
                ) : st.hint ? (
                  <span className={styles.stainHint}>{st.hint}</span>
                ) : (
                  <span className={styles.stainHint}>탭해서 문지르기</span>
                )}
              </button>
            );
          })}
        </div>
      ) : null}

      {mapMode ? (
        <div className={styles.mapWrap}>
          <div
            className={styles.mapBoard}
            data-art={sceneArt || undefined}
            role="group"
            aria-label={sceneArt && data.scene ? pretty(data.scene) : "회의실 배치도"}
          >
            {sceneArt && sceneUrl ? (
              // 도트 씬 배경(hr-01) — RouteGame map 패턴: 캔버스에 꽉 채움 + pixelated.
              // 렌더 중 파일이 사라지는 극단 케이스도 onError 로 목록 모드 폴백된다.
              <img
                className={styles.mapSceneArt}
                src={sceneUrl}
                alt=""
                draggable={false}
                aria-hidden="true"
                onError={() => setSceneOk(false)}
              />
            ) : (
            <svg
              className={styles.mapScene}
              viewBox={`0 0 ${SCENE.w} ${SCENE.h}`}
              aria-hidden="true"
              focusable="false"
            >
              {/* 바닥·벽·러그 — 위에서 본 회의실 */}
              <rect x="0" y="0" width={SCENE.w} height={SCENE.h} fill="#222741" />
              <rect
                x="6"
                y="6"
                width={SCENE.w - 12}
                height={SCENE.h - 12}
                rx="18"
                fill="none"
                stroke="#4a5380"
                strokeWidth="3"
              />
              <rect x="150" y="22" width="660" height="398" rx="26" fill="#273052" />
              {/* 출입문 표시 */}
              <rect x="40" y={SCENE.h - 14} width="90" height="8" rx="4" fill="#4a5380" />
              {mapScene ? (
                <>
                  {/* 회의 테이블 — 거치대 좌표 범위에서 유도 */}
                  <rect
                    x={mapScene.table.x}
                    y={mapScene.table.y}
                    width={mapScene.table.w}
                    height={mapScene.table.h}
                    rx="28"
                    fill="#3d466f"
                    stroke="#8b96c9"
                    strokeWidth="3"
                  />
                  <rect
                    x={mapScene.table.x + 14}
                    y={mapScene.table.y + 14}
                    width={mapScene.table.w - 28}
                    height={mapScene.table.h - 28}
                    rx="18"
                    fill="rgb(255 255 255 / 0.05)"
                  />
                  {/* 의자 — 좌석 슬롯 좌표. 상석(금색 단서)은 금색 의자 */}
                  {mapScene.chairs.map((c) => (
                    <g key={c.id}>
                      <rect
                        x={c.x - 75}
                        y={c.y - 36}
                        width={150}
                        height={72}
                        rx={16}
                        fill={c.gold ? "#5b471d" : "#2c3457"}
                        stroke={c.gold ? "#f2c14e" : "#8b96c9"}
                        strokeWidth={c.gold ? 3 : 2.5}
                      />
                      <rect
                        x={c.back.x}
                        y={c.back.y}
                        width={c.back.w}
                        height={c.back.h}
                        rx={5}
                        fill={c.gold ? "#f2c14e" : "#8b96c9"}
                        opacity={0.9}
                      />
                    </g>
                  ))}
                </>
              ) : null}
            </svg>
            )}
            {slots.map((slot) => {
              const at = slotAt(slot);
              if (!at) return null;
              const key = placed[slot.id];
              const pieceId = key ? pieceIdByKey.get(key) ?? null : null;
              const title = slot.label ?? pretty(slot.id);
              const seat = Boolean(slot.marker);
              const verdict = verdictOf(slot, pieceId);
              return (
                <button
                  key={slot.id}
                  type="button"
                  data-slot-id={slot.id}
                  className={styles.mapSlot}
                  data-kind={seat ? "seat" : "dock"}
                  data-filled={Boolean(pieceId)}
                  data-drop={!done && dropHover === slot.id ? true : undefined}
                  data-verdict={verdict}
                  disabled={done}
                  style={{ left: `${(at[0] / SCENE.w) * 100}%`, top: `${(at[1] / SCENE.h) * 100}%` }}
                  onClick={() => clickSlot(slot)}
                  aria-label={`${title} 슬롯${pieceId ? ` — ${pretty(pieceId)} 배치됨` : " — 비어 있음"}`}
                  title={sceneArt ? title : undefined}
                >
                  {slot.marker ? (
                    // 명패·의자 도트 아트가 있으면 그대로, 없으면 배지색 칩 폴백
                    <span className={styles.seatMarkerWrap} style={{ color: colorOf(slot.marker) }}>
                      <PixelSprite
                        id={slot.marker}
                        label={pretty(slot.marker)}
                        size={30}
                        fallbackClassName={styles.seatMarker}
                      />
                    </span>
                  ) : null}
                  {pieceId ? (
                    renderPlaced(pieceId, !seat)
                  ) : sceneArt ? (
                    // 씬 아트 위에선 가구가 자리를 설명한다 — 라벨 대신 컴팩트 드롭 패드
                    <span className={styles.mapEmptyPad}>＋</span>
                  ) : (
                    <span className={styles.mapEmpty}>빈 자리</span>
                  )}
                  {verdict ? (
                    <span className={styles.slotMark} data-ok={verdict === "ok"} aria-hidden="true">
                      {verdict === "ok" ? "✓" : "✕"}
                    </span>
                  ) : null}
                </button>
              );
            })}
            {/* 씬 아트 얼룩 오버레이(cln-01) — at 좌표 위에서 문지르기/교체를 그대로 받는다.
                문지른 만큼 도트가 옅어지고, 처리 완료면 체크 패드만 남는다. */}
            {stainsOnMap.map((stain) => {
              const at = stainAt(stain);
              if (!at) return null;
              const st = stainState[stain.id] ?? { progress: 0, resolved: false, hint: null };
              const cue = cues[stain.id];
              const name = pretty(stain.sprite ?? stain.id);
              return (
                <button
                  key={stain.id}
                  type="button"
                  data-stain-id={stain.id}
                  className={styles.mapStain}
                  data-resolved={st.resolved}
                  data-drop={!done && dropHover === stain.id ? true : undefined}
                  disabled={done || st.resolved}
                  style={{ left: `${(at[0] / SCENE.w) * 100}%`, top: `${(at[1] / SCENE.h) * 100}%` }}
                  onClick={() => clickStain(stain)}
                  title={cue ? `${name} — ${pretty(cue)}` : name}
                  aria-label={`얼룩: ${name}${cue ? `, ${pretty(cue)}` : ""}${
                    st.resolved ? " (처리 완료)" : st.hint ? ` — ${st.hint}` : " — 탭해서 문지르기"
                  }`}
                >
                  {st.resolved ? (
                    <span className={styles.mapStainDone} aria-hidden="true">
                      ✓
                    </span>
                  ) : (
                    <>
                      <span
                        className={styles.mapStainArt}
                        style={{ opacity: 1 - (st.progress / 100) * 0.85 }}
                      >
                        <PixelSprite
                          id={stain.sprite ?? stain.id}
                          label={name}
                          size={34}
                          fallbackClassName={styles.mapStainName}
                        />
                      </span>
                      {st.progress > 0 ? (
                        <span className={styles.stainBar} aria-hidden="true">
                          <span className={styles.stainBarFill} style={{ width: `${st.progress}%` }} />
                        </span>
                      ) : null}
                      {st.hint ? <span className={styles.mapStainHint}>{st.hint}</span> : null}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className={styles.board} role="group" aria-label="배치판">
          {slots.map((slot) => {
            const key = placed[slot.id];
            const pieceId = key ? pieceIdByKey.get(key) ?? null : null;
            const title = slot.label ?? pretty(slot.id);
            // fit:any 만 실시간 피드백 — 정답 구간이 미배치·오배치면 계속 새는 표시
            const leaking = fitAny && !done && slot.accepts != null && pieceId !== slot.accepts;
            const plugged = fitAny && !done && slot.accepts != null && pieceId === slot.accepts;
            const verdict = verdictOf(slot, pieceId);
            return (
              <button
                key={slot.id}
                type="button"
                className={styles.slot}
                data-filled={Boolean(pieceId)}
                data-leak={leaking || undefined}
                data-verdict={verdict}
                disabled={done}
                onClick={() => clickSlot(slot)}
                aria-label={`${title} 슬롯${pieceId ? ` — ${pretty(pieceId)} 배치됨` : " — 비어 있음"}`}
              >
                {slot.marker ? (
                  <PixelSprite
                    id={slot.marker}
                    label={pretty(slot.marker)}
                    size={44}
                    fallbackClassName={styles.marker}
                  />
                ) : null}
                <span className={styles.slotTitle}>{title}</span>
                {pieceId ? (
                  <PixelSprite
                    id={pieceId}
                    label={pretty(pieceId)}
                    size={48}
                    fallbackClassName={styles.placedPiece}
                  />
                ) : (
                  <span className={styles.emptyMark}>빈 자리</span>
                )}
                {leaking ? (
                  <span className={styles.leakBadge} aria-hidden="true">
                    새는 중
                  </span>
                ) : null}
                {plugged ? (
                  <span className={styles.pluggedBadge} aria-hidden="true">
                    막힘
                  </span>
                ) : null}
                {verdict ? (
                  <span className={styles.slotMark} data-ok={verdict === "ok"} aria-hidden="true">
                    {verdict === "ok" ? "✓" : "✕"}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {mapMode ? (
        <div className={styles.tray} role="group" aria-label="조각 트레이">
          {hasPersonPieces ? (
            <div className={styles.trayRow} role="group" aria-label="참석자 조각">
              <span className={styles.trayLabel}>참석자</span>
              <div className={styles.trayItems}>
                {personCart.length > 0 ? (
                  personCart.map(trayButton)
                ) : (
                  <span className={styles.cartEmpty}>모두 배치했습니다</span>
                )}
              </div>
            </div>
          ) : null}
          <div className={styles.trayRow} role="group" aria-label="자료와 소품 조각">
            <span className={styles.trayLabel}>자료·소품</span>
            <div className={styles.trayItems}>
              {propCart.length > 0 ? (
                propCart.map(trayButton)
              ) : (
                <span className={styles.cartEmpty}>모두 배치했습니다</span>
              )}
            </div>
          </div>
          <p className={styles.trayHint}>
            조각을 드래그해 배치도 자리에 놓거나, 조각을 누른 뒤 자리를 누르세요.
          </p>
        </div>
      ) : (
        <div className={styles.cart} role="group" aria-label="조각 카트">
          {cartPieces.length > 0 ? (
            cartPieces.map((p) => {
              const cue = cues[p.id];
              return (
                <button
                  key={p.key}
                  type="button"
                  className={styles.piece}
                  data-selected={selected === p.key}
                  aria-pressed={selected === p.key}
                  disabled={done}
                  onClick={() => pickPiece(p.key)}
                  aria-label={`${pretty(p.id)} 조각${cue ? `, ${pretty(cue)}` : ""}`}
                >
                  <PixelSprite
                    id={p.id}
                    label={pretty(p.id)}
                    size={48}
                    fallbackClassName={styles.pieceName}
                  />
                  {cue ? <span className={styles.pieceCue}>{pretty(cue)}</span> : null}
                </button>
              );
            })
          ) : (
            <span className={styles.cartEmpty}>카트가 비었습니다</span>
          )}
        </div>
      )}

      {!done ? (
        <div className={styles.footer}>
          {data.escalate ? (
            <button
              type="button"
              className={styles.escalateButton}
              data-on={escalated}
              aria-pressed={escalated}
              onClick={() => setEscalated((v) => !v)}
            >
              {escalated ? `${data.escalate.label ?? "보고"} 완료` : data.escalate.label ?? "보고"}
            </button>
          ) : null}
          <button type="button" className={styles.submitButton} onClick={finish}>
            배치 완료 제출
          </button>
        </div>
      ) : null}

      {/* !done — 제한시간이 드래그 도중 끝나면 버튼이 disabled 되어 pointerup 이 오지 않아
          고스트가 화면에 남는다. 종료 후엔 그리지 않는 것으로 정리한다. */}
      {drag && dragPieceId && !done
        ? createPortal(
            <div className={styles.dragGhost} style={{ left: drag.x, top: drag.y }} aria-hidden="true">
              {isPerson(dragPieceId) ? (
                <span className={styles.personBody} style={{ color: colorOf(dragPieceId) }}>
                  <UserCircle size={24} weight="fill" />
                  <span className={styles.personName}>{pretty(dragPieceId)}</span>
                </span>
              ) : (
                <PixelSprite
                  id={dragPieceId}
                  label={pretty(dragPieceId)}
                  size={36}
                  fallbackClassName={styles.pieceName}
                />
              )}
            </div>,
            document.body,
          )
        : null}

      {done && summary ? (
        <ResultBar score={summary.score}>
          자리{" "}
          <b>
            {summary.correctSlots}/{summary.slotCount}
          </b>
          {summary.stainCount > 0 ? (
            <>
              {" · "}얼룩{" "}
              <b>
                {summary.resolvedStains}/{summary.stainCount}
              </b>
            </>
          ) : null}
          {summary.wrongCount > 0 ? (
            <>
              {" · "}잘못 놓음 <b>{summary.wrongCount}건</b>
            </>
          ) : null}
          {summary.extraCount > 0 ? (
            <>
              {" · "}두면 안 되는 것 배치 <b>{summary.extraCount}건</b>
            </>
          ) : null}
          {summary.forbiddenCount > 0 ? (
            <>
              {" · "}금지행동 <b>{summary.forbiddenCount}건</b>
            </>
          ) : null}
          {summary.missedCount > 0 ? (
            <>
              {" · "}보고 누락 <b>{summary.missedCount}건</b>
            </>
          ) : null}
        </ResultBar>
      ) : null}
    </div>
  );
}
