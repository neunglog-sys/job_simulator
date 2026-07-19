import { UserCircle } from "@phosphor-icons/react";
import { useState } from "react";
import styles from "../../styles/scenarioGame.module.css";

// 시트 레이아웃(공유폴더 NPC 에셋 규격): 행=방향, 열=동작. 프레임 64×96.
export type NpcFacing = "front" | "screen_left" | "screen_right" | "back";

const FACING_ROW: Record<NpcFacing, number> = {
  front: 0,
  screen_left: 1,
  screen_right: 2,
  back: 3,
};

export const NPC_FRAME = { width: 64, height: 96 } as const;

type NpcSpriteProps = {
  npcId: string;
  facing?: NpcFacing;
  walking?: boolean;
};

/** NPC 도트 스프라이트 — 시트(public/npc/{id}.png)에서 방향·동작 프레임을 잘라 그린다.
 *  에셋이 없는 NPC는 예전 원형 아이콘으로 폴백해 게임이 깨지지 않게 한다. */
export function NpcSprite({ npcId, facing = "front", walking = false }: NpcSpriteProps) {
  const [missing, setMissing] = useState(false);

  if (missing) {
    return (
      <span className={styles.npcMarkerAvatar} aria-hidden="true">
        <UserCircle weight="duotone" />
      </span>
    );
  }

  return (
    <span
      className={`${styles.npcSprite} ${walking ? styles.npcSpriteWalking : ""}`}
      style={{
        backgroundImage: `url(/npc/${npcId}.png)`,
        backgroundPositionY: `${FACING_ROW[facing] * -NPC_FRAME.height}px`,
      }}
      aria-hidden="true"
    >
      {/* 시트 로드 실패 감지용 — 화면엔 안 보이고 onError만 쓴다 */}
      <img
        src={`/npc/${npcId}.png`}
        alt=""
        style={{ display: "none" }}
        onError={() => setMissing(true)}
      />
    </span>
  );
}
