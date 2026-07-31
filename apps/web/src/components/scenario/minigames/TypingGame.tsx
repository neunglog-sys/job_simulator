import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import local from "../../../styles/typingGame.module.css";
import shared from "../../../styles/minigame.module.css";
import { PixelSprite } from "./PixelSprite";
import { GameHud, ResultBar, clampScore, elapsedSeconds, scoringOf, useCountdown } from "./shared";
import type { EngineProps } from "./shared";

/**
 * typing 엔진 — 낙하하는 코드 줄을 정확히 입력한다. backend 전용 예외 엔진(_SCHEMA.md §11).
 *
 * 채점(팀 확정 2026-07-20): 속도는 점수에 넣지 않는다.
 *   accuracy = 정확히 입력한 lines / line_count × 100
 *            − 핵심 예외 줄(critical_lines) 누락 × missed_critical_penalty
 *            − distractor 입력 × distractor_penalty
 * 오타 제출(불일치)은 mistakes 카운트만 하고 재시도를 허용한다. 걸린 시간은
 * time_seconds 로 따로 보내 리포트 서술용으로만 쓴다. 감점은 사건당 하나만 —
 * distractor 입력은 40 하나, 핵심 줄 누락은 40 하나(비율 하락은 감점이 아니라 기본식).
 *
 * 낙하는 PourGame 규약 — 위치는 등장 시각 기준으로 역산하고 rAF는 렌더에만 쓴다.
 * 탭이 백그라운드로 가도 setInterval 백스톱이 시각 기준으로 miss 를 확정하므로
 * 줄이 공중에 얼어붙지 않는다. prefers-reduced-motion 이면 낙하 대신
 * 정적 카드 + 남은 시간 바로 같은 마감 규칙을 보여준다.
 *
 * 표시 전용 스킨(data.presentation: dev_desk — backend-dev-day1):
 *   낙하 스테이지가 도트 모니터(터미널 창 프레임)가 되고, 코드 줄은 '알림 봉투' 카드에
 *   담겨 내려온다. 봉투는 line/distractor 가 겉모습이 완전히 동일하다 — 이 게임은
 *   글자 판독 공인 예외라 코드 내용(실제 DOM 텍스트)으로만 구분한다. 그래서 스킨
 *   모드에서는 정답을 유출하는 label 배지도 낙하 중에는 그리지 않는다.
 *   정확 입력 = 발송 차단 스탬프 연출, distractor 입력 = 경고 스탬프 연출(FX 는
 *   presentation 전용 — 채점·데이터 계약과 낙하 물리는 그대로다). presentation 키가
 *   없거나 스프라이트 파일이 없으면 기존 플레인 렌더로 폴백한다(PixelSprite 규약).
 */

type FallKind = "line" | "distractor";
type FallStatus = "typed" | "missed" | "distractor";

/** dev_desk 스킨 스프라이트 id — 파일이 없으면 폴백(spriteHidden)으로 조용히 빠진다. */
const SKIN_SPRITES = {
  frame: "모니터_터미널",
  keyboard: "키보드_자판",
  envelope: "알림_봉투",
  blocked: "발송차단_스탬프",
  warning: "경고_스탬프",
} as const;

/** 입력 확정 FX — 봉투가 차단 스탬프(정답)나 경고 스탬프(distractor)를 받고 사라진다. */
type FxKind = "blocked" | "warn";
type FxItem = { key: string; lane: number; topPct: number; kind: FxKind; text: string };

type FallLine = {
  id: string;
  text: string;
  kind: FallKind;
  label?: string;
  reason?: string;
};

/** 공백을 단일 공백으로 정규화 — 들여쓰기·이중 스페이스로 오타 판정하지 않는다. */
const normalize = (raw: string) => raw.replace(/\s+/g, " ").trim();

/** 첫 줄이 화면 준비보다 먼저 떨어지지 않게 주는 여유(ms). */
const SPAWN_LEAD_MS = 800;

/** 스테이지가 비었을 때 다음 줄을 이만큼 뒤로 당겨온다(ms) — 속도는 채점 밖이라 안전. */
const PULL_FORWARD_GAP_MS = 450;

function readItems(source: unknown, kind: FallKind): FallLine[] {
  if (!Array.isArray(source)) return [];
  const items: FallLine[] = [];
  source.forEach((entry) => {
    if (typeof entry !== "object" || entry === null) return;
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.text !== "string") return;
    items.push({
      id: row.id,
      text: row.text,
      kind,
      label: typeof row.label === "string" ? row.label : undefined,
      reason: typeof row.reason === "string" ? row.reason : undefined,
    });
  });
  return items;
}

function shuffle<T>(source: T[]): T[] {
  const copy = [...source];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function TypingGame({ game, onComplete }: EngineProps) {
  const lines = useMemo(() => readItems(game.data.lines, "line"), [game.data.lines]);
  const distractors = useMemo(() => readItems(game.data.distractors, "distractor"), [game.data.distractors]);
  // 낙하 순서 — lines 와 distractors 를 섞어 스펙 판단을 매번 요구한다(마운트 시 1회).
  const order = useMemo(() => shuffle([...lines, ...distractors]), [lines, distractors]);

  const fallSeconds =
    typeof game.data.fall_seconds === "number" && game.data.fall_seconds > 0 ? game.data.fall_seconds : 8;
  const fallMs = fallSeconds * 1000;

  const lineCount = scoringOf(game, "line_count", lines.length);
  const missedCriticalPenalty = scoringOf(game, "missed_critical_penalty", 40);
  const distractorPenalty = scoringOf(game, "distractor_penalty", 40);
  const criticalIds = useMemo(() => {
    const raw = game.scoring?.critical_lines;
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  }, [game.scoring]);

  // 표시 전용 스킨 — 이 값이 아니면(다른 typing 게임·필드 부재) 기존 플레인 렌더 그대로.
  const skin = game.data.presentation === "dev_desk";

  const [resolved, setResolved] = useState<Record<string, FallStatus>>({});
  const [typos, setTypos] = useState(0);
  const [value, setValue] = useState("");
  const [fx, setFx] = useState<FxItem[]>([]);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "warn" | "bad"; text: string } | null>(null);
  const [done, setDone] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const startedAt = useRef(Date.now());
  const finished = useRef(false);
  const composing = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  // 등장 시각(절대 ms) — 간격은 fall_seconds/2 라서 동시 낙하가 항상 1~2줄이다.
  const spawnAt = useRef<number[]>([]);
  if (spawnAt.current.length !== order.length) {
    const base = Date.now() + SPAWN_LEAD_MS;
    spawnAt.current = order.map((_, i) => base + (i * fallMs) / 2);
  }

  const finishNow = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    setDone(true);
    const typedLines = lines.filter((line) => resolved[line.id] === "typed").length;
    const missedCritical = criticalIds.filter((id) => resolved[id] !== "typed").length;
    const distractorTyped = distractors.filter((item) => resolved[item.id] === "distractor").length;
    const base = lineCount > 0 ? (typedLines / lineCount) * 100 : 0;
    onComplete({
      accuracy: clampScore(base - missedCritical * missedCriticalPenalty - distractorTyped * distractorPenalty),
      time_seconds: elapsedSeconds(startedAt),
      mistakes: typos + distractorTyped,
    });
  }, [lines, distractors, criticalIds, resolved, typos, lineCount, missedCriticalPenalty, distractorPenalty, onComplete]);

  const { remaining } = useCountdown(game.time_limit, done, finishNow);

  // 시각 기준 진행 — rAF는 렌더 전용, miss 확정은 interval 백스톱이 보증한다.
  useEffect(() => {
    if (done) return;
    const tick = () => {
      const stamp = Date.now();
      order.forEach((item, i) => {
        if (!resolved[item.id] && spawnAt.current[i] + fallMs <= stamp) {
          setResolved((prev) => (prev[item.id] ? prev : { ...prev, [item.id]: "missed" }));
          setFeedback(
            item.kind === "line"
              ? { tone: "warn", text: `줄을 놓쳤습니다 — ${item.label ?? item.text}` }
              : { tone: "ok", text: "스펙에 없는 줄을 무시하고 흘려보냈습니다 — 올바른 판단" },
          );
        }
      });
      setNow(stamp);
    };
    let raf: number | null = null;
    if (!reducedMotion) {
      const loop = () => {
        tick();
        raf = window.requestAnimationFrame(loop);
      };
      raf = window.requestAnimationFrame(loop);
    }
    const interval = window.setInterval(tick, reducedMotion ? 200 : 750);
    tick();
    return () => {
      if (raf !== null) window.cancelAnimationFrame(raf);
      window.clearInterval(interval);
    };
  }, [done, order, resolved, fallMs, reducedMotion]);

  // 스테이지가 비면 다음 줄을 당겨온다 — 속도는 점수 밖이므로 기다림만 줄인다.
  useEffect(() => {
    if (done) return;
    const stamp = Date.now();
    const spawns = spawnAt.current;
    const hasActive = order.some(
      (item, i) => !resolved[item.id] && spawns[i] <= stamp && stamp < spawns[i] + fallMs,
    );
    if (hasActive) return;
    const nextIdx = order.findIndex((item, i) => !resolved[item.id] && spawns[i] > stamp);
    if (nextIdx === -1) return;
    const shift = spawns[nextIdx] - (stamp + PULL_FORWARD_GAP_MS);
    if (shift <= 0) return;
    for (let i = nextIdx; i < spawns.length; i += 1) spawns[i] -= shift;
    setNow(Date.now());
  }, [resolved, done, order, fallMs]);

  // 전 줄 처리(입력·낙과·무시)되면 자동 종료 — 남은 시간을 기다리게 하지 않는다.
  useEffect(() => {
    if (done) return;
    if (order.length === 0 || order.every((item) => resolved[item.id])) finishNow();
  }, [resolved, done, order, finishNow]);

  // 입력창 자동 포커스 — 게임 내 유일한 조작 지점이다.
  useEffect(() => {
    if (!done) inputRef.current?.focus();
  }, [done]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (done || composing.current) return;
    const typed = normalize(value);
    if (!typed) return;
    const stamp = Date.now();
    const hitIndex = order.findIndex(
      (item, i) =>
        !resolved[item.id] &&
        spawnAt.current[i] <= stamp &&
        stamp < spawnAt.current[i] + fallMs &&
        normalize(item.text) === typed,
    );
    if (hitIndex === -1) {
      // 오타 — mistakes 만 세고 입력을 남겨 고쳐 낼 수 있게 한다(점수 감점 없음).
      setTypos((count) => count + 1);
      setFeedback({ tone: "warn", text: "화면의 줄과 일치하지 않습니다 — 오타를 고쳐 다시 제출하세요" });
      return;
    }
    const hit = order[hitIndex];
    // 표시 전용 FX — 방금 있던 낙하 위치에서 봉투가 스탬프를 받고 사라진다.
    // reduced-motion 은 FX 를 만들지 않는다(애니메이션 자체가 연출 전부라서).
    if (skin && !reducedMotion) {
      const progress = Math.min(1, Math.max(0, (stamp - spawnAt.current[hitIndex]) / fallMs));
      const fxKey = `${hit.id}-${stamp}`;
      setFx((list) => [
        ...list,
        {
          key: fxKey,
          lane: hitIndex % 2,
          topPct: progress * 100,
          kind: hit.kind === "line" ? "blocked" : "warn",
          text: hit.text,
        },
      ]);
      window.setTimeout(() => setFx((list) => list.filter((item) => item.key !== fxKey)), 1000);
    }
    if (hit.kind === "line") {
      setResolved((prev) => (prev[hit.id] ? prev : { ...prev, [hit.id]: "typed" }));
      setFeedback({ tone: "ok", text: `구현 완료 — ${hit.label ?? hit.id}` });
    } else {
      // 원문 금지행동('조건 확인 없이 전체 발송') — reason 을 그대로 보여준다.
      setResolved((prev) => (prev[hit.id] ? prev : { ...prev, [hit.id]: "distractor" }));
      setFeedback({ tone: "bad", text: `스펙에 없는 줄입니다 — ${hit.reason ?? "요구된 처리가 아닙니다"} (감점)` });
    }
    setValue("");
    inputRef.current?.focus();
  };

  // IME 조합 중 Enter(한글 조합 확정)는 제출로 취급하지 않는다.
  const guardComposedEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing)) {
      event.preventDefault();
    }
  };

  const typedLines = lines.filter((line) => resolved[line.id] === "typed").length;
  const missedCritical = criticalIds.filter((id) => resolved[id] !== "typed").length;
  const distractorTyped = distractors.filter((item) => resolved[item.id] === "distractor").length;
  const finalScore = clampScore(
    (lineCount > 0 ? (typedLines / lineCount) * 100 : 0) -
      missedCritical * missedCriticalPenalty -
      distractorTyped * distractorPenalty,
  );

  const activeCards = order
    .map((item, i) => ({ item, spawn: spawnAt.current[i], lane: i % 2 }))
    .filter(({ item, spawn }) => !resolved[item.id] && spawn <= now && now < spawn + fallMs)
    .map((card) => ({ ...card, progress: Math.min(1, Math.max(0, (now - card.spawn) / fallMs)) }));

  // 입력 중 매칭 하이라이트 — 지금 치는 내용과 앞부분이 일치하는 줄에 링을 띄운다.
  // 중립(액센트) 색을 쓴다: distractor 도 똑같이 빛나야 정오답을 유출하지 않는다.
  const typedNorm = normalize(value);

  const cards = activeCards.map(({ item, lane, progress }) => (
    <div
      key={item.id}
      className={reducedMotion ? local.staticCard : local.card}
      data-lane={lane}
      data-danger={progress > 0.72}
      data-match={typedNorm.length > 0 && normalize(item.text).startsWith(typedNorm)}
      style={reducedMotion ? undefined : { top: `${progress * 100}%`, transform: `translateY(${-progress * 100}%)` }}
    >
      {/* 스킨 모드에선 label 배지를 낙하 중 감춘다 — 봉투 겉모습이 전부 동일해야 한다 */}
      {item.label && !skin ? <span className={local.badge}>{item.label}</span> : null}
      <span className={local.cardRow}>
        {skin ? (
          <span className={local.envelope} aria-hidden="true">
            <PixelSprite id={SKIN_SPRITES.envelope} label="알림 봉투" size={30} fallbackClassName={local.spriteHidden} />
          </span>
        ) : null}
        <code className={local.code}>{item.text}</code>
      </span>
      {reducedMotion ? (
        <span className={local.timeTrack} aria-hidden="true">
          <span className={local.timeLeft} style={{ width: `${(1 - progress) * 100}%` }} data-low={progress > 0.72} />
        </span>
      ) : null}
    </div>
  ));

  // 입력 확정 FX — 채점과 무관한 잔상. 봉투+코드가 스탬프를 받고 사라진다.
  const fxCards =
    skin && !reducedMotion
      ? fx.map((item) => (
          <div
            key={item.key}
            className={local.fxCard}
            data-lane={item.lane}
            style={{ top: `${item.topPct}%`, transform: `translateY(${-item.topPct}%)` }}
            aria-hidden="true"
          >
            <span className={local.fxInner} data-kind={item.kind}>
              <span className={local.envelope}>
                <PixelSprite id={SKIN_SPRITES.envelope} label="알림 봉투" size={30} fallbackClassName={local.spriteHidden} />
              </span>
              <code className={local.code}>{item.text}</code>
              <span className={local.fxStamp}>
                <PixelSprite
                  id={item.kind === "blocked" ? SKIN_SPRITES.blocked : SKIN_SPRITES.warning}
                  label={item.kind === "blocked" ? "발송 차단" : "경고"}
                  size={item.kind === "blocked" ? 30 : 34}
                  fallbackClassName={local.spriteHidden}
                />
              </span>
            </span>
          </div>
        ))
      : null;

  return (
    <div className={shared.shell}>
      <GameHud
        label="예외 처리 구현"
        count={typedLines}
        total={lineCount}
        remaining={remaining}
        timeLimit={game.time_limit}
      />

      <div
        className={reducedMotion ? local.staticList : skin ? `${local.stage} ${local.stageSkin}` : local.stage}
        role="group"
        aria-label={reducedMotion ? "입력할 코드 줄 목록" : "내려오는 코드 줄"}
      >
        {reducedMotion ? (
          <>
            {cards}
            {activeCards.length === 0 && !done ? <span className={local.stageHint}>다음 줄이 내려옵니다…</span> : null}
          </>
        ) : (
          <>
            {skin ? (
              // 도트 모니터 프레임 — 화면 전체에 늘려 깐다(RouteGame mapLayer 수법).
              // 파일이 없으면 spriteHidden 폴백으로 조용히 빠지고 플레인 스테이지만 남는다.
              <div className={local.frameLayer} aria-hidden="true">
                <PixelSprite id={SKIN_SPRITES.frame} label="터미널 창" size={640} fallbackClassName={local.spriteHidden} />
              </div>
            ) : null}
            <div className={local.fallLayer}>
              {cards}
              {fxCards}
              {activeCards.length === 0 && fx.length === 0 && !done ? (
                <span className={local.stageHint}>다음 줄이 내려옵니다…</span>
              ) : null}
            </div>
          </>
        )}
      </div>

      <div className={local.feedback} role="status" aria-live="polite" data-tone={feedback?.tone}>
        {feedback ? feedback.text : "스펙에 있는 줄만 정확히 입력하세요. 스펙에 없는 줄은 무시해서 흘려보내는 것이 정답입니다."}
      </div>

      {!done ? (
        <form className={local.inputRow} onSubmit={handleSubmit}>
          {skin ? (
            // 책상의 키보드 실루엣 — 입력창 옆 장식. 파일이 없으면 아무것도 안 그린다.
            <span className={local.deskKeyboard} aria-hidden="true">
              <PixelSprite id={SKIN_SPRITES.keyboard} label="키보드" size={76} fallbackClassName={local.spriteHidden} />
            </span>
          ) : null}
          <input
            ref={inputRef}
            className={local.input}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={guardComposedEnter}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="코드 입력 — 내려오는 줄과 정확히 일치하면 완료됩니다"
            placeholder="내려오는 코드 줄을 그대로 입력하고 Enter"
          />
          <button type="submit" className={local.submit}>
            입력
          </button>
        </form>
      ) : null}

      {done ? (
        <ResultBar score={finalScore}>
          정확 입력{" "}
          <b>
            {typedLines}/{lineCount}
          </b>
          {missedCritical > 0 ? (
            <>
              {" · "}핵심 예외 누락 <b>{missedCritical}건</b> (−{missedCriticalPenalty}/건)
            </>
          ) : (
            <>
              {" · "}핵심 예외 <b>모두 구현</b>
            </>
          )}
          {distractorTyped > 0 ? (
            <>
              {" · "}스펙 외 입력 <b>{distractorTyped}건</b> (−{distractorPenalty}/건)
            </>
          ) : null}
          {typos > 0 ? (
            <>
              {" · "}오타 재시도 <b>{typos}회</b>
            </>
          ) : null}
        </ResultBar>
      ) : null}
    </div>
  );
}
