import { UserFocus } from "@phosphor-icons/react";
import type { Position } from "./types";
import styles from "../../styles/scenarioGame.module.css";

type PlayerSpriteProps = {
  position: Position;
};

export const PLAYER_SIZE = {
  width: 76,
  height: 96,
} as const;

export function PlayerSprite({ position }: PlayerSpriteProps) {
  return (
    <div
      className={styles.playerSprite}
      style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
      role="img"
      aria-label="플레이어 캐릭터"
    >
      <span className={styles.playerAura} aria-hidden="true" />
      <span className={styles.playerPortrait} aria-hidden="true">
        <UserFocus weight="duotone" />
      </span>
      <span className={styles.playerName}>나</span>
    </div>
  );
}
