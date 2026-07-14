import {
  ArrowLeft,
  CornersIn,
  CornersOut,
  GearSix,
  House,
  LightbulbFilament,
  List,
  SignOut,
} from "@phosphor-icons/react";
import styles from "../../styles/scenarioGame.module.css";

type DashboardHeaderProps = {
  isHintOpen: boolean;
  isFullscreen: boolean;
  onHintToggle: () => void;
  onFullscreenToggle: () => void;
  onLogout: () => void;
  onMenuOpen: () => void;
  onSettingsOpen: () => void;
  onHome: () => void;
  onBack: () => void;
};

export function DashboardHeader({
  isHintOpen,
  isFullscreen,
  onHintToggle,
  onFullscreenToggle,
  onLogout,
  onMenuOpen,
  onSettingsOpen,
  onHome,
  onBack,
}: DashboardHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.brandGroup} aria-label="JOBIVERSE 시나리오">
        <button className={styles.headerOrb} type="button" onClick={onBack} aria-label="뒤로가기">
          <ArrowLeft weight="bold" />
        </button>
        <button className={styles.headerOrb} type="button" onClick={onHome} aria-label="홈으로 이동">
          <House weight="duotone" />
        </button>
        <span className={styles.brandText}>JOBIVERSE</span>
      </div>

      <div className={styles.progressGroup} aria-label="시나리오 진행도 42퍼센트">
        <span>진행도</span>
        <span className={styles.progressTrack} aria-hidden="true">
          <span className={styles.progressValue} />
        </span>
        <strong>42%</strong>
      </div>

      <div className={styles.headerActions}>
        <button className={styles.exitButton} type="button" onClick={onLogout}>
          <SignOut weight="bold" aria-hidden="true" />
          <span>로그아웃</span>
        </button>
        <button
          className={styles.headerOrb}
          type="button"
          onClick={onFullscreenToggle}
          aria-label={isFullscreen ? "전체화면 종료" : "전체화면 시작"}
          aria-pressed={isFullscreen}
        >
          {isFullscreen ? <CornersIn weight="bold" /> : <CornersOut weight="bold" />}
        </button>
        <button
          className={`${styles.headerOrb} ${isHintOpen ? styles.headerOrbActive : ""}`}
          type="button"
          aria-label={isHintOpen ? "힌트 닫기" : "힌트 열기"}
          aria-expanded={isHintOpen}
          onClick={onHintToggle}
        >
          <LightbulbFilament weight={isHintOpen ? "fill" : "duotone"} />
        </button>
        <button className={styles.headerOrb} type="button" onClick={onMenuOpen} aria-label="메뉴 열기">
          <List weight="bold" />
        </button>
        <button className={styles.headerOrb} type="button" onClick={onSettingsOpen} aria-label="설정 열기">
          <GearSix weight="duotone" />
        </button>
      </div>
    </header>
  );
}
