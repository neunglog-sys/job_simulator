import { GameController } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type * as React from "react";
import styles from "../../styles/scenarioGame.module.css";
import { GaugeGame } from "./minigames/GaugeGame";
import { MatchGame } from "./minigames/MatchGame";
import { PhysicsGame } from "./minigames/PhysicsGame";
import { PlaceGame } from "./minigames/PlaceGame";
import { PourGame } from "./minigames/PourGame";
import { RouteGame } from "./minigames/RouteGame";
import { SequenceGame } from "./minigames/SequenceGame";
import { SortGame } from "./minigames/SortGame";
import { SpotGame } from "./minigames/SpotGame";
import { TraceGame } from "./minigames/TraceGame";
import { TypingGame } from "./minigames/TypingGame";
import { SnsResearchGame } from "./minigames/SnsResearchGame";
import { SnsPostDesignGame } from "./minigames/SnsPostDesignGame";
import type { EngineProps } from "./minigames/shared";
import type { Engine, MinigameDef, MinigameResult } from "./minigames/types";

/**
 * 4단계 — 앞 단계에서 익힌 '신입의 주 업무'를 실제로 해보는 미니게임.
 *
 * 게임 정의는 시뮬레이션 응답의 `minigame`(= data/minigames/<slug>.yaml)에서 온다.
 * 등록 엔진 전부 EngineProps 공용 계약으로 연결 — 게임 데이터가 없는 시나리오만
 * '준비 중' 빈 창으로 폴백한다.
 */
type MiniGamePanelProps = {
  missionTitle: string;
  game: MinigameDef | null;
  /** 시나리오에 게임이 여러 개면 이 순서대로 각각 결과 화면을 거쳐 실행한다. */
  games?: MinigameDef[];
  /** 게임 정의가 아직 없을 때 임무 배정 문구를 보여준다. */
  placeholderDescription?: string;
  /** 게임을 마쳤을 때 — engine을 붙여 서버로 보낸다. 스텁이면 result가 없다. */
  onClear: (result?: MinigameResult & { engine: string }) => void;
};

const ENGINE_COMPONENTS: Partial<Record<Engine, React.ComponentType<EngineProps>>> = {
  spot: SpotGame,
  pour: PourGame,
  match: MatchGame,
  sort: SortGame,
  place: PlaceGame,
  gauge: GaugeGame,
  route: RouteGame,
  sequence: SequenceGame,
  physics: PhysicsGame,
  trace: TraceGame,
  typing: TypingGame,
  research: SnsResearchGame,
  design: SnsPostDesignGame,
};

/**
 * 여러 시도의 반영 점수 — 첫 시도 가중이 가장 크고 재도전은 점점 적게 반영한다.
 * 가중치 wᵢ = 0.5^(i-1) (첫 시도 1, 2회차 0.5, 3회차 0.25 …) 의 가중평균.
 * 예: [60, 90] → (60·1 + 90·0.5)/1.5 = 70. accuracy 만 가중평균하고,
 * time_seconds·mistakes 는 서술용이라 첫 시도값을 대표로 남긴다.
 */
function reflectedResult(attempts: MinigameResult[]): MinigameResult {
  if (attempts.length === 0) return { accuracy: 0, time_seconds: 0, mistakes: 0 };
  let weightSum = 0;
  let accSum = 0;
  attempts.forEach((r, i) => {
    const w = 0.5 ** i;
    weightSum += w;
    accSum += w * (r.accuracy ?? 0);
  });
  return {
    accuracy: Math.round(accSum / weightSum),
    time_seconds: attempts.reduce((s, r) => s + (r.time_seconds ?? 0), 0),
    mistakes: attempts[0].mistakes ?? 0,
  };
}

export function MiniGamePanel({
  missionTitle,
  game,
  games,
  placeholderDescription,
  onClear,
}: MiniGamePanelProps) {
  const queue = games?.length ? games : game ? [game] : [];
  const queueKey = queue.map((item) => item.id ?? `${item.engine}:${item.title}`).join("|");
  const [gameIndex, setGameIndex] = useState(0);
  const activeGame = queue[gameIndex] ?? null;
  const heading = activeGame?.title || missionTitle;
  const EngineComponent = activeGame ? ENGINE_COMPONENTS[activeGame.engine] : undefined;
  const gameId = activeGame?.id?.trim();
  const backgroundId =
    typeof activeGame?.data?.background_id === "string" ? activeGame.data.background_id.trim() : gameId;
  const backgroundUrl = backgroundId
    ? `${import.meta.env.BASE_URL}assets/minigames/backgrounds/cartoon-day-v3/${encodeURIComponent(`${backgroundId}-background-cartoon-day-v3.webp`)}`
    : null;
  const backgroundStyle = backgroundUrl
    ? ({ "--minigame-background-image": `url("${backgroundUrl}")` } as React.CSSProperties)
    : undefined;

  // 다시하기 — 완료를 가로채 시도를 누적하고, 재도전 시 엔진을 remount(key)로 리셋한다.
  // 엔진은 손대지 않으므로 전 게임에 공통 적용된다. '완료'를 눌러야 반영 점수로 확정된다.
  const [attempts, setAttempts] = useState<MinigameResult[]>([]);
  const [completedGames, setCompletedGames] = useState<MinigameResult[]>([]);
  const [attemptKey, setAttemptKey] = useState(0);
  const [lastResult, setLastResult] = useState<MinigameResult | null>(null);

  // 시나리오의 게임 목록이 바뀌면 전체 진행과 시도 기록을 초기화.
  useEffect(() => {
    setGameIndex(0);
    setAttempts([]);
    setCompletedGames([]);
    setAttemptKey(0);
    setLastResult(null);
  }, [queueKey]);

  const handleAttempt = (result: MinigameResult) => {
    if (activeGame?.engine === "research" || activeGame?.engine === "design") {
      onClear({ ...result, engine: activeGame.engine });
      return;
    }
    setAttempts((prev) => [...prev, result]);
    setLastResult(result);
  };
  const retry = () => {
    setLastResult(null);
    setAttemptKey((k) => k + 1);
  };
  const finishAll = () => {
    if (!activeGame) {
      onClear();
      return;
    }
    const current = reflectedResult(attempts);
    if (gameIndex < queue.length - 1) {
      setCompletedGames((previous) => [...previous, current]);
      setGameIndex((index) => index + 1);
      setAttempts([]);
      setLastResult(null);
      setAttemptKey((key) => key + 1);
      return;
    }
    const results = [...completedGames, current];
    const combined: MinigameResult = {
      accuracy: Math.round(
        results.reduce((sum, result) => sum + (result.accuracy ?? 0), 0) / results.length,
      ),
      time_seconds: results.reduce((sum, result) => sum + (result.time_seconds ?? 0), 0),
      mistakes: results.reduce((sum, result) => sum + (result.mistakes ?? 0), 0),
    };
    onClear({ ...combined, engine: activeGame.engine });
  };
  const reflected = reflectedResult(attempts);

  return (
    <div
      className={`${styles.missionOverlay} ${styles.miniGameOverlay}`}
      role="dialog"
      aria-modal="true"
      aria-label="실무 미니게임"
    >
      <div
        className={`${styles.missionModal} ${styles.miniGameModal}`}
        data-minigame-engine={activeGame?.engine}
      >
        <div className={styles.missionHeader}>
          <div className={styles.missionHeadingText}>
            <span className={styles.missionKindBadge}>실무 미니게임</span>
            <h2>{heading}</h2>
          </div>
        </div>

        {activeGame && EngineComponent ? (
          <>
            {queue.length > 1 ? (
              <p className={styles.miniGameBody}>
                게임 <strong>{gameIndex + 1}</strong> / {queue.length} · {activeGame.intro}
              </p>
            ) : activeGame.intro ? (
              <p className={styles.miniGameBody}>{activeGame.intro}</p>
            ) : null}
            {/* 게임 영역은 모달 안에서 스크롤되게 가둔다 — 카드/아이템이 많아도(match 15장 등)
                모달·뷰포트 밖으로 넘치지 않는다. match 선 좌표는 보드 기준 상대값이라
                보드가 한 덩어리로 스크롤돼도 선이 어긋나지 않는다. */}
            <div className={styles.missionGameScroll}>
              <div
                className={styles.miniGameRuntime}
                data-cartoon-background={backgroundUrl ? "true" : undefined}
                data-minigame-id={gameId}
                style={backgroundStyle}
              >
                <EngineComponent key={`${gameId ?? activeGame.engine}-${attemptKey}`} game={activeGame} onComplete={handleAttempt} />
              </div>
            </div>
            {/* 다시하기 바 — 게임 종료 후 나타난다. 재도전은 첫 시도보다 적게 반영된다. */}
            {lastResult ? (
              <div className={styles.missionRetryBar} role="status">
                <span className={styles.missionRetryScore}>
                  이번 <b>{lastResult.accuracy ?? 0}점</b>
                  {attempts.length > 1 ? (
                    <>
                      {" · "}반영 <b>{reflected.accuracy}점</b>
                      <span className={styles.missionRetryCount}>{attempts.length}회</span>
                    </>
                  ) : null}
                </span>
                <span className={styles.missionRetryActions}>
                  <button className={styles.missionRetryBtn} type="button" onClick={retry}>
                    다시하기
                  </button>
                  <button className={styles.missionSubmit} type="button" onClick={finishAll}>
                    {gameIndex < queue.length - 1 ? "다음 게임으로 →" : "완료하고 계속 →"}
                  </button>
                </span>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className={styles.miniGameStage}>
              <GameController weight="duotone" aria-hidden="true" />
              <p className={styles.miniGameTitle}>준비 중인 단계예요</p>
              <p className={styles.miniGameBody}>
                {placeholderDescription ?? (
                  <>
                    앞에서 동료들에게 배운 <strong>신입의 주 업무</strong>를 직접 해보는 자리입니다.
                    <br />
                    자료를 살펴보고 숨은 문제를 찾아내는 실습이 이곳에 들어갈 예정이에요.
                  </>
                )}
              </p>
            </div>
            <div className={styles.missionFooter}>
              <button className={styles.missionSubmit} type="button" onClick={() => onClear()}>
                완료하고 계속 →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
