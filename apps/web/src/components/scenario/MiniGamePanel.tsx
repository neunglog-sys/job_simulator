import { GameController } from "@phosphor-icons/react";
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
import type { EngineProps } from "./minigames/shared";
import type { Engine, MinigameDef, MinigameResult, PourData, SpotData } from "./minigames/types";

/**
 * 4단계 — 앞 단계에서 익힌 '신입의 주 업무'를 실제로 해보는 미니게임.
 *
 * 게임 정의는 시뮬레이션 응답의 `minigame`(= data/minigames/<slug>.yaml)에서 온다.
 * 엔진 11종 전부 연결 — 게임 데이터가 없는 시나리오만 '준비 중' 빈 창으로 폴백한다.
 * spot·pour는 초기 구현이라 자체 props를 쓰고, 나머지 9종은 EngineProps 공용 계약.
 */
type MiniGamePanelProps = {
  missionTitle: string;
  game: MinigameDef | null;
  /** 게임을 마쳤을 때 — engine을 붙여 서버로 보낸다. 스텁이면 result가 없다. */
  onClear: (result?: MinigameResult & { engine: string }) => void;
};

// EngineProps 계약을 따르는 9종. spot·pour는 아래에서 별도 분기.
const ENGINE_COMPONENTS: Partial<Record<Engine, React.ComponentType<EngineProps>>> = {
  match: MatchGame,
  sort: SortGame,
  place: PlaceGame,
  gauge: GaugeGame,
  route: RouteGame,
  sequence: SequenceGame,
  physics: PhysicsGame,
  trace: TraceGame,
  typing: TypingGame,
};

export function MiniGamePanel({ missionTitle, game, onClear }: MiniGamePanelProps) {
  const heading = game?.title || missionTitle;
  const EngineComponent = game ? ENGINE_COMPONENTS[game.engine] : undefined;
  const complete = (result: MinigameResult) => onClear({ ...result, engine: game!.engine });

  return (
    <div className={styles.missionOverlay} role="dialog" aria-modal="true" aria-label="실무 미니게임">
      <div className={styles.missionModal}>
        <div className={styles.missionHeader}>
          <div className={styles.missionHeadingText}>
            <span className={styles.missionKindBadge}>실무 미니게임</span>
            <h2>{heading}</h2>
          </div>
        </div>

        {game && (game.engine === "spot" || game.engine === "pour" || EngineComponent) ? (
          <>
            {game.intro ? <p className={styles.miniGameBody}>{game.intro}</p> : null}
            {game.engine === "spot" ? (
              <SpotGame data={toSpotData(game)} timeLimit={game.time_limit} onComplete={complete} />
            ) : game.engine === "pour" ? (
              <PourGame data={toPourData(game)} timeLimit={game.time_limit} onComplete={complete} />
            ) : EngineComponent ? (
              <EngineComponent game={game} onComplete={complete} />
            ) : null}
          </>
        ) : (
          <>
            <div className={styles.miniGameStage}>
              <GameController weight="duotone" aria-hidden="true" />
              <p className={styles.miniGameTitle}>준비 중인 단계예요</p>
              <p className={styles.miniGameBody}>
                앞에서 동료들에게 배운 <strong>신입의 주 업무</strong>를 직접 해보는 자리입니다.
                <br />
                자료를 살펴보고 숨은 문제를 찾아내는 실습이 이곳에 들어갈 예정이에요.
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

/** YAML의 scoring.decoy_penalty를 게임이 쓰는 형태로 옮긴다. */
function toSpotData(game: MinigameDef): SpotData {
  const penalty = game.scoring?.decoy_penalty;
  return {
    ...(game.data as SpotData),
    decoyPenalty: typeof penalty === "number" ? penalty : 10,
  };
}

function toPourData(game: MinigameDef): PourData {
  const over = game.scoring?.over_penalty;
  const under = game.scoring?.under_penalty;
  return {
    ...(game.data as PourData),
    overPenalty: typeof over === "number" ? over : 12,
    underPenalty: typeof under === "number" ? under : 8,
  };
}
