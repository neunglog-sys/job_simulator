import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import shared from "../../../styles/minigame.module.css";
import styles from "../../../styles/sortGame.module.css";
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
 * sort 엔진 — 대기열의 아이템을 맞는 통(bin)으로 분류한다. 7개 시나리오가 쓴다:
 *   ms-01(증거 분류) · ms-04(출고 배차) · gm-01(입고 검수) · wh-01(바코드 분류)
 *   yg-02(세공품 검수) · kts-01(환자 트리아지) · kts-04(창구 배정)
 *
 * 조작: 카드를 클릭해 선택 → 통을 클릭해 분류. 아트가 없으므로 sprite id를
 * 라벨 마커로 렌더한다(SpotGame 방식 — 아트가 들어오면 마커만 교체).
 *
 * 지원 데이터(_SCHEMA.md sort + 사후 등재 필드):
 *   - legend: 증상/배지 → 행선 기준표. 아이템엔 단서만, 판단은 범례 대조(kts-01·kts-04).
 *   - item.escalate: 통이 아니라 escalate 버튼이 정답(ms-01·ms-04·wh-01·yg-02).
 *   - escalate.when: 아이템 id · id 리스트 · `_발생/_지속` 조건 / requires: 단계 id.
 *   - scoring.escalate_mode: 대체(기본 — 버튼이 통 배치를 대체) | 병행필수(1회 절차 병행 — gm-01).
 *   - sudden: appears_at 시점 돌발 등장, freeze_queue(처리 전 분류 잠금),
 *     forbidden_bins(투입 시 금지행동), stages(순서 버튼), persists_after_stages(kts-01·kts-04).
 *   - item.forbidden_bin: 그 통에 넣으면 forbidden_penalty(gm-01·yg-02).
 *   - equivalent: 동일 외형 그룹 — 정답 bin 조합만 맞으면 교차 배정 무방(gm-01).
 *
 * 채점: accuracy = 맞게 처리한 items / item_count × 100 − 감점, clampScore.
 * 감점 중첩 금지 — 한 사건(아이템·돌발)에는 해당하는 감점 하나만 적용한다.
 * 전 아이템 처리(+돌발·병행 절차 해결) 시 자동 종료, '마감(제출)' 버튼은 항상 열려 있어
 * 방치 감점(missed_escalate·ignore_sudden)이 작동한다.
 */

type SortBin = {
  id: string;
  label?: string;
  sprite?: string;
  color?: string;
  icon?: string;
};

type SortItem = {
  id?: string;
  sprite?: string;
  /** 정답 통 id. escalate 대상은 bin 없이 escalate: true 로 온다. */
  bin?: string;
  escalate?: boolean;
  /** 이 통에 넣으면 금지행동(forbidden_penalty) — gm-01·yg-02 */
  forbidden_bin?: string;
  icon?: string;
  time_badge?: string;
  /** 1 = 최우선 대상(kts) — missed_emergency/missed_cutoff·over_triage 판정에 쓴다 */
  priority?: number;
  label?: string;
  note?: string;
};

type LegendRow = { symptom: string; goes_to: string };

type SuddenStage = { id: string; sprite?: string; label?: string };

type SuddenDef = {
  id?: string;
  sprite?: string;
  /** 아이템 수 이하면 '처리한 아이템 수', 넘으면 '초'로 해석한다(kts 25는 초). */
  appears_at?: number;
  label?: string;
  freeze_queue?: boolean;
  /** 미해결이어도 제출은 가능 — 대신 ignore_sudden_penalty 가 붙는다. */
  must_resolve_sudden?: boolean;
  bin?: string;
  forbidden_bins?: Array<{ bin: string; reason?: string }>;
  stages?: SuddenStage[];
  persists_after_stages?: boolean;
};

type EscalateDef = {
  label?: string;
  when?: string | string[];
  requires?: string[];
  note?: string;
};

type SortData = {
  bins?: SortBin[];
  items?: SortItem[];
  legend?: LegendRow[];
  equivalent?: string[];
  sudden?: SuddenDef;
  escalate?: EscalateDef;
};

/** 처리 확정된 아이템 — destBin null = 호출(escalate)로 처리. */
type Handled = {
  verdict: "ok" | "wrong";
  penalty: number;
  destBin: string | null;
  destLabel: string;
};

type SuddenPhase = "hidden" | "active" | "staged" | "resolved";
/** resolved 시점의 결말 — done 만 무감점. */
type SuddenOutcome = "done" | "forbidden" | "wrong" | "early" | null;

type Feedback = { kind: "ok" | "warn" | "bad" | "info"; text: string };

const SUDDEN_KEY = "__sudden__";

/** bin 데이터의 색 이름(한/영) → 마커 색. 아트 전이라 점 하나로만 표시한다. */
const BIN_COLORS: Record<string, string> = {
  red: "#ff6b81",
  yellow: "#ffd76e",
  green: "#5adcb4",
  blue: "#6ea8ff",
  gray: "#9aa0b4",
  grey: "#9aa0b4",
  빨강: "#ff6b81",
  노랑: "#ffd76e",
  초록: "#5adcb4",
  파랑: "#6ea8ff",
  주황: "#ffb35c",
  회색: "#9aa0b4",
};

/** ms-01 은 같은 id 항목이 두 번 나온다 — 인스턴스 키는 반드시 index 를 섞는다. */
function keyOf(item: SortItem, index: number): string {
  return `${item.id ?? item.sprite ?? "item"}#${index}`;
}

export function SortGame({ game, onComplete }: EngineProps) {
  const data = useMemo<SortData>(() => (game.data ?? {}) as SortData, [game.data]);
  const bins = useMemo<SortBin[]>(() => (Array.isArray(data.bins) ? data.bins : []), [data.bins]);
  const items = useMemo<SortItem[]>(() => (Array.isArray(data.items) ? data.items : []), [data.items]);
  const legend = useMemo<LegendRow[]>(() => (Array.isArray(data.legend) ? data.legend : []), [data.legend]);
  const suddenDef = data.sudden;
  const esc = data.escalate;
  const stages = useMemo<SuddenStage[]>(
    () => (Array.isArray(suddenDef?.stages) ? suddenDef.stages : []),
    [suddenDef],
  );

  /** scoring 의 숫자 키 — 정의된 경우에만 쓴다(파일별 특화 감점 판별용). */
  const optNum = useCallback(
    (key: string): number | undefined => {
      const value = game.scoring?.[key];
      return typeof value === "number" ? value : undefined;
    },
    [game.scoring],
  );

  /** escalate 동작 방식 — when 의 형태와 escalate_mode 로 판별한다. */
  const escalateKind = useMemo<"none" | "parallel" | "condition" | "replace">(() => {
    if (!esc) return "none";
    if (game.scoring?.escalate_mode === "병행필수") return "parallel";
    if (typeof esc.when === "string" && /(_발생|_지속)$/.test(esc.when)) return "condition";
    return "replace";
  }, [esc, game.scoring]);

  /** 대체 모드에서 '통이 아니라 호출이 정답'인 아이템 id — when·escalate_required·item.escalate 의 합집합. */
  const escalateTargetIds = useMemo(() => {
    const ids = new Set<string>();
    if (escalateKind !== "replace") return ids;
    const when = esc?.when;
    if (typeof when === "string") ids.add(when);
    else if (Array.isArray(when)) when.forEach((w) => typeof w === "string" && ids.add(w));
    const required = game.scoring?.escalate_required;
    if (Array.isArray(required)) required.forEach((r) => typeof r === "string" && ids.add(r));
    items.forEach((item) => {
      if (item.escalate && item.id) ids.add(item.id);
    });
    return ids;
  }, [escalateKind, esc, game.scoring, items]);

  const isEscalateTarget = useCallback(
    (item: SortItem) =>
      escalateKind === "replace" && (item.escalate === true || (item.id !== undefined && escalateTargetIds.has(item.id))),
    [escalateKind, escalateTargetIds],
  );

  /** equivalent 그룹(gm-01) — 동일 외형이라 어느 조합이든 정답 bin 개수만 맞으면 된다. */
  const equivalentIds = useMemo(
    () => new Set((Array.isArray(data.equivalent) ? data.equivalent : []).filter((x): x is string => typeof x === "string")),
    [data.equivalent],
  );
  const groupRequired = useMemo(() => {
    const required = new Map<string, number>();
    items.forEach((item) => {
      if (item.id && equivalentIds.has(item.id) && item.bin) {
        required.set(item.bin, (required.get(item.bin) ?? 0) + 1);
      }
    });
    return required;
  }, [items, equivalentIds]);

  /** priority 1 아이템의 정답 통 — 비응급을 여기 넣으면 over_triage(kts-01). */
  const priorityBins = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => {
      if (item.priority === 1 && item.bin) set.add(item.bin);
    });
    return set;
  }, [items]);

  const [handled, setHandled] = useState<Record<string, Handled>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [procedureDone, setProcedureDone] = useState(false); // 병행필수(gm-01 사진 증빙) 1회 절차
  const [sudden, setSudden] = useState({
    phase: "hidden" as SuddenPhase,
    outcome: null as SuddenOutcome,
    penalty: 0,
    resolution: null as string | null,
    stagesDone: [] as string[],
    stageViolations: 0, // 순서 위반 횟수 — stage_skip_penalty 건당
  });
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [done, setDone] = useState(false);
  const [summary, setSummary] = useState<{
    accuracy: number;
    correct: number;
    denom: number;
    penalty: number;
    mistakes: number;
  } | null>(null);
  const finished = useRef(false);

  const handledCount = useMemo(() => Object.keys(handled).length, [handled]);
  const stagesComplete = stages.every((stage) => sudden.stagesDone.includes(stage.id));
  /** 정답 배정·단계 후에도 상황이 계속되면 escalate 가 마지막 정답 행동이다(kts). */
  const needsEscalate = escalateKind === "condition" && suddenDef?.persists_after_stages === true;
  const queueFrozen = suddenDef?.freeze_queue === true && sudden.phase === "active";

  const binsById = useMemo(() => new Map(bins.map((bin) => [bin.id, bin])), [bins]);
  const binLabel = useCallback((binId: string) => binsById.get(binId)?.label ?? binId, [binsById]);

  // ── 종료·채점 ──────────────────────────────────────────────
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    setDone(true);

    let correct = 0;
    let penalty = 0;
    let mistakes = 0;

    // 아이템별 — 처리 로그의 감점을 합산. 미처리 escalate 대상은 '방치' 감점.
    items.forEach((item, index) => {
      const entry = handled[keyOf(item, index)];
      if (!entry) {
        if (isEscalateTarget(item)) {
          penalty += scoringOf(game, "missed_escalate_penalty", 40);
          mistakes += 1;
        }
        return; // 일반 아이템 방치는 감점 없이 분모에서만 깎인다
      }
      if (entry.verdict === "ok") correct += 1;
      else {
        penalty += entry.penalty;
        mistakes += 1;
      }
    });

    // 병행필수 절차(gm-01 사진 증빙) — 대상이 있는데 한 번도 안 눌렀으면 1회만 부과.
    if (escalateKind === "parallel" && !procedureDone) {
      const hasTargets = Array.isArray(esc?.when) ? esc.when.length > 0 : Boolean(esc?.when);
      if (hasTargets) {
        penalty += scoringOf(game, "missed_escalate_penalty", 20);
        mistakes += 1;
      }
    }

    // 돌발 사건 — 사건당 감점 하나(중첩 금지). 순서 위반(stage_skip)만 별도 건으로 세되,
    // 미호출(missed_escalate)·성급 호출(early)이 적용되면 거기에 흡수한다(kts-01 주석).
    if (suddenDef) {
      const stageSkip = scoringOf(game, "stage_skip_penalty", 15);
      if (sudden.phase === "active") {
        // 등장했는데 어느 통에도 배정하지 않고 종료 — 방치
        penalty += scoringOf(game, "ignore_sudden_penalty", 40);
        mistakes += 1;
      } else if (sudden.phase === "staged") {
        // 배정까지는 했으나 인계·호출 없이 종료 — 단계 생략·위반을 흡수한다
        penalty += scoringOf(game, "missed_escalate_penalty", 40);
        mistakes += 1;
      } else if (sudden.phase === "resolved") {
        penalty += sudden.penalty;
        if (sudden.penalty > 0) mistakes += 1;
        if (sudden.outcome === "done" && sudden.stageViolations > 0) {
          penalty += sudden.stageViolations * stageSkip;
          mistakes += sudden.stageViolations;
        }
      }
    }

    const denom = Math.max(1, optNum("item_count") ?? items.length);
    const accuracy = clampScore((correct / denom) * 100 - penalty);
    setSummary({ accuracy, correct, denom, penalty: Math.round(penalty), mistakes });
    onComplete({ accuracy, time_seconds: elapsedSeconds(startedAt), mistakes });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startedAt 은 아래 useCountdown 의 안정 ref
  }, [items, handled, isEscalateTarget, game, escalateKind, procedureDone, esc, suddenDef, sudden, optNum, onComplete]);

  const { remaining, startedAt } = useCountdown(game.time_limit, done, finish);

  // ── 돌발 등장 ──────────────────────────────────────────────
  const triggerSudden = useCallback(() => {
    setSudden((s) => (s.phase === "hidden" ? { ...s, phase: "active" } : s));
    setSelected(SUDDEN_KEY); // 대기열이 얼면 이 카드부터 처리해야 하므로 바로 집어 든다
    setFeedback({ kind: "warn", text: `돌발 상황 — ${suddenDef?.label ?? "예상 밖의 상대가 나타났습니다"}` });
  }, [suddenDef]);

  // 초 기준 등장 — appears_at 이 아이템 수보다 크면 초로 해석한다(kts 25초).
  useEffect(() => {
    if (!suddenDef || sudden.phase !== "hidden" || done) return;
    const appearsAt = suddenDef.appears_at ?? 0;
    if (appearsAt > 0 && appearsAt <= items.length) return; // 처리 수 기준은 아래 효과가 담당
    const tick = () => {
      if ((Date.now() - startedAt.current) / 1000 >= appearsAt) triggerSudden();
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [suddenDef, sudden.phase, done, items.length, startedAt, triggerSudden]);

  // 처리 수 기준 등장 + 전 항목을 먼저 끝냈으면 기다리게 하지 않고 바로 등장시킨다.
  useEffect(() => {
    if (!suddenDef || sudden.phase !== "hidden" || done) return;
    const appearsAt = suddenDef.appears_at ?? 0;
    const byCount = appearsAt > 0 && appearsAt <= items.length && handledCount >= appearsAt;
    if (byCount || (items.length > 0 && handledCount >= items.length)) triggerSudden();
  }, [suddenDef, sudden.phase, done, items.length, handledCount, triggerSudden]);

  // ── 자동 종료 — 전 아이템 + 돌발 + 병행 절차가 모두 마무리되면 ──
  useEffect(() => {
    if (done) return;
    const allHandled = items.length > 0 && items.every((item, index) => Boolean(handled[keyOf(item, index)]));
    const suddenSettled = !suddenDef || sudden.phase === "resolved";
    const parallelSettled = escalateKind !== "parallel" || procedureDone;
    if (allHandled && suddenSettled && parallelSettled) finish();
  }, [done, items, handled, suddenDef, sudden.phase, escalateKind, procedureDone, finish]);

  // ── 오분류 감점 판정 — 사건당 가장 구체적인 키 하나만 적용한다 ──
  const misbinPenalty = useCallback(
    (item: SortItem, binId: string): { value: number; note: string } => {
      // 1) 금지행동 통(gm-01 불량→합격, yg-02 결함→합격 트레이)
      if (item.forbidden_bin === binId) {
        return { value: scoringOf(game, "forbidden_penalty", 40), note: "금지행동 — 이 항목을 여기 넣으면 안 됩니다" };
      }
      // 2) 최우선(priority 1) 대상을 다른 곳으로 — kts 의 missed_emergency/missed_cutoff
      if (item.priority === 1) {
        const missed = optNum("missed_emergency_penalty") ?? optNum("missed_cutoff_penalty");
        if (missed !== undefined) return { value: missed, note: "가장 급한 대상을 놓쳤습니다" };
      }
      // 3) 급하지 않은 대상을 최우선 통에 — kts-01 over_triage
      if (item.priority !== 1 && priorityBins.has(binId)) {
        const over = optNum("over_triage_penalty");
        if (over !== undefined) return { value: over, note: "급하지 않은 대상을 최우선 자리에 배정했습니다" };
      }
      // 4) 일반 오분류
      return { value: scoringOf(game, "wrong_bin_penalty", 12), note: "기준과 다른 분류입니다" };
    },
    [game, optNum, priorityBins],
  );

  /** escalate 가 정답인 아이템을 통에 강행 배치 — 파일별 경로 판정(각 YAML scoring 주석). */
  const escalateMisbinPenalty = useCallback(
    (binId: string): { value: number; note: string } => {
      // ms-04 특례: 세관 화물을 보류(팔레트)로 — 출고는 막았지만 원문 정답(호출)이 아니라 절반 감점
      const hold = optNum("customs_to_hold_penalty");
      const bin = binsById.get(binId);
      if (hold !== undefined && (binId.includes("보류") || (bin?.label ?? "").includes("보류"))) {
        return { value: hold, note: "보류는 했지만 정답 절차(호출·보고)가 아닙니다" };
      }
      // 표준: forbidden_penalty 가 정의된 파일(wh-01·yg-02)은 강행=금지행동 40,
      // 아니면 missed_escalate_penalty(ms-01·ms-04 15)를 적용한다.
      const forbidden = optNum("forbidden_penalty");
      if (forbidden !== undefined) return { value: forbidden, note: "금지행동 — 호출·보고가 정답입니다" };
      return { value: scoringOf(game, "missed_escalate_penalty", 40), note: "직접 처리하지 말고 호출해야 합니다" };
    },
    [optNum, binsById, game],
  );

  // ── 배치 ──────────────────────────────────────────────────
  const placeItem = useCallback(
    (instanceKey: string, item: SortItem, bin: SortBin) => {
      if (handled[instanceKey]) return;
      let verdict: "ok" | "wrong" = "ok";
      let penalty = 0;
      let note: string | null = null;

      if (item.id && equivalentIds.has(item.id)) {
        // equivalent 그룹 — 지금까지의 그룹 배치 수와 정답 개수를 대조한다(교차 무방).
        const placed = new Map<string, number>();
        items.forEach((it, i) => {
          const entry = handled[keyOf(it, i)];
          if (entry?.destBin && it.id && equivalentIds.has(it.id)) {
            placed.set(entry.destBin, (placed.get(entry.destBin) ?? 0) + 1);
          }
        });
        const required = groupRequired.get(bin.id) ?? 0;
        if ((placed.get(bin.id) ?? 0) < required) {
          verdict = "ok";
        } else {
          // 초과분 — 아직 못 채운 그룹 역할에 귀속시킨다(감점이 가장 가벼운 쪽으로).
          verdict = "wrong";
          const candidates: Array<{ value: number; note: string }> = [];
          groupRequired.forEach((requiredCount, roleBin) => {
            if (roleBin === bin.id) return;
            const unfilled = requiredCount - Math.min(requiredCount, placed.get(roleBin) ?? 0);
            if (unfilled <= 0) return;
            items.forEach((roleDef) => {
              if (roleDef.id && equivalentIds.has(roleDef.id) && roleDef.bin === roleBin) {
                candidates.push(misbinPenalty(roleDef, bin.id));
              }
            });
          });
          const best = candidates.reduce<{ value: number; note: string } | null>(
            (acc, c) => (acc === null || c.value < acc.value ? c : acc),
            null,
          );
          penalty = best?.value ?? scoringOf(game, "wrong_bin_penalty", 12);
          note = best?.note ?? "기준과 다른 분류입니다";
        }
      } else if (isEscalateTarget(item)) {
        verdict = "wrong";
        const result = escalateMisbinPenalty(bin.id);
        penalty = result.value;
        note = result.note;
      } else if (bin.id === item.bin) {
        verdict = "ok";
      } else {
        verdict = "wrong";
        const result = misbinPenalty(item, bin.id);
        penalty = result.value;
        note = result.note;
      }

      setHandled((current) => ({
        ...current,
        [instanceKey]: { verdict, penalty, destBin: bin.id, destLabel: bin.label ?? bin.id },
      }));
      setSelected(null);
      setFeedback(
        verdict === "ok"
          ? { kind: "ok", text: `${bin.label ?? bin.id} 처리 완료` }
          : { kind: "bad", text: `${note ?? "오분류"} (감점 −${penalty})` },
      );
    },
    [handled, items, equivalentIds, groupRequired, isEscalateTarget, escalateMisbinPenalty, misbinPenalty, game],
  );

  const placeSudden = useCallback(
    (bin: SortBin) => {
      if (!suddenDef || sudden.phase !== "active") return;
      const label = bin.label ?? bin.id;
      if (suddenDef.bin && bin.id === suddenDef.bin) {
        // 정답 배정 — 단계가 열린다. 단계·escalate 가 없으면 그대로 해결.
        const resolvedNow = stages.length === 0 && !needsEscalate;
        setSudden((s) => ({
          ...s,
          phase: resolvedNow ? "resolved" : "staged",
          outcome: resolvedNow ? "done" : s.outcome,
          resolution: resolvedNow ? `${label}(으)로 안내해 해결했습니다` : s.resolution,
        }));
        setFeedback({ kind: "ok", text: `${label}(으)로 안내 — 이어서 매뉴얼 순서대로 응대하세요` });
      } else {
        const forbidden = suddenDef.forbidden_bins?.find((f) => f.bin === bin.id);
        if (forbidden) {
          const penalty = scoringOf(game, "forbidden_penalty", 40);
          setSudden((s) => ({
            ...s,
            phase: "resolved",
            outcome: "forbidden",
            penalty,
            resolution: `${label} 배정은 금지행동 — ${forbidden.reason ?? "여기로 보내면 안 됩니다"} (감점 −${penalty})`,
          }));
          setFeedback({ kind: "bad", text: `금지행동 — ${forbidden.reason ?? "잘못된 배정입니다"} (감점 −${penalty})` });
        } else {
          const penalty = optNum("sudden_wrong_bin_penalty") ?? scoringOf(game, "wrong_bin_penalty", 12);
          setSudden((s) => ({
            ...s,
            phase: "resolved",
            outcome: "wrong",
            penalty,
            resolution: `${label} 배정은 오답입니다 (감점 −${penalty})`,
          }));
          setFeedback({ kind: "bad", text: `잘못된 배정입니다 (감점 −${penalty})` });
        }
      }
      setSelected(null);
    },
    [suddenDef, sudden.phase, stages.length, needsEscalate, game, optNum],
  );

  const onBinClick = useCallback(
    (bin: SortBin) => {
      if (done || selected === null) return;
      if (selected === SUDDEN_KEY) {
        placeSudden(bin);
        return;
      }
      const index = items.findIndex((item, i) => keyOf(item, i) === selected);
      if (index >= 0) placeItem(selected, items[index], bin);
    },
    [done, selected, items, placeSudden, placeItem],
  );

  // ── 돌발 응대 단계 — 순서 위반은 stage_skip_penalty 건당 ──
  const pressStage = useCallback(
    (stageId: string) => {
      if (done || sudden.phase !== "staged" || sudden.stagesDone.includes(stageId)) return;
      const expected = stages.find((stage) => !sudden.stagesDone.includes(stage.id))?.id;
      const violation = expected !== stageId;
      const nextDone = [...sudden.stagesDone, stageId];
      const complete = stages.every((stage) => nextDone.includes(stage.id));
      const resolvedNow = complete && !needsEscalate;
      setSudden((s) => ({
        ...s,
        phase: resolvedNow ? "resolved" : "staged",
        outcome: resolvedNow ? "done" : s.outcome,
        resolution: resolvedNow ? "매뉴얼 절차를 마쳐 해결했습니다" : s.resolution,
        stagesDone: nextDone,
        stageViolations: s.stageViolations + (violation ? 1 : 0),
      }));
      setFeedback(
        violation
          ? { kind: "bad", text: `순서를 건너뛰었습니다 (감점 −${scoringOf(game, "stage_skip_penalty", 15)})` }
          : { kind: "ok", text: "다음 단계로 진행했습니다" },
      );
    },
    [done, sudden.phase, sudden.stagesDone, stages, needsEscalate, game],
  );

  // ── escalate 버튼 ─────────────────────────────────────────
  const onEscalate = useCallback(() => {
    if (done || !esc) return;
    if (escalateKind === "parallel") {
      // gm-01: 격리 배치를 대체하지 않는 1회 절차(사진 증빙). 안 누르면 종료 시 감점.
      if (!procedureDone) {
        setProcedureDone(true);
        setFeedback({ kind: "ok", text: `${esc.label ?? "절차"} 완료 — 증빙을 남겼습니다` });
      }
      return;
    }
    if (escalateKind === "condition") {
      if (!suddenDef || sudden.phase === "hidden" || sudden.phase === "resolved") return;
      const requires = esc.requires?.length ? esc.requires : stages.map((stage) => stage.id);
      const met = sudden.phase === "staged" && requires.every((id) => sudden.stagesDone.includes(id));
      if (met) {
        setSudden((s) => ({
          ...s,
          phase: "resolved",
          outcome: "done",
          resolution: `${esc.label ?? "호출"} — 절차를 밟은 뒤의 인계라 정답입니다`,
        }));
        setFeedback({ kind: "ok", text: `${esc.label ?? "호출"} 완료` });
      } else {
        // 단계를 밟기 전의 성급한 호출 — 원문 오답과 같은 행동(kts-01 오답 d)
        const penalty = optNum("early_escalate_penalty") ?? 25;
        setSudden((s) => ({
          ...s,
          phase: "resolved",
          outcome: "early",
          penalty,
          resolution: `절차 없이 ${esc.label ?? "호출"}부터 — 성급한 에스컬레이션 (감점 −${penalty})`,
        }));
        setFeedback({ kind: "bad", text: `절차를 밟기 전의 성급한 호출입니다 (감점 −${penalty})` });
      }
      setSelected(null);
      return;
    }
    // 대체 모드 — 선택한 아이템을 통 대신 호출로 처리한다.
    if (selected === null || selected === SUDDEN_KEY) return;
    const index = items.findIndex((item, i) => keyOf(item, i) === selected);
    if (index < 0 || handled[selected]) return;
    const item = items[index];
    if (isEscalateTarget(item)) {
      setHandled((current) => ({
        ...current,
        [selected]: { verdict: "ok", penalty: 0, destBin: null, destLabel: esc.label ?? "호출" },
      }));
      setFeedback({ kind: "ok", text: `${esc.label ?? "호출"} — 올바른 처리입니다` });
    } else {
      const penalty = scoringOf(game, "wrong_bin_penalty", 12);
      setHandled((current) => ({
        ...current,
        [selected]: { verdict: "wrong", penalty, destBin: null, destLabel: esc.label ?? "호출" },
      }));
      setFeedback({ kind: "bad", text: `이 항목은 호출 대상이 아닙니다 (감점 −${penalty})` });
    }
    setSelected(null);
  }, [done, esc, escalateKind, procedureDone, suddenDef, sudden, stages, selected, items, handled, isEscalateTarget, optNum, game]);

  // ── 렌더 ──────────────────────────────────────────────────
  const suddenVisible = Boolean(suddenDef) && sudden.phase !== "hidden";
  const totalCount = items.length + (suddenVisible ? 1 : 0);
  const processedCount = handledCount + (sudden.phase === "resolved" ? 1 : 0);
  const escalateVisible =
    escalateKind === "parallel" || escalateKind === "replace" || (escalateKind === "condition" && suddenVisible);
  const escalateDisabled =
    done ||
    (escalateKind === "parallel" && procedureDone) ||
    (escalateKind === "condition" && sudden.phase === "resolved") ||
    (escalateKind === "replace" && (selected === null || selected === SUDDEN_KEY));
  const escalateArmed = escalateKind === "condition" && sudden.phase === "staged" && stagesComplete && needsEscalate;

  return (
    <div className={shared.shell}>
      <GameHud
        label="분류 진행"
        count={processedCount}
        total={totalCount}
        remaining={remaining}
        timeLimit={game.time_limit}
      />

      {legend.length > 0 ? (
        // 범례 — 아이템의 증상·배지 단서를 여기 대조해서 행선을 판단한다(kts-01·kts-04)
        <aside className={styles.legend} aria-label="판단 기준표">
          <span className={styles.legendTitle}>기준표</span>
          {legend.map((row) => (
            <span key={row.symptom} className={styles.legendRow}>
              <span className={styles.chip}>{row.symptom}</span>
              <span className={styles.legendArrow} aria-hidden="true">
                →
              </span>
              <span className={styles.legendDest}>{binLabel(row.goes_to)}</span>
            </span>
          ))}
        </aside>
      ) : null}

      {suddenVisible && suddenDef ? (
        <section className={styles.sudden} data-phase={sudden.phase} aria-label="돌발 상황">
          <div className={styles.suddenHead}>
            <span className={styles.suddenBadge}>돌발</span>
            <span className={styles.suddenLabel}>{suddenDef.label ?? suddenDef.id}</span>
          </div>
          {sudden.phase === "active" ? (
            <>
              <button
                type="button"
                className={styles.suddenCard}
                aria-pressed={selected === SUDDEN_KEY}
                aria-label={`돌발 인물 선택 — ${suddenDef.label ?? suddenDef.id}`}
                disabled={done}
                onClick={() => setSelected((current) => (current === SUDDEN_KEY ? null : SUDDEN_KEY))}
              >
                <span className={styles.cardSprite}>{suddenDef.sprite ?? suddenDef.id}</span>
                <span className={styles.cardLabel}>카드를 든 채 안내할 곳(통)을 누르세요</span>
              </button>
              {queueFrozen ? <p className={styles.suddenNote}>대기열이 멈췄습니다 — 이 상황부터 처리해야 합니다.</p> : null}
              {suddenDef.must_resolve_sudden ? (
                // 제출 자체는 막지 않는다 — 미해결 마감은 ignore_sudden_penalty 로 채점된다
                <p className={styles.suddenNote}>이 상황을 해결해야 업무가 마무리됩니다.</p>
              ) : null}
            </>
          ) : sudden.phase === "staged" ? (
            <>
              <div className={styles.stages} role="group" aria-label="응대 단계">
                {stages.map((stage, index) => (
                  <button
                    key={stage.id}
                    type="button"
                    className={styles.stageBtn}
                    data-done={sudden.stagesDone.includes(stage.id)}
                    disabled={done || sudden.stagesDone.includes(stage.id)}
                    onClick={() => pressStage(stage.id)}
                  >
                    <span className={styles.stageOrder} aria-hidden="true">
                      {index + 1}
                    </span>
                    {stage.label ?? stage.id}
                  </button>
                ))}
              </div>
              {stagesComplete && needsEscalate ? (
                <p className={styles.suddenNote} data-kind="warn">
                  안내에도 상황이 계속됩니다 — 아래 대응 버튼으로 인계하세요.
                </p>
              ) : null}
            </>
          ) : (
            <p className={styles.suddenNote} data-kind={sudden.penalty > 0 ? "bad" : "ok"}>
              {sudden.resolution ?? "상황 종료"}
            </p>
          )}
        </section>
      ) : null}

      <div className={styles.queue} role="group" aria-label="분류 대기열">
        {items.map((item, index) => {
          const instanceKey = keyOf(item, index);
          const entry = handled[instanceKey];
          const isSelected = selected === instanceKey;
          const title = item.label ?? item.sprite ?? item.id ?? "항목";
          return (
            <button
              key={instanceKey}
              type="button"
              className={styles.card}
              data-state={entry ? entry.verdict : isSelected ? "selected" : undefined}
              disabled={done || Boolean(entry) || queueFrozen}
              aria-pressed={isSelected}
              aria-label={entry ? `${title} — ${entry.destLabel} 처리됨` : `${title} 선택`}
              onClick={() => setSelected((current) => (current === instanceKey ? null : instanceKey))}
            >
              <span className={styles.cardSprite}>{item.sprite ?? item.id}</span>
              {item.icon || item.time_badge ? (
                <span className={styles.cardChips}>
                  {item.icon ? <span className={styles.chip}>{item.icon}</span> : null}
                  {item.time_badge ? (
                    <span className={styles.chip} data-kind="badge">
                      {item.time_badge}
                    </span>
                  ) : null}
                </span>
              ) : null}
              {item.label ? <span className={styles.cardLabel}>{item.label}</span> : null}
              {entry ? (
                <span className={styles.cardDest} data-verdict={entry.verdict}>
                  {entry.verdict === "ok" ? "✓" : "✕"} {entry.destLabel}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className={styles.bins} role="group" aria-label="분류 통">
        {bins.map((bin) => (
          <button
            key={bin.id}
            type="button"
            className={styles.bin}
            disabled={done || selected === null}
            aria-label={`${bin.label ?? bin.id}에 넣기`}
            onClick={() => onBinClick(bin)}
          >
            {bin.color ? (
              <span
                className={styles.binDot}
                style={{ background: BIN_COLORS[bin.color] ?? bin.color }}
                aria-hidden="true"
              />
            ) : null}
            <span className={styles.binLabel}>{bin.label ?? bin.id}</span>
            {bin.icon ? <span className={styles.chip}>{bin.icon}</span> : null}
            {bin.sprite ? <span className={styles.binSprite}>{bin.sprite}</span> : null}
          </button>
        ))}
      </div>

      {feedback && !done ? (
        <p className={styles.feedback} data-kind={feedback.kind} role="status">
          {feedback.text}
        </p>
      ) : null}

      {!done ? (
        <div className={styles.actions}>
          {escalateVisible && esc ? (
            <button
              type="button"
              className={styles.escalateBtn}
              data-armed={escalateArmed}
              disabled={escalateDisabled}
              aria-label={esc.label ?? "호출"}
              onClick={onEscalate}
            >
              {escalateKind === "parallel" && procedureDone ? `✓ ${esc.label ?? "절차"} 완료` : esc.label ?? "호출"}
            </button>
          ) : null}
          <button type="button" className={styles.submitBtn} onClick={finish} aria-label="마감하고 제출">
            마감(제출)
          </button>
        </div>
      ) : null}

      {done && summary ? (
        <ResultBar score={summary.accuracy}>
          정확 처리 <b>
            {summary.correct}/{summary.denom}
          </b>
          {summary.penalty > 0 ? (
            <>
              {" · "}감점 <b>−{summary.penalty}</b>
            </>
          ) : (
            <>
              {" · "}감점 <b>없음</b>
            </>
          )}
          {summary.mistakes > 0 ? (
            <>
              {" · "}실수 <b>{summary.mistakes}건</b>
            </>
          ) : null}
        </ResultBar>
      ) : null}
    </div>
  );
}
