import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import shared from "../../../styles/minigame.module.css";
import { PixelSprite } from "./PixelSprite";
import { SCENE } from "./types";
import styles from "../../../styles/sequenceGame.module.css";
import {
  clampScore,
  elapsedSeconds,
  failResult,
  GameHud,
  ResultBar,
  scoringOf,
  useCountdown,
  type EngineProps,
} from "./shared";

/**
 * sequence 엔진 — 정해진 절차 순서대로 수행한다. ys-02·ys-10·ms-10 3종.
 *
 * 표시층 두 가지(채점 계약은 동일):
 * - 카드 모드(ys-02·ys-10): 카드(steps + forbidden)가 무작위로 섞여 깔리고,
 *   클릭 순서가 곧 답이다.
 * - 현장 맵 모드(ms-10): 모든 step에 at:[x,y](논리 캔버스 960×440)가 있으면
 *   트렌치 단면 맵 위에 자리(spot)를 그리고, 하단 트레이의 자재를 드래그
 *   (포인터 이벤트 + 클릭-선택→자리-클릭 폴백)해 배치한다. 자재는 자기 자리에만
 *   물리적으로 들어간다 — 다른 자리에 떨어뜨리면 감점 없이 튕긴다(모양 불일치).
 *   마지막 스텝(마감 타일)은 드래그가 아니라 "마감하기" 버튼 — 타일을 덮고
 *   제출까지 한 번에 한다. 일찍 누르면 순서 위반 그대로다.
 *   forbidden 은 맵 위 함정 오브젝트(드래그 대상 아님) — 클릭하면 감점.
 *   ⚠ 맵 씬(SVG)은 ms-10 트렌치 단면 고정 아트(장식층)다. 자리·함정 위치는
 *   전부 at 좌표 데이터로 그린다.
 *
 * 공통 규칙:
 * - wrong_order_fail(또는 wrong_order: fail): 틀린 순서 수행 = 즉시 실패.
 *   ys-02 는 partial_credit — 실패해도 그때까지 밟은 단계만큼 accuracy 에 반영.
 * - forbidden: forbidden_fail(또는 forbidden: fail)이면 즉시 실패,
 *   아니면 forbidden_penalty(기본 40) 감점 후 계속(ms-10).
 * - fit(ms-10): fit 필드가 있는 스텝은 선행 스텝 완료 전엔 잠긴다 — 배관이
 *   앉아야 클립 받침이 드러나는 물리 게이트라 배치 자체가 안 된다(감점 없음).
 *
 * 카드 앞면·자재 트레이는 sprite 자리표시만 보여주고(라벨은 정답 유출 방지를
 * 위해 완료 후 공개), 실패 사유·금지 사유는 위반 후에만 드러난다.
 */

type StepDef = {
  id: string;
  index: number;
  sprite?: string;
  label?: string;
  fit?: string;
  at?: [number, number];
  zone?: string;
};
type ForbiddenDef = { id: string; sprite?: string; reason?: string; at?: [number, number] };
type Card =
  | { kind: "step"; id: string; face: string; step: StepDef }
  | { kind: "forbidden"; id: string; face: string; forbidden: ForbiddenDef };

type Outcome = { score: number; failReason: string | null; detail: string };

/* ── YAML(unknown) 안전 파싱 ── */

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function nonNull<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined;
}
/** at 이 숫자 [x, y] 쌍일 때만 좌표로 인정한다(데이터 방어 — PlaceGame과 같은 규약). */
function atOf(v: unknown): [number, number] | undefined {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number"
    ? [v[0], v[1]]
    : undefined;
}
const pretty = (id: string) => id.replace(/_/g, " ");
const faceOf = (step: StepDef) => pretty(step.sprite ?? step.id);

/** fail 플래그 — 불리언 키(ys-10·ms-10)와 문자열 "fail"(ys-02) 두 표기를 모두 읽는다. */
function failFlag(scoring: Record<string, unknown>, boolKey: string, strKey: string, fallback: boolean): boolean {
  if (boolKey in scoring) return scoring[boolKey] === true;
  if (strKey in scoring) return scoring[strKey] === "fail";
  return fallback;
}

/** Fisher–Yates 셔플 — 프론트 런타임이므로 Math.random 사용. */
function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

type DragRef = { id: string; pointerId: number; startX: number; startY: number; active: boolean };

/* ── 컴포넌트 ── */

export function SequenceGame({ game, onComplete }: EngineProps) {
  const model = useMemo(() => {
    const steps = asArray(game.data.steps)
      .map(asRecord)
      .filter(nonNull)
      .map(
        (s, i): StepDef => ({
          id: str(s.id) ?? `단계_${i + 1}`,
          index: i,
          sprite: str(s.sprite),
          label: str(s.label),
          fit: str(s.fit),
          at: atOf(s.at),
          zone: str(s.zone),
        }),
      );
    const forbidden = asArray(game.data.forbidden)
      .map(asRecord)
      .filter(nonNull)
      .map(
        (f, i): ForbiddenDef => ({
          id: str(f.id) ?? `금지_${i + 1}`,
          sprite: str(f.sprite),
          reason: str(f.reason),
          at: atOf(f.at),
        }),
      );
    return { steps, forbidden };
  }, [game]);

  // 현장 맵 모드 게이트 — 모든 스텝에 좌표가 있어야 한다(ms-10). 아니면 카드 UI(ys-02·ys-10).
  const mapMode = model.steps.length > 1 && model.steps.every((s) => s.at !== undefined);
  const finishStep = mapMode ? model.steps[model.steps.length - 1] : undefined;

  // 마운트 시 1회 셔플 — steps 와 forbidden 을 섞어 순서 단서를 없앤다 (카드 모드)
  const cards = useMemo<Card[]>(
    () =>
      shuffle([
        ...model.steps.map((step): Card => ({ kind: "step", id: step.id, face: faceOf(step), step })),
        ...model.forbidden.map(
          (f): Card => ({ kind: "forbidden", id: f.id, face: pretty(f.sprite ?? f.id), forbidden: f }),
        ),
      ]),
    [model],
  );

  // 맵 모드 자재 트레이 — 마지막 스텝(마감 타일 = 버튼)만 빼고 섞는다. 순서 단서 제거.
  const traySteps = useMemo<StepDef[]>(
    () => (mapMode ? shuffle(model.steps.slice(0, -1)) : []),
    [model, mapMode],
  );

  const scoring = game.scoring ?? {};
  const wrongOrderFail = failFlag(scoring, "wrong_order_fail", "wrong_order", true); // 안전 절차 — 기본 즉시 실패
  const forbiddenFail = failFlag(scoring, "forbidden_fail", "forbidden", false);
  const partialCredit = scoring["partial_credit"] === true;
  const forbiddenPenalty = scoringOf(game, "forbidden_penalty", 40);
  const wrongOrderPenalty = scoringOf(game, "wrong_order_penalty", 10); // 비실패 모드 폴백(현재 데이터 미사용)
  const stepCount = Math.max(1, scoringOf(game, "step_count", model.steps.length));

  const [progress, setProgress] = useState(0);
  const [forbiddenHits, setForbiddenHits] = useState<string[]>([]);
  const [slips, setSlips] = useState(0);
  const [failCardId, setFailCardId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const finished = useRef(false);
  const done = outcome !== null;

  // 드래그 배치(맵 모드) — PlaceGame과 같은 포인터 이벤트 패턴. 터치도 같은 코드로 동작하고
  // 클릭-선택 → 자리-클릭 폴백이 그대로 살아 있다(접근성·비포인터 환경).
  const [selected, setSelected] = useState<string | null>(null); // step id
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dropHover, setDropHover] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const dragRef = useRef<DragRef | null>(null);
  const suppressClick = useRef(false); // 드래그 직후 따라오는 click으로 선택이 토글되는 것 방지

  const { remaining, startedAt } = useCountdown(game.time_limit, done, () => conclude(progress, true));

  /** 즉시 실패 — partial_credit(ys-02)이면 그때까지 밟은 단계만큼 반영해 보낸다. */
  function fail(reason: string, cardId: string) {
    if (finished.current) return;
    finished.current = true;
    setFailCardId(cardId);
    const mistakes = forbiddenHits.length + slips + 1;
    if (partialCredit) {
      const score = clampScore((progress / stepCount) * 100);
      setOutcome({
        score,
        failReason: `${reason} — ${progress}/${stepCount} 단계까지는 정확 (부분 반영 ${score}점)`,
        detail: "",
      });
      onComplete({ accuracy: score, time_seconds: elapsedSeconds(startedAt), mistakes });
    } else {
      setOutcome({ score: 0, failReason: reason, detail: "" });
      onComplete(failResult(startedAt, mistakes));
    }
  }

  /** 완주 또는 시간 만료 — 밟은 단계 비율에서 감점(중첩 없이 사건당 하나)을 뺀다. */
  function conclude(finalProgress: number, timedOut: boolean) {
    if (finished.current) return;
    finished.current = true;
    const forbiddenSum = forbiddenHits.length * forbiddenPenalty;
    const slipSum = slips * wrongOrderPenalty;
    const score = clampScore((finalProgress / stepCount) * 100 - forbiddenSum - slipSum);
    const parts = [
      timedOut ? `시간 초과 — ${finalProgress}/${stepCount} 단계까지 진행` : `절차 ${finalProgress}/${stepCount} 단계 완료`,
    ];
    if (forbiddenHits.length > 0) parts.push(`금지행동 ${forbiddenHits.length}회 −${forbiddenSum}`);
    if (slips > 0) parts.push(`순서 착오 ${slips}회 −${slipSum}`);
    if (forbiddenHits.length === 0 && slips === 0) parts.push("위반 없음");
    setOutcome({ score, failReason: null, detail: parts.join(" · ") });
    onComplete({ accuracy: score, time_seconds: elapsedSeconds(startedAt), mistakes: forbiddenHits.length + slips });
  }

  /** 금지행동 — 카드 클릭(카드 모드)과 함정 오브젝트 클릭(맵 모드)이 같은 규칙을 탄다. */
  function hitForbidden(f: ForbiddenDef) {
    if (finished.current) return;
    if (forbiddenFail) {
      fail(f.reason ?? "금지행동입니다", f.id);
      return;
    }
    // 감점 모드(ms-10) — 같은 항목은 한 번만 세고, 사유를 드러낸 채 계속 진행
    if (!forbiddenHits.includes(f.id)) setForbiddenHits((cur) => [...cur, f.id]);
    setHint(f.reason ?? "금지행동입니다 — 감점되었습니다");
  }

  /** 스텝 수행 — 카드 클릭과 맵 배치가 같은 경로를 탄다(순서 규칙 단일화). */
  function performStep(step: StepDef) {
    if (finished.current) return;
    if (step.fit !== undefined && step.index > progress) return; // fit 게이트 — 받침 미노출(감점 없음)
    if (step.index === progress) {
      setSelected(null);
      setHint(null);
      const next = progress + 1;
      setProgress(next);
      if (next >= model.steps.length) conclude(next, false);
      return;
    }
    if (step.index < progress) return; // 이미 완료된 스텝
    if (wrongOrderFail) {
      fail(`절차 순서 위반 — '${faceOf(step)}' 차례가 아닙니다`, step.id);
      return;
    }
    setSlips((cur) => cur + 1);
    setHint("순서 착오 — 감점되었습니다");
  }

  function clickCard(card: Card) {
    if (finished.current) return;
    if (card.kind === "forbidden") {
      hitForbidden(card.forbidden);
      return;
    }
    performStep(card.step);
  }

  /** fit 게이트(ms-10) — fit 스텝은 바로 앞 스텝이 끝나기 전엔 잠긴다(받침 미노출). */
  const lockedOf = (step: StepDef): boolean => step.fit !== undefined && step.index > progress;

  /* ── 맵 모드 상호작용 ── */

  /** 마감하기 — 마지막 스텝을 수행하고, 완주면 conclude가 제출까지 한 번에 한다. */
  function clickFinish() {
    if (finished.current || !finishStep) return;
    if (progress < finishStep.index && wrongOrderFail) {
      fail("아직 매립 자재가 남았는데 마감 타일을 덮으면 재작업입니다", finishStep.id);
      return;
    }
    performStep(finishStep);
  }

  /** 자재를 자리에 놓는 시도 — 드래그 드롭과 클릭 폴백이 같은 경로를 탄다.
   *  자기 자리가 아니면 모양 불일치로 튕긴다(감점 없음 — 물리적으로 안 들어간다).
   *  자기 자리라도 차례가 아니면 순서 규칙(performStep)이 그대로 잡는다. */
  function tryPlace(stepId: string, spotId: string) {
    const step = model.steps.find((s) => s.id === stepId);
    if (!step || finished.current) return;
    if (spotId !== step.id) {
      setHint(`'${faceOf(step)}' 은(는) 이 자리에 모양이 맞지 않습니다`);
      return;
    }
    performStep(step);
  }

  /** 뷰포트 좌표에서 드롭 대상 자리 id — 활성 자리 버튼의 data-spot-id 로 판정한다. */
  const spotIdAtPoint = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y);
    const hit = el instanceof Element ? el.closest("[data-spot-id]") : null;
    return hit?.getAttribute("data-spot-id") ?? null;
  };

  const dragStart = (e: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (done || dragRef.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragRef.current = { id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, active: false };
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
    setDrag({ id: st.id, x: e.clientX, y: e.clientY });
    setDropHover(spotIdAtPoint(e.clientX, e.clientY));
  };

  const dragEnd = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const st = dragRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDrag(null);
    setDropHover(null);
    if (!st.active) return; // 이동 없는 탭 — 뒤따르는 click 이벤트가 선택을 토글한다
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    if (done) return;
    const spotId = spotIdAtPoint(e.clientX, e.clientY);
    if (spotId) tryPlace(st.id, spotId);
  };

  const dragCancel = () => {
    dragRef.current = null;
    setDrag(null);
    setDropHover(null);
  };

  const clickTrayPiece = (id: string) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (done) return;
    setSelected((cur) => (cur === id ? null : id));
  };

  const clickSpot = (step: StepDef) => {
    if (finished.current) return;
    if (!selected) {
      setHint("아래 트레이에서 자재를 드래그하거나, 눌러 선택한 뒤 자리를 누르세요");
      return;
    }
    tryPlace(selected, step.id);
  };

  const dragStep = drag ? model.steps.find((s) => s.id === drag.id) : undefined;
  const pct = (at: [number, number]) => ({
    left: `${(at[0] / SCENE.w) * 100}%`,
    top: `${(at[1] / SCENE.h) * 100}%`,
  });
  const allPlaced = finishStep !== undefined && progress >= finishStep.index; // 매립 자재 5종 완료
  const covered = progress >= model.steps.length; // 마감 타일까지 완료
  // 클립 받침(장식층) — 전선관 fit 스텝이 열리는 시점에 SVG 받침을 함께 노출한다
  const clipStep = model.steps.find((s) => s.fit !== undefined && s.fit.includes("클립"));
  const clipShown = clipStep !== undefined && progress >= clipStep.index;

  /* ── 렌더 ── */

  const mapBoard = mapMode ? (
    <>
      <div className={styles.mapWrap}>
        <div
          className={styles.mapBoard}
          role="group"
          aria-label={`${game.title} — 자재를 트렌치의 맞는 자리에 순서대로 놓으세요`}
        >
          <svg
            className={styles.mapScene}
            viewBox={`0 0 ${SCENE.w} ${SCENE.h}`}
            aria-hidden="true"
            focusable="false"
          >
            {/* 현장 하늘 + 지반 — 트렌치 단면(옆에서 본 뷰) */}
            <rect width={SCENE.w} height={SCENE.h} fill="#222741" />
            <rect x="0" y="150" width={SCENE.w} height={SCENE.h - 150} fill="#43351f" />
            {/* 흙 질감 — 개착부(x300~660) 밖에만 */}
            {[
              [60, 200], [150, 262], [92, 330], [212, 300], [232, 182], [176, 392], [58, 402],
              [716, 210], [802, 302], [878, 240], [762, 382], [902, 392], [706, 330],
            ].map(([x, y]) => (
              <rect key={`${x}-${y}`} x={x} y={y} width="9" height="9" rx="2" fill="#5d4a30" />
            ))}
            {/* 지표선 */}
            <rect x="0" y="146" width={SCENE.w} height="6" fill="#6b5636" />
            {/* 트렌치 개착부 + 벽·바닥 윤곽 */}
            <rect x="300" y="150" width="360" height="254" fill="#1c1526" />
            <path d="M300 150 V404 H660 V150" fill="none" stroke="#8a7148" strokeWidth="4" />
            {/* 바닥 큰 반원 홈 — 배관이 앉는 자리 */}
            <path d="M452 404 A28 28 0 0 0 508 404 Z" fill="#120d1d" stroke="#8a7148" strokeWidth="3" />
            {/* 왼쪽 벽 구멍 — 미확인 배관이 튀어나온 자리(함정) */}
            <circle cx="303" cy="248" r="14" fill="#120d1d" stroke="#8a7148" strokeWidth="3" />
            {/* 클립 받침 — 배관이 앉아야 드러난다(fit 게이트의 장식층) */}
            {clipShown ? (
              <g>
                <rect x="456" y="304" width="10" height="22" fill="#8b96c9" />
                <rect x="494" y="304" width="10" height="22" fill="#8b96c9" />
                <rect x="450" y="298" width="60" height="7" rx="3" fill="#aab4dd" />
              </g>
            ) : null}
            {/* 확인 표지판 — 선행공정 확인 자리 */}
            <rect x="146" y="96" width="8" height="54" fill="#8a7148" />
            <rect x="103" y="58" width="94" height="60" rx="6" fill="#2c3457" stroke="#8b96c9" strokeWidth="2.5" />
            {/* 우상단 현장 게시판 — 구두지시 메모(함정)가 붙는 자리 */}
            <rect x="806" y="30" width="58" height="16" rx="4" fill="#4a5380" />
            <rect x="768" y="46" width="134" height="88" rx="8" fill="#2c3457" stroke="#8b96c9" strokeWidth="2.5" />
            {/* 마감 타일 — 마감하기 후 개착부를 덮는다 */}
            {covered ? (
              <g>
                <rect x="296" y="130" width="368" height="22" rx="4" fill="#5a6a92" stroke="#8b96c9" strokeWidth="2" />
                {[342, 388, 434, 480, 526, 572, 618].map((x) => (
                  <rect key={x} x={x} y="132" width="3" height="18" fill="#222741" />
                ))}
              </g>
            ) : null}
          </svg>

          {/* 자리(spot) — at 좌표 데이터로 그린다 */}
          {model.steps.map((step) => {
            if (!step.at) return null;
            const zone = pretty(step.zone ?? step.id);
            const isFail = failCardId === step.id;
            const stepDone = step.index < progress;
            // 마지막 스텝 = 마감 구역 — 드롭 대상이 아니라 "마감하기" 버튼이 덮는다
            if (finishStep && step.id === finishStep.id) {
              return (
                <div
                  key={step.id}
                  className={styles.tileZone}
                  data-ready={!done && allPlaced && !covered ? true : undefined}
                  data-state={isFail ? "fail" : covered ? "done" : undefined}
                  style={pct(step.at)}
                >
                  {covered ? (
                    <span className={styles.order} aria-hidden="true">
                      {step.index + 1}
                    </span>
                  ) : null}
                  <span className={styles.zoneLabel}>
                    {covered ? (step.label ?? zone) : `${zone} — 마감하기로 덮기`}
                  </span>
                </div>
              );
            }
            if (stepDone) {
              return (
                <div key={step.id} className={styles.mapSpot} data-state={isFail ? "fail" : "done"} style={pct(step.at)}>
                  <span className={styles.order} aria-hidden="true">
                    {step.index + 1}
                  </span>
                  <PixelSprite id={step.sprite ?? ""} label={faceOf(step)} size={44} fallbackClassName={styles.face} />
                  {step.label ? <span className={styles.stepLabel}>{step.label}</span> : null}
                </div>
              );
            }
            if (lockedOf(step)) {
              return (
                <div key={step.id} className={styles.mapSpot} data-state="locked" style={pct(step.at)}>
                  <span className={styles.zoneLabel}>{zone}</span>
                  <span className={styles.lockTag}>잠김</span>
                </div>
              );
            }
            return (
              <button
                key={step.id}
                type="button"
                data-spot-id={step.id}
                className={styles.mapSpot}
                data-state={isFail ? "fail" : undefined}
                data-drop={dropHover === step.id ? true : undefined}
                disabled={done}
                style={pct(step.at)}
                onClick={() => clickSpot(step)}
                aria-label={`자리: ${zone} — 비어 있음`}
              >
                <span className={styles.zoneLabel}>{zone}</span>
                <span className={styles.spotEmpty}>빈 자리</span>
              </button>
            );
          })}

          {/* 함정 오브젝트(forbidden) — 드래그 대상이 아니라 클릭하면 감점 */}
          {model.forbidden.map((f, i) => {
            const at = f.at ?? [880, 60 + i * 90]; // 좌표 누락 방어 — 우측 여백에 세워둔다
            const hit = forbiddenHits.includes(f.id);
            const isFail = failCardId === f.id;
            return (
              <button
                key={f.id}
                type="button"
                className={styles.trap}
                data-state={isFail ? "fail" : hit ? "hit" : undefined}
                disabled={done || hit}
                style={pct(at)}
                onClick={() => hitForbidden(f)}
                aria-label={pretty(f.sprite ?? f.id)}
              >
                <PixelSprite id={f.sprite ?? ""} label={pretty(f.sprite ?? f.id)} size={40} fallbackClassName={styles.face} />
                {hit ? <span className={styles.trapTag}>금지행동</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* 자재 트레이 — 드래그와 클릭-선택 둘 다 받는다 */}
      <div className={styles.tray} role="group" aria-label="자재 트레이">
        <span className={styles.trayLabel}>자재</span>
        <div className={styles.trayItems}>
          {traySteps.filter((s) => s.index >= progress).length > 0 ? (
            traySteps
              .filter((s) => s.index >= progress)
              .map((step) => (
                <button
                  key={step.id}
                  type="button"
                  className={styles.trayPiece}
                  data-selected={selected === step.id}
                  data-dragging={drag && drag.id === step.id ? true : undefined}
                  aria-pressed={selected === step.id}
                  disabled={done}
                  onClick={() => clickTrayPiece(step.id)}
                  onPointerDown={(e) => dragStart(e, step.id)}
                  onPointerMove={dragMove}
                  onPointerUp={dragEnd}
                  onPointerCancel={dragCancel}
                  aria-label={`${faceOf(step)} 자재 — 드래그해 놓거나 눌러서 선택`}
                >
                  <PixelSprite id={step.sprite ?? ""} label={faceOf(step)} size={44} fallbackClassName={styles.face} />
                </button>
              ))
          ) : (
            <span className={styles.trayEmpty}>자재를 모두 깔았습니다 — 마감하기를 누르세요</span>
          )}
        </div>
      </div>

      <p className={styles.hint} role="status">
        {hint ?? "자재를 맞는 자리에 순서대로 놓고, 다 깔았으면 '마감하기'로 덮어 제출하세요."}
      </p>

      {!done ? (
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.finishButton}
            data-ready={allPlaced || undefined}
            onClick={clickFinish}
          >
            마감하기 — 타일 덮고 제출
          </button>
        </div>
      ) : null}

      {drag && dragStep
        ? createPortal(
            <div className={styles.dragGhost} style={{ left: drag.x, top: drag.y }} aria-hidden="true">
              <PixelSprite id={dragStep.sprite ?? ""} label={faceOf(dragStep)} size={38} fallbackClassName={styles.face} />
            </div>,
            document.body,
          )
        : null}
    </>
  ) : null;

  const cardBoard = !mapMode ? (
    <div className={styles.board} role="group" aria-label={`${game.title} — 카드를 절차 순서대로 누르세요`}>
      {cards.map((card) => {
        const locked = card.kind === "step" && lockedOf(card.step);
        const stepDone = card.kind === "step" && card.step.index < progress;
        const hit = card.kind === "forbidden" && forbiddenHits.includes(card.id);
        const isFailCard = failCardId === card.id;
        const state = isFailCard ? "fail" : stepDone ? "done" : hit ? "hit" : locked ? "locked" : undefined;
        const ariaSuffix = locked
          ? " — 잠김, 앞 단계 완료 후 활성화"
          : stepDone && card.kind === "step"
            ? ` — ${card.step.index + 1}번째로 완료`
            : "";
        return (
          <button
            key={card.id}
            type="button"
            className={styles.card}
            data-state={state}
            disabled={done || locked || stepDone || hit}
            onClick={() => clickCard(card)}
            aria-label={`${card.face}${ariaSuffix}`}
          >
            {stepDone && card.kind === "step" ? (
              <span className={styles.order} aria-hidden="true">
                {card.step.index + 1}
              </span>
            ) : null}
            <PixelSprite
              id={(card.kind === "step" ? card.step.sprite : card.forbidden.sprite) ?? ""}
              label={card.face}
              size={52}
              fallbackClassName={styles.face}
            />
            {stepDone && card.kind === "step" && card.step.label ? (
              <span className={styles.stepLabel}>{card.step.label}</span>
            ) : null}
            {hit ? <span className={styles.reason}>{card.kind === "forbidden" ? (card.forbidden.reason ?? "금지행동") : null}</span> : null}
            {locked ? <span className={styles.lockTag}>잠김</span> : null}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div className={shared.shell}>
      <GameHud label="절차 진행" count={progress} total={stepCount} remaining={remaining} timeLimit={game.time_limit} />

      {mapMode ? mapBoard : cardBoard}

      {outcome ? (
        <ResultBar score={outcome.score} failReason={outcome.failReason}>
          {outcome.detail}
        </ResultBar>
      ) : null}
    </div>
  );
}
