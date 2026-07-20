import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import common from "../../../styles/minigame.module.css";
import styles from "../../../styles/matchGame.module.css";
import { GameHud, ResultBar, clampScore, elapsedSeconds, scoringOf, useCountdown, type EngineProps } from "./shared";

/**
 * match 엔진 — 좌우 카드를 선으로 잇는다. 8개 시나리오(ms-02·ys-03·kts-02·03·05·stn-01·03·04)가 쓴다.
 *
 * 판(좌/우 카드)은 공통이고, 파일마다 확장 블록이 하나씩 붙는다:
 *   unmatched(+unmatched_action)  짝 없는 카드 — '짝 없음' 도장이 정답 (ms-02·ys-03·stn-01·03·04)
 *   discard                        휴지통으로 버려야 하는 카드 (stn-01)
 *   stream                         흐르는 구슬에서 이상치만 클릭 (stn-03)
 *   keys                           매칭한 손님에게 색 객실 키 전달 (kts-05)
 *   sudden+stages+escalate         돌발 손님 → 단계 순서대로 → 호출 (kts-03)
 *   escalate(when=카드 id)         특정 카드는 선긋기 대신 호출이 정답 (ys-03)
 *   equivalent / forbidden_pairs   교차 배정 인정 / 금기 조합 (kts-02 등)
 *
 * 선은 카드당 1개 — 새 선이 기존 선을 대체한다. kts-02의 one_line_per_left("전부 잇기
 * 감점 회피 봉쇄")를 판 전체 규칙으로 올린 것으로, 8개 데이터 모두 카드당 정답이 1개라
 * 다중 연결이 필요한 파일이 없다.
 *
 * 채점은 제출(또는 전판 판정 완료·시간 만료) 시 최종 상태에서 한 번 계산한다.
 * 감점 중첩 금지 — 한 사건(선 하나·카드 하나)에는 후보 중 가장 무거운 감점 하나만(_SCHEMA.md).
 * 스프라이트 아트가 아직 없어 sprite id 텍스트를 라벨 마커로 그린다(spot 엔진과 같은 방식).
 */

type Side = "left" | "right";

type MatchCard = {
  id: string;
  sprite: string;
  label?: string;
  /** ys-03 — 금속탐지기 반응자. 카드에 빨간 램프를 그린다(시각 단서). */
  detector?: boolean;
};

type StageDef = { id: string; sprite?: string; label?: string };

type SuddenDef = {
  id?: string;
  sprite?: string;
  appears_at?: number;
  label?: string;
  stages?: StageDef[];
  persists_after_stages?: boolean;
  forbidden_actions?: Array<{ id: string; reason?: string }>;
};

type MatchData = {
  left?: MatchCard[];
  right?: MatchCard[];
  pairs?: Array<[string, string]>;
  unmatched?: string[];
  /** stn-04 — 짝없음 도장의 라벨(재검증_표시). 없으면 '짝 없음'. */
  unmatched_action?: string;
  /** kts-02 — 같은 그룹끼리는 교차 배정도 정답. */
  equivalent?: string[][];
  /** kts-02 — 좌 카드당 선 1개 제한. 이 엔진은 판 전체를 카드당 1선으로 운영해 항상 충족한다. */
  one_line_per_left?: boolean;
  /** right 스칼라·리스트({left,right}) 및 pair:[l,r](stn-03) 두 형태 모두 지원. */
  forbidden_pairs?: Array<{ left?: string; right?: string | string[]; pair?: [string, string]; reason?: string }>;
  /** stn-01 — 휴지통. */
  discard?: { bin?: string; items?: Array<{ id: string; reason?: string }> };
  /** stn-03 — 흐름 검수. */
  stream?: {
    beads?: Array<{ id: string; sprite?: string }>;
    outliers?: Array<{ id: string; sprite?: string; reason?: string }>;
    decoy_beads?: Array<{ id: string; sprite?: string }>;
  };
  /** kts-05 — 객실 키 전달. */
  keys?: Array<{ guest: string; key_color: string; label?: string }>;
  /** kts-03 — 돌발 손님. */
  sudden?: SuddenDef;
  /** when이 카드 id면 '선택한 카드 인계'(ys-03), 상태 조건이면 돌발 패널의 호출 버튼(kts-03). */
  escalate?: { label?: string; when?: string | string[]; requires?: string[] };
  /** ys-03 — 눌러선 안 되는 버튼(직접_신체수색 등). 누르면 forbidden_penalty. */
  forbidden?: Array<{ id: string; reason?: string }>;
  /** kts-03 — 카드 밑에 붙는 보조 시각 단서(가격표 개수 등). */
  visual_cues?: Record<string, string>;
};

/** 카드 단독 판정 — 도장·폐기·인계. 선(line)과 상호 배타. */
type CardMark = "stamped" | "discarded" | "escalated";

type Line = { left: string; right: string };

type Anchor = { x: number; y: number };

type Outcome = {
  accuracy: number;
  penalty: number;
  incidents: number;
  numerator: number;
  denominator: number;
  correctLineKeys: string[];
  cardVerdicts: Record<string, "ok" | "bad">;
};

const FLOW_SECONDS = 9; // 구슬이 밴드를 한 번 지나는 시간

/** kts-05 객실 키 색 팔레트 — 아트 전 임시 색값. */
const KEY_COLORS: Record<string, string> = {
  blue: "#5b8def",
  green: "#35c28f",
  gold: "#e8b64c",
  red: "#e0506f",
  silver: "#b9c2d4",
  purple: "#9a6cf0",
};

const lineKey = (line: Line) => `${line.left}|${line.right}`;
const pretty = (id: string) => id.replace(/_/g, " ");

function sameAnchors(a: Record<string, Anchor>, b: Record<string, Anchor>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return bKeys.every((k) => a[k] !== undefined && a[k].x === b[k].x && a[k].y === b[k].y);
}

export function MatchGame({ game, onComplete }: EngineProps) {
  const data = game.data as MatchData;
  const left = useMemo(() => data.left ?? [], [data.left]);
  const right = useMemo(() => data.right ?? [], [data.right]);
  const pairs = useMemo(() => data.pairs ?? [], [data.pairs]);
  const unmatchedList = useMemo(() => data.unmatched ?? [], [data.unmatched]);
  const discardItems = useMemo(() => data.discard?.items ?? [], [data.discard]);
  const keyDefs = useMemo(() => data.keys ?? [], [data.keys]);
  const outliers = useMemo(() => data.stream?.outliers ?? [], [data.stream]);
  const sudden = data.sudden;
  const stages = useMemo(() => sudden?.stages ?? [], [sudden]);

  const unmatchedSet = useMemo(() => new Set(unmatchedList), [unmatchedList]);
  const discardSet = useMemo(() => new Set(discardItems.map((item) => item.id)), [discardItems]);

  // equivalent 그룹 — 같은 그룹이면 교차 배정도 정답(kts-02 회원 A↔B).
  const eqClass = useMemo(() => {
    const map = new Map<string, number>();
    (data.equivalent ?? []).forEach((group, gi) => group.forEach((id) => map.set(id, gi)));
    return map;
  }, [data.equivalent]);
  const eq = (a: string, b: string) => a === b || (eqClass.has(a) && eqClass.get(a) === eqClass.get(b));

  // 금기 조합 — {left, right(스칼라·리스트)} 와 {pair:[l,r]}(stn-03) 둘 다 "l→r" 키로 편다.
  const forbiddenPairSet = useMemo(() => {
    const set = new Set<string>();
    for (const fp of data.forbidden_pairs ?? []) {
      if (Array.isArray(fp.pair) && fp.pair.length === 2) set.add(`${fp.pair[0]}→${fp.pair[1]}`);
      if (fp.left !== undefined && fp.right !== undefined) {
        const rights = Array.isArray(fp.right) ? fp.right : [fp.right];
        for (const r of rights) set.add(`${fp.left}→${r}`);
      }
    }
    return set;
  }, [data.forbidden_pairs]);

  // escalate.when 이 실재 카드 id를 가리키면 '카드 인계' 모드(ys-03) — 그 카드의 정답은 선이 아니라 호출.
  const escTargets = useMemo(() => {
    const when = data.escalate?.when;
    const ids = new Set([...left, ...right].map((card) => card.id));
    const list = Array.isArray(when) ? when : when ? [when] : [];
    return list.filter((w) => ids.has(w));
  }, [data.escalate, left, right]);
  const isItemEscalate = escTargets.length > 0;

  // 구슬 흐름 — 정상·이상치·decoy 를 라운드로빈으로 섞어 이상치가 몰리지 않게 한다.
  const flowBeads = useMemo(() => {
    const src = data.stream;
    if (!src) return [] as Array<{ id: string; sprite: string; kind: "normal" | "outlier" | "decoy" }>;
    const groups: Array<[Array<{ id: string; sprite?: string }> | undefined, "normal" | "outlier" | "decoy"]> = [
      [src.beads, "normal"],
      [src.outliers, "outlier"],
      [src.decoy_beads, "decoy"],
    ];
    const rows: Array<{ id: string; sprite: string; kind: "normal" | "outlier" | "decoy" }> = [];
    const longest = Math.max(0, ...groups.map(([g]) => g?.length ?? 0));
    for (let i = 0; i < longest; i += 1) {
      for (const [group, kind] of groups) {
        const bead = group?.[i];
        if (bead) rows.push({ id: bead.id, sprite: bead.sprite ?? bead.id, kind });
      }
    }
    return rows;
  }, [data.stream]);

  // 돌발 단계 버튼 — 나열 순서가 곧 정답 순서라 그대로 그리면 왼쪽부터 누르기만 하면 된다.
  // id 해시로 고정 셔플해 '절차를 아는지'가 판정되게 한다(아트 전 임시 배치).
  const displayStages = useMemo(() => {
    const hash = (s: string) => [...s].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 9973, 7);
    return [...stages].sort((a, b) => hash(a.id) - hash(b.id));
  }, [stages]);

  const keyPalette = useMemo(() => [...new Set(keyDefs.map((k) => k.key_color))], [keyDefs]);

  // ── 진행 상태 ──
  const [lines, setLines] = useState<Line[]>([]);
  const [marks, setMarks] = useState<Record<string, CardMark>>({});
  const [selected, setSelected] = useState<{ side: Side; id: string } | null>(null);
  const [beadClicks, setBeadClicks] = useState<Record<string, "caught" | "wrong">>({});
  const [stagesDone, setStagesDone] = useState<string[]>([]);
  const [stageViolations, setStageViolations] = useState(0); // 순서 위반 — 누른 시점에 확정
  const [escalated, setEscalated] = useState(false); // 상태형(sudden) 호출
  const [earlyEscalate, setEarlyEscalate] = useState(false); // 단계 전 성급 호출
  const [pressedForbidden, setPressedForbidden] = useState<string[]>([]);
  const [suddenVisible, setSuddenVisible] = useState(false);
  const [keysGiven, setKeysGiven] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const finishedRef = useRef(false);

  const linkedSet = useMemo(() => new Set(lines.flatMap((l) => [l.left, l.right])), [lines]);

  // ── 채점 파라미터 — 표준 채점 키(_SCHEMA.md)만 읽는다 ──
  const scoringHasKey = (key: string) => typeof game.scoring?.[key] === "number";

  // 분모 — 파일별 명세: judgement_count/decision_count 가 있으면 그 수(도장·폐기·이상치·인계까지
  // 판정으로 센다), 없으면 pair_count(+unmatched_count). kts-02·03·05 는 pairs 만 분모다.
  const judgeTotal = scoringHasKey("judgement_count")
    ? scoringOf(game, "judgement_count", 0)
    : scoringHasKey("decision_count")
      ? scoringOf(game, "decision_count", 0)
      : null;
  const includeExtras = judgeTotal !== null;
  const includeUnmatched = includeExtras || scoringHasKey("unmatched_count");
  const denominator = Math.max(
    1,
    judgeTotal ??
      scoringOf(game, "pair_count", pairs.length) +
        (includeUnmatched ? scoringOf(game, "unmatched_count", unmatchedList.length) : 0),
  );

  /** 최종 상태에서 한 번 채점 — 감점 중첩 금지(사건당 가장 무거운 것 하나). */
  const computeOutcome = (): Outcome => {
    const wrongPairP = scoringOf(game, "wrong_pair_penalty", 12);
    const forbiddenP = scoringOf(game, "forbidden_penalty", 40);
    const hasMatchedUnmatchedP = scoringHasKey("matched_unmatched_penalty");
    const matchedUnmatchedP = scoringOf(game, "matched_unmatched_penalty", wrongPairP);
    const missedUnmatchedP = scoringOf(game, "missed_unmatched_penalty", 0);
    const missedEscalateP = scoringOf(game, "missed_escalate_penalty", 40);
    const earlyEscalateP = scoringOf(game, "early_escalate_penalty", 25);
    const stageSkipP = scoringOf(game, "stage_skip_penalty", 15);
    const ignoreSuddenP = scoringOf(game, "ignore_sudden_penalty", 40);
    const decoyP = scoringOf(game, "decoy_penalty", 15);
    const wrongKeyP = scoringOf(game, "wrong_key_penalty", 10);

    let penalty = 0;
    let incidents = 0;
    const addIncident = (amount: number) => {
      penalty += amount;
      incidents += 1;
    };
    const verdicts: Record<string, "ok" | "bad"> = {};
    const touched = (id: string) => linkedSet.has(id) || Boolean(marks[id]);
    const isEscTarget = (id: string) => escTargets.includes(id);

    // 1) 정답 선 대조 — equivalent 교차 배정 인정, 선 하나는 짝 하나만 충족(중복 크레딧 금지)
    const usedLines = new Set<number>();
    let correctPairs = 0;
    for (const [pl, pr] of pairs) {
      const idx = lines.findIndex((ln, i) => !usedLines.has(i) && eq(ln.left, pl) && eq(ln.right, pr));
      if (idx >= 0) {
        usedLines.add(idx);
        correctPairs += 1;
      }
    }

    // 2) 틀린 선 — 한 선 = 한 사건. 해당되는 감점 후보 중 최댓값 하나만.
    const correctLineKeys: string[] = [];
    lines.forEach((ln, i) => {
      if (usedLines.has(i)) {
        correctLineKeys.push(lineKey(ln));
        verdicts[ln.left] = "ok";
        verdicts[ln.right] = "ok";
        return;
      }
      const candidates = [wrongPairP];
      if (forbiddenPairSet.has(`${ln.left}→${ln.right}`)) candidates.push(forbiddenP);
      // 버려야 할 시안을 손님에게 이어붙임 — 금지행동(stn-01 scoring 주석)
      if (discardSet.has(ln.left) || discardSet.has(ln.right)) candidates.push(forbiddenP);
      if (hasMatchedUnmatchedP && (unmatchedSet.has(ln.left) || unmatchedSet.has(ln.right)))
        candidates.push(matchedUnmatchedP);
      // 인계 대상을 선으로 그냥 통과시킴(ys-03 E) — 방치와 같은 무게
      if (isEscTarget(ln.left) || isEscTarget(ln.right)) candidates.push(missedEscalateP);
      addIncident(Math.max(...candidates));
      verdicts[ln.left] = "bad";
      verdicts[ln.right] = "bad";
    });

    // 3) 카드 단독 판정 — 도장·폐기·인계의 옳고 그름
    let correctStamps = 0;
    let correctDiscards = 0;
    let correctEscalates = 0;
    for (const [id, mark] of Object.entries(marks)) {
      if (mark === "stamped") {
        if (unmatchedSet.has(id)) {
          correctStamps += 1;
          verdicts[id] = "ok";
        } else {
          const candidates = [wrongPairP];
          if (isEscTarget(id)) candidates.push(missedEscalateP);
          addIncident(Math.max(...candidates));
          verdicts[id] = "bad";
        }
      } else if (mark === "discarded") {
        if (discardSet.has(id)) {
          correctDiscards += 1;
          verdicts[id] = "ok";
        } else {
          const candidates = [wrongPairP];
          if (isEscTarget(id)) candidates.push(missedEscalateP);
          addIncident(Math.max(...candidates));
          verdicts[id] = "bad";
        }
      } else if (isEscTarget(id)) {
        correctEscalates += 1;
        verdicts[id] = "ok";
      } else {
        // 엉뚱한 카드를 인계 — 오판정
        addIncident(wrongPairP);
        verdicts[id] = "bad";
      }
    }

    // 4) 방치 — 아무 판정도 받지 않은 카드. 선·도장 사건과 중첩하지 않는다(untouched 만 본다).
    for (const id of unmatchedList) {
      if (touched(id)) continue;
      if (missedUnmatchedP > 0) {
        addIncident(missedUnmatchedP); // stn-04 '조용히 제외' 봉쇄
        verdicts[id] = "bad";
      } else if (includeUnmatched) {
        verdicts[id] = "bad"; // 분자 손실만(ms-02 등 — 감점 키 없음)
      } else {
        verdicts[id] = "ok"; // 남겨두는 것이 정답(kts-02·03·05)
      }
    }
    for (const id of escTargets) {
      if (!touched(id)) {
        addIncident(missedEscalateP); // ys-03 탐지기 반응자 방치
        verdicts[id] = "bad";
      }
    }
    for (const item of discardItems) {
      if (!touched(item.id) && includeExtras) verdicts[item.id] = "bad";
    }

    // 5) 돌발(kts-03) — 응대가 전무하면 ignore 사건 하나로만 채점(중첩 금지).
    //    appears_at 전에 제출해 돌발을 피하는 것도 '응대하지 않고 종료'다.
    if (sudden) {
      const interacted = stagesDone.length > 0 || escalated;
      if (!interacted) {
        addIncident(ignoreSuddenP);
      } else {
        for (const stage of stages) if (!stagesDone.includes(stage.id)) addIncident(stageSkipP); // 생략 — 건당
        for (let i = 0; i < stageViolations; i += 1) addIncident(stageSkipP); // 순서 위반 — 건당
        if (earlyEscalate) addIncident(earlyEscalateP);
        if (Boolean(sudden.persists_after_stages) && !escalated) addIncident(missedEscalateP);
      }
    }

    // 6) 금지 버튼(직접_신체수색·맞대응_언쟁 등) — 누른 것마다 사건 1
    for (let i = 0; i < pressedForbidden.length; i += 1) addIncident(forbiddenP);

    // 7) 구슬 — 이상치는 분자, 정상·decoy 클릭은 개당 감점(stn-03)
    let caught = 0;
    for (const outlier of outliers) if (beadClicks[outlier.id] === "caught") caught += 1;
    for (const judged of Object.values(beadClicks)) if (judged === "wrong") addIncident(decoyP);

    // 8) 객실 키 — 색이 틀리면 건당 감점(kts-05). 키는 분모에 없다(감점 전용).
    for (const key of keyDefs) {
      const given = keysGiven[key.guest];
      if (linkedSet.has(key.guest) && given && given !== key.key_color) addIncident(wrongKeyP);
    }

    const numerator =
      correctPairs +
      (includeUnmatched ? correctStamps : 0) +
      (includeExtras ? correctDiscards + caught + correctEscalates : 0);
    const accuracy = clampScore((numerator / denominator) * 100 - penalty);
    return { accuracy, penalty, incidents, numerator, denominator, correctLineKeys, cardVerdicts: verdicts };
  };

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const scored = computeOutcome();
    setOutcome(scored);
    setDone(true);
    onComplete({ accuracy: scored.accuracy, time_seconds: elapsedSeconds(startedAt), mistakes: scored.incidents });
  };

  const { remaining, startedAt } = useCountdown(game.time_limit, done, () => finish());

  // 돌발 등장 — 시작 시각 기준 지연(kts-03 appears_at: 30)
  useEffect(() => {
    if (!sudden || done) return;
    const delay = Math.max(0, (sudden.appears_at ?? 0) * 1000 - (Date.now() - startedAt.current));
    const timer = window.setTimeout(() => setSuddenVisible(true), delay);
    return () => window.clearTimeout(timer);
  }, [sudden, done, startedAt]);

  // ── 자동 종료 — 판의 모든 카드가 판정되고, 이상치·돌발·키까지 끝났을 때.
  //    '남겨두기'가 정답인 카드(kts-02 고강도 등)를 남긴 채 끝내려면 제출 버튼을 쓴다 —
  //    미완 제출이 가능해야 방치 감점(missed_*)이 작동한다.
  const allResolved =
    left.length + right.length > 0 &&
    [...left, ...right].every((card) => linkedSet.has(card.id) || Boolean(marks[card.id]));
  const caughtCount = outliers.filter((o) => beadClicks[o.id] === "caught").length;
  const streamDone = outliers.length === 0 || caughtCount === outliers.length;
  const stagesAllDone = stages.every((s) => stagesDone.includes(s.id));
  const suddenGate =
    !sudden || (suddenVisible && stagesAllDone && (!sudden.persists_after_stages || escalated));
  const keysDone =
    keyDefs.length === 0 || left.every((card) => !linkedSet.has(card.id) || Boolean(keysGiven[card.id]));

  useEffect(() => {
    if (done || !allResolved) return;
    if (streamDone && suddenGate && keysDone) finish();
    // eslint 미사용 저장소 — finish 는 매 렌더 최신 클로저라 deps 에 넣지 않는다
  }, [done, allResolved, streamDone, suddenGate, keysDone]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 선 좌표 측정 — 카드 버튼의 모서리 중앙을 보드 기준 픽셀로 잰다 ──
  const boardRef = useRef<HTMLDivElement | null>(null);
  const cardEls = useRef(new Map<string, { el: HTMLElement; side: Side }>());
  const [anchors, setAnchors] = useState<Record<string, Anchor>>({});

  const measure = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const base = board.getBoundingClientRect();
    const next: Record<string, Anchor> = {};
    for (const [id, entry] of cardEls.current) {
      const rect = entry.el.getBoundingClientRect();
      next[id] = {
        x: (entry.side === "left" ? rect.right : rect.left) - base.left,
        y: rect.top + rect.height / 2 - base.top,
      };
    }
    setAnchors((prev) => (sameAnchors(prev, next) ? prev : next)); // 동일하면 재렌더 없음
  }, []);

  useLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    const board = boardRef.current;
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" || !board ? null : new ResizeObserver(measure);
    observer?.observe(board as Element);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [measure]);

  const registerCard = (id: string, side: Side) => (el: HTMLButtonElement | null) => {
    if (el) cardEls.current.set(id, { el, side });
    else cardEls.current.delete(id);
  };

  // ── 조작 ──
  const toggleCard = (side: Side, id: string) => {
    if (done) return;
    const mark = marks[id];
    if (mark === "escalated") return; // 인계는 불가역 — 선임에게 넘어갔다
    if (mark) {
      // 도장·폐기 해제
      setMarks((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    const joined = lines.find((l) => l.left === id || l.right === id);
    if (joined) {
      // 연결된 카드 클릭 = 선 해제
      setLines((prev) => prev.filter((l) => l !== joined));
      return;
    }
    if (!selected) {
      setSelected({ side, id });
      return;
    }
    if (selected.id === id) {
      setSelected(null);
      return;
    }
    if (selected.side === side) {
      setSelected({ side, id });
      return;
    }
    const l = side === "left" ? id : selected.id;
    const r = side === "right" ? id : selected.id;
    // 카드당 선 1개 — 새 선이 양끝의 기존 선을 대체한다(one_line_per_left 포함 규칙)
    setLines((prev) => [...prev.filter((ln) => ln.left !== l && ln.right !== r), { left: l, right: r }]);
    setSelected(null);
  };

  const markSelected = (mark: CardMark) => {
    if (done || !selected) return;
    const id = selected.id;
    setMarks((prev) => ({ ...prev, [id]: mark }));
    setSelected(null);
  };

  const pressStage = (stageId: string) => {
    if (done || stagesDone.includes(stageId)) return;
    const idx = stages.findIndex((s) => s.id === stageId);
    const prevOk = stages.slice(0, Math.max(0, idx)).every((s) => stagesDone.includes(s.id));
    if (!prevOk) setStageViolations((v) => v + 1); // 순서 위반 — 누른 시점에 확정
    setStagesDone((prev) => [...prev, stageId]);
  };

  const pressStateEscalate = () => {
    if (done || escalated) return;
    const requires = data.escalate?.requires ?? stages.map((s) => s.id);
    if (requires.some((id) => !stagesDone.includes(id))) setEarlyEscalate(true); // 성급 호출
    setEscalated(true);
  };

  const pressForbiddenButton = (id: string) => {
    if (done || pressedForbidden.includes(id)) return;
    setPressedForbidden((prev) => [...prev, id]);
  };

  const clickBead = (id: string, kind: "normal" | "outlier" | "decoy") => {
    if (done || beadClicks[id]) return;
    setBeadClicks((prev) => ({ ...prev, [id]: kind === "outlier" ? "caught" : "wrong" }));
  };

  const giveKey = (guest: string, color: string) => {
    if (done) return;
    setKeysGiven((prev) => ({ ...prev, [guest]: color }));
  };

  // ── 표시 도우미 ──
  const stampLabel = data.unmatched_action ? pretty(data.unmatched_action) : "짝 없음";
  const binLabel = data.discard?.bin ?? "휴지통";
  const stateOf = (id: string): string | undefined =>
    marks[id] ?? (linkedSet.has(id) ? "linked" : selected?.id === id ? "selected" : undefined);
  const verdictOf = (id: string) => (done && outcome ? outcome.cardVerdicts[id] : undefined);
  const resolvedCount = Math.min(denominator, lines.length + Object.keys(marks).length + caughtCount);

  const cardAria = (card: MatchCard, side: Side) => {
    const mark = marks[card.id];
    const state =
      mark === "stamped"
        ? `, ${stampLabel} 도장됨 — 클릭하면 해제`
        : mark === "discarded"
          ? `, ${binLabel}에 버림 — 클릭하면 복구`
          : mark === "escalated"
            ? ", 인계됨"
            : linkedSet.has(card.id)
              ? ", 선 연결됨 — 클릭하면 해제"
              : selected?.id === card.id
                ? ", 선택됨"
                : "";
    return `${side === "left" ? "왼쪽" : "오른쪽"} 카드 ${card.sprite}${card.label ? `, ${card.label}` : ""}${
      card.detector ? ", 탐지기 반응" : ""
    }${state}`;
  };

  const renderCard = (card: MatchCard, side: Side) => {
    const verdict = verdictOf(card.id);
    const mark = marks[card.id];
    const cue = data.visual_cues?.[card.id];
    return (
      <div key={card.id} className={styles.cardCell}>
        <button
          type="button"
          ref={registerCard(card.id, side)}
          className={styles.card}
          data-state={stateOf(card.id)}
          data-verdict={verdict}
          aria-pressed={selected?.id === card.id}
          aria-label={cardAria(card, side)}
          disabled={done || mark === "escalated"}
          onClick={() => toggleCard(side, card.id)}
        >
          <span className={styles.cardSprite}>{card.sprite}</span>
          {card.label ? <span className={styles.cardLabel}>{card.label}</span> : null}
          {cue ? <span className={styles.cardCue}>{pretty(cue)}</span> : null}
          {card.detector ? <span className={styles.lamp} aria-hidden="true" /> : null}
          {mark === "stamped" ? <span className={styles.stampBadge}>{stampLabel}</span> : null}
          {mark === "discarded" ? (
            <span className={styles.stampBadge} data-kind="discard">
              {binLabel}
            </span>
          ) : null}
          {mark === "escalated" ? (
            <span className={styles.stampBadge} data-kind="escalate">
              인계
            </span>
          ) : null}
          {verdict ? (
            <span className={common.mark} data-kind={verdict === "ok" ? "hit" : undefined} aria-hidden="true">
              {verdict === "ok" ? "✓" : "✕"}
            </span>
          ) : null}
        </button>
        {side === "left" && keyDefs.length > 0 && linkedSet.has(card.id) ? (
          <div className={styles.keyRow} role="group" aria-label={`${card.sprite} 객실 키 선택`}>
            <span className={styles.keyHint}>객실 키</span>
            {keyPalette.map((color) => (
              <button
                key={color}
                type="button"
                className={styles.keyDot}
                style={{ background: KEY_COLORS[color] ?? "#8a93a8" }}
                data-active={keysGiven[card.id] === color}
                aria-label={`${color} 키 전달`}
                aria-pressed={keysGiven[card.id] === color}
                disabled={done}
                onClick={() => giveKey(card.id, color)}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={common.shell}>
      <GameHud
        label="판정 진행"
        count={resolvedCount}
        total={denominator}
        remaining={remaining}
        timeLimit={game.time_limit}
      />

      <div className={styles.board} ref={boardRef} role="group" aria-label="매칭 보드 — 왼쪽 카드와 오른쪽 카드를 이으세요">
        <svg className={styles.wires} aria-hidden="true">
          {lines.map((ln) => {
            const a = anchors[ln.left];
            const b = anchors[ln.right];
            if (!a || !b) return null;
            const key = lineKey(ln);
            return (
              <line
                key={key}
                className={styles.wire}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                data-verdict={done && outcome ? (outcome.correctLineKeys.includes(key) ? "ok" : "bad") : undefined}
              />
            );
          })}
        </svg>
        <div className={styles.column}>{left.map((card) => renderCard(card, "left"))}</div>
        <div className={styles.column}>{right.map((card) => renderCard(card, "right"))}</div>
      </div>

      {flowBeads.length > 0 ? (
        <div className={styles.streamWrap}>
          <div className={styles.streamHead}>
            <span>흐름 검수 — 색이 튀는 구슬만 클릭</span>
            <span>
              이상치 {caughtCount} / {outliers.length}
            </span>
          </div>
          <div className={styles.streamTrack} role="group" aria-label="데이터 흐름 — 이상치 구슬만 클릭해 걸러내세요">
            {flowBeads.map((bead, i) => {
              const judged =
                beadClicks[bead.id] ?? (done && bead.kind === "outlier" ? ("missed" as const) : undefined);
              return (
                <button
                  key={bead.id}
                  type="button"
                  className={styles.bead}
                  style={{
                    animationDelay: `-${((i * FLOW_SECONDS) / flowBeads.length).toFixed(2)}s`,
                    top: `${10 + (i % 3) * 26}px`,
                  }}
                  data-judged={judged}
                  disabled={done || Boolean(beadClicks[bead.id])}
                  aria-label={`구슬 ${bead.sprite}`}
                  onClick={() => clickBead(bead.id, bead.kind)}
                >
                  {bead.sprite}
                  {judged === "caught" ? <span className={styles.beadMark}>✓</span> : null}
                  {judged === "wrong" ? <span className={styles.beadMark}>✕</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {sudden && suddenVisible ? (
        <div
          className={styles.sudden}
          role="group"
          aria-label="돌발 상황"
          data-settled={stagesAllDone && (!sudden.persists_after_stages || escalated)}
        >
          <div className={styles.suddenHead}>
            {sudden.sprite ? <span className={styles.suddenSprite}>{sudden.sprite}</span> : null}
            <span className={styles.suddenLabel}>{sudden.label ?? "돌발 상황 발생"}</span>
          </div>
          <div className={styles.suddenActions}>
            {displayStages.map((stage) => (
              <button
                key={stage.id}
                type="button"
                className={styles.stageBtn}
                data-done={stagesDone.includes(stage.id)}
                disabled={done || stagesDone.includes(stage.id)}
                onClick={() => pressStage(stage.id)}
              >
                <span>{stage.sprite ?? pretty(stage.id)}</span>
                {stage.label ? <span className={styles.stageLabel}>{stage.label}</span> : null}
              </button>
            ))}
            {(sudden.forbidden_actions ?? []).map((action) => (
              <button
                key={action.id}
                type="button"
                className={styles.stageBtn}
                disabled={done || pressedForbidden.includes(action.id)}
                data-done={pressedForbidden.includes(action.id)}
                onClick={() => pressForbiddenButton(action.id)}
              >
                <span>{pretty(action.id)}</span>
              </button>
            ))}
            {!isItemEscalate && data.escalate ? (
              <button
                type="button"
                className={styles.stageBtn}
                data-kind="escalate"
                data-done={escalated}
                disabled={done || escalated}
                onClick={pressStateEscalate}
              >
                <span>{data.escalate.label ?? "호출"}</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!done ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.actionBtn}
            disabled={!selected}
            onClick={() => markSelected("stamped")}
            aria-label={`선택한 카드에 ${stampLabel} 도장`}
          >
            {stampLabel} 도장
          </button>
          {data.discard ? (
            <button
              type="button"
              className={styles.actionBtn}
              disabled={!selected}
              onClick={() => markSelected("discarded")}
              aria-label={`선택한 카드를 ${binLabel}에 버리기`}
            >
              {binLabel}에 버리기
            </button>
          ) : null}
          {isItemEscalate && data.escalate ? (
            <button
              type="button"
              className={styles.actionBtn}
              disabled={!selected}
              onClick={() => markSelected("escalated")}
              aria-label={`선택한 카드를 인계 — ${data.escalate.label ?? "호출"}`}
            >
              {data.escalate.label ?? "호출"}
            </button>
          ) : null}
          {!isItemEscalate && data.escalate && !sudden ? (
            <button type="button" className={styles.actionBtn} disabled={escalated} onClick={pressStateEscalate}>
              {data.escalate.label ?? "호출"}
            </button>
          ) : null}
          {(data.forbidden ?? []).map((item) => (
            <button
              key={item.id}
              type="button"
              className={styles.actionBtn}
              disabled={pressedForbidden.includes(item.id)}
              onClick={() => pressForbiddenButton(item.id)}
            >
              {pretty(item.id)}
            </button>
          ))}
          <span className={styles.actionsSpacer} />
          <button type="button" className={styles.submitBtn} onClick={finish}>
            제출
          </button>
        </div>
      ) : null}

      {done && outcome ? (
        <ResultBar score={outcome.accuracy}>
          판정{" "}
          <b>
            {outcome.numerator}/{outcome.denominator}
          </b>{" "}
          정답
          {outcome.incidents > 0 ? (
            <>
              {" · "}감점 <b>{outcome.incidents}건</b> −{outcome.penalty}점
            </>
          ) : (
            <>
              {" · "}감점 <b>없음</b>
            </>
          )}
        </ResultBar>
      ) : null}
    </div>
  );
}
