import { UserFocus } from "@phosphor-icons/react";
import { useState } from "react";
import type { NpcFacing } from "./NpcSprite";
import type { Position } from "./types";
import styles from "../../styles/scenarioGame.module.css";

type PlayerSpriteProps = {
  position: Position;
  facing?: NpcFacing;
  walking?: boolean;
};

export const PLAYER_SIZE = {
  width: 76,
  height: 96,
} as const;

// 주인공 시트(public/hero/{gender}.png)는 NPC와 열 순서가 다르다: 0=왼발, 1=idle, 2=오른발.
// 행 순서는 동일(front/left/right/back = down/left/right/up).
const HERO_ROW: Record<NpcFacing, number> = {
  front: 0,
  screen_left: 1,
  screen_right: 2,
  back: 3,
};

/** ?hero=male 로 남자 주인공 선택 (기본 female) — 별도 선택 UI 전까지의 임시 스위치 */
function heroSheet(): string {
  const pick = new URLSearchParams(window.location.search).get("hero");
  return `/hero/${pick === "male" ? "male" : "female"}.png`;
}

export function PlayerSprite({ position, facing = "front", walking = false }: PlayerSpriteProps) {
  const [missing, setMissing] = useState(false);
  const sheet = heroSheet();

  return (
    <div
      className={styles.playerSprite}
      style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
      role="img"
      aria-label="플레이어 캐릭터"
    >
      {missing ? (
        <>
          <span className={styles.playerAura} aria-hidden="true" />
          <span className={styles.playerPortrait} aria-hidden="true">
            <UserFocus weight="duotone" />
          </span>
        </>
      ) : (
        <span
          className={`${styles.heroSprite} ${walking ? styles.heroSpriteWalking : ""}`}
          style={{
            backgroundImage: `url(${sheet})`,
            backgroundPositionY: `${HERO_ROW[facing] * -96}px`,
          }}
          aria-hidden="true"
        >
          <img src={sheet} alt="" style={{ display: "none" }} onError={() => setMissing(true)} />
        </span>
      )}
      <span className={styles.playerName}>나</span>
    </div>
  );
}
