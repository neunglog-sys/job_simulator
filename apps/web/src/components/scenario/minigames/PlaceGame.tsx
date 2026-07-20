import { useMemo, useRef, useState } from "react";
import base from "../../../styles/minigame.module.css";
import styles from "../../../styles/placeGame.module.css";
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
 * 확장 필드: marker(ms-03 명패)·visual_cues(라벨 마커)·accepts null(stn-05 정상 구간)·
 * stains(cln-01 문지르기/교체)·forbidden {id, slots?}(cln-01·hr-01)·escalate(보고 버튼).
 * 채점은 파일 scoring 주석이 명세다 — 한 조각(사건)에는 가장 무거운 감점 하나만 적용한다.
 */

type PlaceSlot = { id: string; accepts?: string | null; marker?: string; label?: string };
type PlaceStain = { id: string; sprite?: string; resolve?: string };
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

/** 스프라이트 아트가 아직 없어 id·단서를 라벨 마커로 그린다(SpotGame과 같은 규약). */
const pretty = (raw: string) => raw.replace(/_/g, " ");

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

  const clickSlot = (slot: PlaceSlot) => {
    if (done) return;
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
    const pieceId = pieceIdByKey.get(selected);
    if (!pieceId) return;
    // 선택한 채 클릭 → 배치(있던 조각은 카트로 교체 복귀)
    setPlaced((cur) => ({ ...cur, [slot.id]: selected }));
    setSelected(null);
    if (fitAny) {
      // 사건당 감점 — 빼도 무효화되지 않는다. 함정 조각은 extra 감점 하나만(중첩 금지).
      if (extraIds.has(pieceId)) setExtrasUsed((cur) => ({ ...cur, [pieceId]: true }));
      else if (slot.accepts !== pieceId) setWrongEvents((n) => n + 1);
    }
  };

  const clickStain = (stain: PlaceStain) => {
    if (done) return;
    const cur = stainState[stain.id] ?? { progress: 0, resolved: false, hint: null };
    if (cur.resolved) return;
    const resolve = stain.resolve ?? "문지르기";

    if (selected) {
      const pieceId = pieceIdByKey.get(selected);
      if (resolve === "교체" && pieceId && replacementIds.has(pieceId)) {
        // 교체 조각을 얼룩 자리에 깐다 — 슬롯 채점과 별개(이중 계산 금지)
        setConsumed((used) => ({ ...used, [selected]: true }));
        setSelected(null);
        setStainState((all) => ({ ...all, [stain.id]: { progress: 100, resolved: true, hint: null } }));
      } else {
        setStainState((all) => ({
          ...all,
          [stain.id]: { ...cur, hint: "이 조각으로는 처리할 수 없습니다" },
        }));
      }
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

  const placedKeys = useMemo(() => new Set(Object.values(placed)), [placed]);
  const cartPieces = pieces.filter((p) => !placedKeys.has(p.key) && !consumed[p.key]);
  const filledCount = slots.filter((s) => s.accepts != null && placed[s.id]).length;
  const resolvedCount = stains.filter((s) => stainState[s.id]?.resolved).length;
  const acceptTotal = slots.filter((s) => s.accepts != null).length;

  return (
    <div className={base.shell}>
      <GameHud
        label="배치 진행"
        count={filledCount + resolvedCount}
        total={acceptTotal + stains.length}
        remaining={remaining}
        timeLimit={game.time_limit}
      />

      {stains.length > 0 ? (
        <div className={styles.stainRow} role="group" aria-label="얼룩 정비">
          {stains.map((stain) => {
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
                <span className={styles.stainName}>{pretty(stain.sprite ?? stain.id)}</span>
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

      <div className={styles.board} role="group" aria-label="배치판">
        {slots.map((slot) => {
          const key = placed[slot.id];
          const pieceId = key ? pieceIdByKey.get(key) ?? null : null;
          const title = slot.label ?? pretty(slot.id);
          // fit:any 만 실시간 피드백 — 정답 구간이 미배치·오배치면 계속 새는 표시
          const leaking = fitAny && !done && slot.accepts != null && pieceId !== slot.accepts;
          const plugged = fitAny && !done && slot.accepts != null && pieceId === slot.accepts;
          const verdict = done
            ? slot.accepts == null
              ? pieceId
                ? "bad"
                : "ok"
              : pieceId === slot.accepts
                ? "ok"
                : "bad"
            : undefined;
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
              {slot.marker ? <span className={styles.marker}>{pretty(slot.marker)}</span> : null}
              <span className={styles.slotTitle}>{title}</span>
              {pieceId ? (
                <span className={styles.placedPiece}>{pretty(pieceId)}</span>
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
                <span className={styles.pieceName}>{pretty(p.id)}</span>
                {cue ? <span className={styles.pieceCue}>{pretty(cue)}</span> : null}
              </button>
            );
          })
        ) : (
          <span className={styles.cartEmpty}>카트가 비었습니다</span>
        )}
      </div>

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
