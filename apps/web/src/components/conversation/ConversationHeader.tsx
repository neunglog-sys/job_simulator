import { ArrowLeft, GameController, GearSix, House, SignOut } from "@phosphor-icons/react";
import { useState } from "react";
import { FRONTEND_ENDPOINTS } from "../../config/endpoints";
import { logout } from "../../lib/auth";
import styles from "../../styles/oneToOneConversation.module.css";
import { LogoutConfirmDialog } from "../LogoutConfirmDialog";
import { BrandLogo } from "./BrandLogo";
import { GlassIconButton } from "./GlassIconButton";

function goHome() {
  window.location.assign("/");
}

// 테스트 단계: 상담 화면에서 곧바로 시나리오 게임으로 진입 (화면 연결용).
function goToScenario() {
  window.location.assign(FRONTEND_ENDPOINTS.scenario);
}

function goBack() {
  if (window.history.length > 1) {
    window.history.back();
    return;
  }

  goHome();
}

export function ConversationHeader() {
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);

  return (
    <>
    <header className={styles.header}>
      <div className={styles.headerLeft}>
        <div className={styles.headerButtonPair}>
          <GlassIconButton icon={ArrowLeft} label="이전 화면으로 이동" onClick={goBack} />
          <GlassIconButton icon={House} label="홈으로 이동" onClick={goHome} />
        </div>
        <BrandLogo onClick={goHome} />
      </div>

      <div className={styles.headerRight}>
        <button
          className={styles.logoutButton}
          type="button"
          onClick={() => setIsLogoutConfirmOpen(true)}
        >
          <SignOut aria-hidden="true" />
          로그아웃
        </button>
        <GlassIconButton
          icon={GameController}
          label="시나리오 화면으로 이동"
          onClick={goToScenario}
        />
        <GlassIconButton
          icon={GearSix}
          label="설정 열기"
          onClick={() => window.dispatchEvent(new CustomEvent("jobiverse:open-settings"))}
        />
      </div>
    </header>
    <LogoutConfirmDialog
      open={isLogoutConfirmOpen}
      onCancel={() => setIsLogoutConfirmOpen(false)}
      onConfirm={() => {
        logout();
        goHome();
      }}
    />
    </>
  );
}
