import { UserFocus } from "@phosphor-icons/react";
import { useState } from "react";
import { useAuth } from "../../lib/auth";
import type { NpcFacing } from "./NpcSprite";
import type { Position } from "./types";
import styles from "../../styles/scenarioGame.module.css";

type PlayerSpriteProps = {
  position: Position;
  facing?: NpcFacing;
  walking?: boolean;
  // 오클루전 맵의 y-정렬용 — 발 y를 넘기면 가구 오클루더(z=baseline)와 앞뒤가 갈린다
  zIndex?: number;
  // 컷신(투어)처럼 좌표가 뚝뚝 떨어질 때만 보간 — 조작 중엔 꺼야 카메라와 어긋나지 않는다
  smooth?: boolean;
  // smooth일 때의 transition 시간(ms) — 사수 쪽 guideHopMsRef와 맞춰써야 먼 거리 첫 이동이
  // 고정 900ms로 순간이동처럼 보이지 않는다(팀 확인 2026-07-24, 사수 쪽과 동일한 원인).
  transitionMs?: number;
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

/** 주인공 시트 선택: URL `?hero=` 오버라이드 > 로그인 유저 성별 > 기본 male.
 *  성별 미설정(null)은 대다수 계정의 상태라 기본을 male로 둔다(팀 결정 2026-07-26).
 *  female은 유저 성별이 명시적으로 female일 때만. (`?hero=male|female` 은 QA·시연 강제 스위치) */
function heroSheet(userGender?: "male" | "female" | null): string {
  const override = new URLSearchParams(window.location.search).get("hero");
  const pick =
    override === "male" || override === "female"
      ? override
      : userGender === "female"
        ? "female"
        : "male";
  return `/hero/${pick}.png`;
}

export function PlayerSprite({
  position,
  facing = "front",
  walking = false,
  zIndex,
  smooth = false,
  transitionMs = 900,
}: PlayerSpriteProps) {
  const [missing, setMissing] = useState(false);
  const auth = useAuth();
  const gender = auth.status === "authed" ? auth.me.gender : null;
  const sheet = heroSheet(gender);

  return (
    <div
      className={styles.playerSprite}
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        zIndex,
        transition: smooth ? `transform ${transitionMs}ms ease-in-out` : undefined,
      }}
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
