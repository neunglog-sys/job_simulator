import { useEffect, useMemo, useRef, useState } from "react";
import base from "../../../styles/minigame.module.css";
import styles from "../../../styles/spotGame.module.css";
import { PixelSprite } from "./PixelSprite";
import { SCENE } from "./types";
import {
  clampScore,
  elapsedSeconds,
  GameHud,
  ResultBar,
  scoringOf,
  useCountdown,
  type EngineProps,
} from "./shared";

/**
 * spot 엔진 — 화면에서 결함·이상을 찾아 표시한다. 5개 시나리오가 쓴다:
 *   ys-05(건설 순회점검) · jm-03(외부점검) · ms-05(불량 골라내기)
 *   sns-01(카드뉴스 검수) · yg-01(배너 시안 검수)
 *
 * 계약: 다른 엔진과 동일한 { game, onComplete }(EngineProps).
 *   decoy_penalty 는 game.scoring 에서, time_limit 는 game.time_limit 에서 읽는다.
 *
 * 채점: 찾은 targets 비율에서 decoy(정상인데 누른 것) 페널티를 뺀다. decoy가 없으면
 * 전부 눌러서 만점이 나오므로 데이터 쪽에서 반드시 넣게 되어 있다(_SCHEMA.md 규칙 5).
 *
 * 렌더: data.scene 도트 배경 위에 target/decoy 를 PixelSprite 로 at 좌표(960×440 논리
 * 캔버스 → % 환산)에 얹는다. 정답/오답은 아트의 상태 차이로만 구분되고(규칙 1 —
 * 스프라이트에 정답을 유출하는 글자 금지), label 은 표시(발견) 후에만 캡션으로 나온다.
 * 아트가 없는 게임은 PixelSprite 폴백(라벨 칩) + 그라데이션 배경으로 기존처럼 동작한다.
 *
 * 표시(mark): x·shutter = 오브젝트 위 X 표시 + 셔터 플래시("사진 찍어 표시해 와라"),
 * tag = 태그 배지(점검표에 태그). 정답 초록·오답 빨강 판정은 공통.
 */

type Picked = { id: string; kind: "hit" | "miss" };

type SpotHotspot = {
  id: string;
  sprite: string;
  at: [number, number];
  label?: string;
  /** 표시 전용 — 스프라이트 표시 폭(960×440 논리 캔버스 단위, 기본 72). 채점과 무관. */
  size?: number;
};

/** 견본(참조) 패널 — 표시 전용. '정상 기준'의 일반 예시를 보여줄 뿐 특정 정답을
 *  지목하지 않는다(규칙 1·8). 있으면 '견본 보기' 토글이 뜨고, 없으면 미표시(폴백). */
type SpotReference = {
  /** public/assets/minigames/<sprite>.svg — 표준(정상 기준) 예시 이미지 id */
  sprite: string;
  label?: string;
};

/** YAML data 블록 — types.ts 를 건드리지 않으려 로컬로 정의한다. */
type SpotData = {
  scene?: string;
  mark?: "x" | "tag" | "shutter";
  targets?: SpotHotspot[];
  decoys?: SpotHotspot[];
  /** 표시 전용(신규) — 있으면 '견본 보기' 오버레이가 켜진다. 채점과 무관. */
  reference?: SpotReference;
};

const pretty = (raw: string) => raw.replace(/_/g, " ");

/** 표시 폭 기본값 — 960 논리 캔버스 기준. YAML size 로 오브젝트별 조정(표시 전용). */
const DEFAULT_SPRITE_W = 72;

export function SpotGame({ game, onComplete }: EngineProps) {
  const data = game.data as SpotData;
  const targets = useMemo(() => data.targets ?? [], [data.targets]);
  const decoys = useMemo(() => data.decoys ?? [], [data.decoys]);
  const markMode: "x" | "tag" | "shutter" =
    data.mark === "tag" ? "tag" : data.mark === "shutter" ? "shutter" : "x";
  const decoyPenalty = scoringOf(game, "decoy_penalty", 10);

  // 견본(참조) 패널 — sprite 가 있을 때만 토글을 노출한다. 없으면 회귀 없이 폴백.
  const reference = data.reference ?? null;
  const hasReference = Boolean(reference?.sprite);
  const [showRef, setShowRef] = useState(false);

  const [picked, setPicked] = useState<Picked[]>([]);
  const [flash, setFlash] = useState(false);
  const [done, setDone] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const finished = useRef(false);
  const flashTimer = useRef<number | null>(null);

  // 장면 실측 폭 — 논리 캔버스(960) 기준 스프라이트 폭을 실제 px 로 환산한다.
  // (컨테이너 폭이 %-불명이라 이미지 width 속성만으로는 반응형이 안 된다)
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageW, setStageW] = useState(0);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hits = picked.filter((p) => p.kind === "hit").length;
  const misses = picked.filter((p) => p.kind === "miss").length;
  const total = targets.length;

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    const raw = total > 0 ? (hits / total) * 100 - misses * decoyPenalty : 0;
    const score = clampScore(raw);
    setFinalScore(score);
    setDone(true);
    onComplete({
      accuracy: score,
      time_seconds: elapsedSeconds(startedAt),
      mistakes: misses,
    });
  };

  const { remaining, startedAt } = useCountdown(game.time_limit, done, finish);

  // 전부 찾으면 즉시 종료 — 남은 시간을 멍하니 기다리게 하지 않는다.
  // finish 는 렌더마다 새로 잡히므로 ref 경유로 최신 클로저를 부른다(의존성 순환 회피).
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    if (!done && total > 0 && hits === total) finishRef.current();
  }, [hits, total, done]);

  useEffect(() => () => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
  }, []);

  const pick = (id: string, kind: "hit" | "miss") => {
    if (done || picked.some((p) => p.id === id)) return;
    setPicked((current) => [...current, { id, kind }]);
    // 원문의 "사진 찍어 표시해 와라" — x·shutter 표시일 때만 셔터를 터뜨린다
    if (markMode !== "tag") {
      setFlash(true);
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(false), 200);
    }
  };

  const stateOf = (id: string) => picked.find((p) => p.id === id)?.kind ?? null;

  /** 논리 px(960 기준) → 실제 px. 초기 렌더(실측 전)는 1:1 로 그린다. */
  const pxOf = (logical: number) =>
    Math.max(20, Math.round((logical * (stageW || SCENE.w)) / SCENE.w));

  const renderSpot = (spot: SpotHotspot, kind: "hit" | "miss", index: number) => {
    const state = stateOf(spot.id);
    const found = state !== null;
    const ariaAfter =
      kind === "hit" ? spot.label ?? "이상 발견 — 표시됨" : "정상 위치 — 오표시(감점)";
    return (
      <button
        key={spot.id}
        type="button"
        className={styles.hotspot}
        style={{
          left: `${(spot.at[0] / SCENE.w) * 100}%`,
          top: `${(spot.at[1] / SCENE.h) * 100}%`,
        }}
        data-state={state ?? undefined}
        disabled={done || found}
        onClick={() => pick(spot.id, kind)}
        aria-label={found ? ariaAfter : `점검 지점 ${index + 1}`}
      >
        {/* 아트가 없으면 라벨 칩 폴백 — 기존 spot 화면 그대로(다른 4개 게임) */}
        <PixelSprite
          id={spot.sprite}
          label={pretty(spot.sprite)}
          size={pxOf(spot.size ?? DEFAULT_SPRITE_W)}
          fallbackClassName={styles.chip}
        />
        <span className={styles.ring} aria-hidden="true" />
        {found ? (
          markMode === "tag" ? (
            <span className={styles.tagBadge} data-kind={state} aria-hidden="true">
              {state === "hit" ? "✓" : "✕"}
            </span>
          ) : (
            <span className={styles.cross} data-kind={state} aria-hidden="true" />
          )
        ) : null}
        {found && kind === "hit" && spot.label ? (
          <span className={styles.caption}>{spot.label}</span>
        ) : null}
      </button>
    );
  };

  return (
    <div className={base.shell}>
      <GameHud
        label="찾은 위험요소"
        count={hits}
        total={total}
        remaining={remaining}
        timeLimit={game.time_limit}
      />

      {/* 견본(참조) 토글 — reference 가 있는 게임에서만 뜬다(sns-01·yg-01). */}
      {hasReference ? (
        <div className={styles.refBar}>
          <button
            type="button"
            className={styles.refToggle}
            onClick={() => setShowRef((open) => !open)}
            aria-expanded={showRef}
            aria-controls="spot-reference-panel"
            data-open={showRef}
          >
            <span className={styles.refToggleIcon} aria-hidden="true">
              {showRef ? "✕" : "▤"}
            </span>
            {showRef ? "견본 닫기" : "견본 보기"}
          </button>
        </div>
      ) : null}

      <div ref={stageRef} className={styles.stage} role="group" aria-label="현장 점검 화면">
        {data.scene ? (
          // 도트 배경 장면 — 파일이 없으면 조용히 빠지고 그라데이션 배경만 남는다
          <div className={styles.sceneLayer} aria-hidden="true">
            <PixelSprite
              id={data.scene}
              label=""
              size={SCENE.w}
              fallbackClassName={styles.spriteHidden}
            />
          </div>
        ) : null}

        {targets.map((target, i) => renderSpot(target, "hit", i))}
        {decoys.map((decoy, i) => renderSpot(decoy, "miss", targets.length + i))}

        <span className={styles.shutter} data-flash={flash} aria-hidden="true" />

        {/* 견본 오버레이 — '정상 기준'의 일반 예시. 스크림이 스테이지를 덮어 핫스팟
            오조작을 막는다. 닫기는 ✕ 버튼 또는 상단 '견본 닫기' 토글로 한다(키보드 접근).
            특정 정답을 지목하지 않는다(규칙 1·8). */}
        {hasReference && showRef ? (
          <div className={styles.refOverlay} aria-hidden="false">
            <div
              id="spot-reference-panel"
              className={styles.refCard}
              role="dialog"
              aria-label="정상 기준 견본"
            >
              <div className={styles.refHead}>
                <span className={styles.refTitle}>
                  {reference?.label ?? "정상 기준 견본"}
                </span>
                <button
                  type="button"
                  className={styles.refClose}
                  onClick={() => setShowRef(false)}
                  aria-label="견본 닫기"
                >
                  ✕
                </button>
              </div>
              <div className={styles.refFigure}>
                <PixelSprite
                  id={reference!.sprite}
                  label={reference?.label ?? "정상 기준 견본"}
                  size={220}
                  fallbackClassName={styles.chip}
                />
              </div>
              <p className={styles.refNote}>
                정상 기준의 예시입니다. 각 항목을 견본과 견주어 스스로 판단하세요.
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {done ? (
        <ResultBar score={finalScore}>
          위험요소{" "}
          <b>
            {hits}/{total}
          </b>{" "}
          발견
          {misses > 0 ? (
            <>
              {" · "}정상인 곳을 <b>{misses}번</b> 표시 (감점)
            </>
          ) : (
            <>
              {" · "}오표시 <b>없음</b>
            </>
          )}
        </ResultBar>
      ) : null}
    </div>
  );
}
