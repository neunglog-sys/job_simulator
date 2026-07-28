import {
  ArrowLeft,
  GameController,
  GearSix,
  House,
  Megaphone,
  SignOut,
  Storefront,
  UserCircle,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { FRONTEND_ENDPOINTS } from "../../config/endpoints";
import { logout } from "../../lib/auth";
import styles from "../../styles/oneToOneConversation.module.css";
import { LogoutConfirmDialog } from "../LogoutConfirmDialog";
import { BrandLogo } from "./BrandLogo";
import { GlassIconButton } from "./GlassIconButton";

function goHome() {
  window.location.assign("/");
}

function goToScenario(slug: "kts-03" | "sns-01") {
  const params = new URLSearchParams({ slug });
  window.location.assign(`${FRONTEND_ENDPOINTS.scenario}?${params.toString()}`);
}

function goBack() {
  if (window.history.length > 1) {
    window.history.back();
    return;
  }

  goHome();
}

type ConversationHeaderProps = {
  onCoachSettingsOpen?: () => void;
};

export function ConversationHeader({ onCoachSettingsOpen }: ConversationHeaderProps) {
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [isScenarioPickerOpen, setIsScenarioPickerOpen] = useState(false);
  const scenarioPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isScenarioPickerOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!scenarioPickerRef.current?.contains(event.target as Node)) {
        setIsScenarioPickerOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsScenarioPickerOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isScenarioPickerOpen]);

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
        <div className={styles.scenarioPicker} ref={scenarioPickerRef}>
          <button
            className={styles.glassIconButton}
            type="button"
            onClick={() => setIsScenarioPickerOpen((current) => !current)}
            aria-label="시나리오 화면 이어가기"
            data-tooltip="시나리오 화면 이어가기"
            aria-haspopup="menu"
            aria-expanded={isScenarioPickerOpen}
          >
            <GameController aria-hidden="true" weight="regular" />
          </button>
          {isScenarioPickerOpen ? (
            <div className={styles.scenarioPickerMenu} role="menu" aria-label="시나리오 선택">
              <p>이어갈 시나리오 선택</p>
              <button type="button" role="menuitem" onClick={() => goToScenario("kts-03")}>
                <span className={styles.scenarioPickerIcon} aria-hidden="true">
                  <Storefront weight="duotone" />
                </span>
                <span>
                  <strong>영업·판매</strong>
                  <small>kts-03 · 매장응대</small>
                </span>
              </button>
              <button type="button" role="menuitem" onClick={() => goToScenario("sns-01")}>
                <span className={styles.scenarioPickerIcon} aria-hidden="true">
                  <Megaphone weight="duotone" />
                </span>
                <span>
                  <strong>SNS 콘텐츠 운영</strong>
                  <small>sns-01 · 돌발상황 대처</small>
                </span>
              </button>
            </div>
          ) : null}
        </div>
        {onCoachSettingsOpen ? (
          <GlassIconButton
            icon={GearSix}
            label="진로 코치 설정 열기"
            onClick={onCoachSettingsOpen}
            tooltip="설정"
          />
        ) : null}
        <GlassIconButton
          icon={UserCircle}
          label="내 정보 열기"
          onClick={() => window.location.assign(FRONTEND_ENDPOINTS.myPage)}
          tooltip="마이페이지"
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
