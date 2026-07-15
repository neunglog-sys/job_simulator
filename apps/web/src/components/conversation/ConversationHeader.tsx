import { ArrowLeft, GearSix, House, List } from "@phosphor-icons/react";
import { logout } from "../../lib/auth";
import styles from "../../styles/oneToOneConversation.module.css";
import { BrandLogo } from "./BrandLogo";
import { GlassIconButton } from "./GlassIconButton";

function goHome() {
  window.location.assign("/");
}

function goBack() {
  if (window.history.length > 1) {
    window.history.back();
    return;
  }

  goHome();
}

export function ConversationHeader() {
  return (
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
          onClick={() => {
            logout();
            goHome();
          }}
        >
          로그아웃
        </button>
        <GlassIconButton
          icon={List}
          label="메뉴 열기"
          onClick={() => window.dispatchEvent(new CustomEvent("jobiverse:open-menu"))}
        />
        <GlassIconButton
          icon={GearSix}
          label="설정 열기"
          onClick={() => window.dispatchEvent(new CustomEvent("jobiverse:open-settings"))}
        />
      </div>
    </header>
  );
}
