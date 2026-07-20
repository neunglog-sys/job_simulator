import { useMemo, useRef, useState } from "react";
import shared from "../../../styles/minigame.module.css";
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
 * sequence 엔진 — 카드를 정해진 절차 순서대로 누른다. ys-02·ys-10·ms-10 3종.
 *
 * 카드(steps + forbidden)는 무작위로 섞여 깔리고, 클릭 순서가 곧 답이다.
 * - wrong_order_fail(또는 wrong_order: fail): 틀린 순서 클릭 = 즉시 실패.
 *   ys-02 는 partial_credit — 실패해도 그때까지 밟은 단계만큼 accuracy 에 반영.
 * - forbidden 클릭: forbidden_fail(또는 forbidden: fail)이면 즉시 실패,
 *   아니면 forbidden_penalty(기본 40) 감점 후 계속(ms-10).
 * - fit(ms-10): fit 필드가 있는 스텝은 선행 스텝 완료 전엔 잠긴다 — 배관이
 *   앉아야 클립 받침이 드러나는 물리 게이트라 클릭 자체가 안 된다.
 *
 * 카드 앞면은 sprite 자리표시 텍스트만 보여주고(라벨은 정답 유출 방지를 위해
 * 완료 후 공개), 실패 사유·금지 사유는 위반 후에만 드러난다.
 */

type StepDef = { id: string; index: number; sprite?: string; label?: string; fit?: string };
type ForbiddenDef = { id: string; sprite?: string; reason?: string };
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
const pretty = (id: string) => id.replace(/_/g, " ");

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
        }),
      );
    return { steps, forbidden };
  }, [game]);

  // 마운트 시 1회 셔플 — steps 와 forbidden 을 섞어 순서 단서를 없앤다
  const cards = useMemo<Card[]>(
    () =>
      shuffle([
        ...model.steps.map((step): Card => ({ kind: "step", id: step.id, face: pretty(step.sprite ?? step.id), step })),
        ...model.forbidden.map(
          (f): Card => ({ kind: "forbidden", id: f.id, face: pretty(f.sprite ?? f.id), forbidden: f }),
        ),
      ]),
    [model],
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

  function clickCard(card: Card) {
    if (finished.current) return;
    if (card.kind === "forbidden") {
      if (forbiddenFail) {
        fail(card.forbidden.reason ?? "금지행동입니다", card.id);
        return;
      }
      // 감점 모드(ms-10) — 같은 카드는 한 번만 세고, 사유를 드러낸 채 계속 진행
      if (!forbiddenHits.includes(card.id)) setForbiddenHits((cur) => [...cur, card.id]);
      return;
    }
    if (card.step.index === progress) {
      const next = progress + 1;
      setProgress(next);
      if (next >= model.steps.length) conclude(next, false);
      return;
    }
    if (card.step.index < progress) return; // 이미 완료된 카드 — 버튼도 비활성이다
    if (wrongOrderFail) {
      fail(`절차 순서 위반 — '${card.face}' 차례가 아닙니다`, card.id);
      return;
    }
    setSlips((cur) => cur + 1);
  }

  /** fit 게이트(ms-10) — fit 스텝은 바로 앞 스텝이 끝나기 전엔 잠긴다(받침 미노출). */
  const lockedOf = (card: Card): boolean => card.kind === "step" && card.step.fit !== undefined && card.step.index > progress;

  return (
    <div className={shared.shell}>
      <GameHud label="절차 진행" count={progress} total={stepCount} remaining={remaining} timeLimit={game.time_limit} />

      <div className={styles.board} role="group" aria-label={`${game.title} — 카드를 절차 순서대로 누르세요`}>
        {cards.map((card) => {
          const locked = lockedOf(card);
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
              <span className={styles.face}>{card.face}</span>
              {stepDone && card.kind === "step" && card.step.label ? (
                <span className={styles.stepLabel}>{card.step.label}</span>
              ) : null}
              {hit ? <span className={styles.reason}>{card.kind === "forbidden" ? (card.forbidden.reason ?? "금지행동") : null}</span> : null}
              {locked ? <span className={styles.lockTag}>잠김</span> : null}
            </button>
          );
        })}
      </div>

      {outcome ? (
        <ResultBar score={outcome.score} failReason={outcome.failReason}>
          {outcome.detail}
        </ResultBar>
      ) : null}
    </div>
  );
}
