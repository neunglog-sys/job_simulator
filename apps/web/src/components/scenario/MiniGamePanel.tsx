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
import type { Engine, MinigameDef, MinigameResult } from "./minigames/types";

/**
 * 4단계 — 앞 단계에서 익힌 '신입의 주 업무'를 실제로 해보는 미니게임.
 *
 * 게임 정의는 시뮬레이션 응답의 `minigame`(= data/minigames/<slug>.yaml)에서 온다.
 * 엔진 11종 전부 EngineProps 공용 계약으로 연결 — 게임 데이터가 없는 시나리오만
 * '준비 중' 빈 창으로 폴백한다.
 */
type MiniGamePanelProps = {
  missionTitle: string;
  game: MinigameDef | null;
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

        {game && EngineComponent ? (
          <>
            {game.intro ? <p className={styles.miniGameBody}>{game.intro}</p> : null}
            <EngineComponent game={game} onComplete={complete} />
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
