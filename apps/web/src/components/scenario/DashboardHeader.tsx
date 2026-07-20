import {
  ArrowLeft,
  CornersIn,
  CornersOut,
  GearSix,
  House,
  LightbulbFilament,
  List,
  MoonStars,
  Palette,
  RocketLaunch,
  SignOut,
  Sparkle,
  StarFour,
  SunHorizon,
  Target,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import styles from "../../styles/scenarioGame.module.css";

export type ScenarioTheme = "nebula" | "deep-space" | "aurora";

const THEME_OPTIONS: Array<{
  id: ScenarioTheme;
  label: string;
  description: string;
  icon: typeof Sparkle;
}> = [
  { id: "nebula", label: "성운 글라스", description: "보랏빛과 장밋빛이 도는 기본 테마", icon: Sparkle },
  { id: "deep-space", label: "딥 스페이스", description: "짙은 남색과 푸른 별빛 테마", icon: MoonStars },
  { id: "aurora", label: "오로라", description: "청록과 라일락 빛의 맑은 테마", icon: SunHorizon },
];

type DashboardHeaderProps = {
  progress: number;
  theme: ScenarioTheme;
  isHintOpen: boolean;
  isFullscreen: boolean;
  onThemeChange: (theme: ScenarioTheme) => void;
  onHintToggle: () => void;
  onFullscreenToggle: () => void;
  onLogout: () => void;
  onSettingsOpen: () => void;
  onHome: () => void;
  onBack: () => void;
  onMission: () => void;
  missionDisabled?: boolean;
  missionPending?: boolean;
};

export function DashboardHeader({
  progress,
  theme,
  isHintOpen,
  isFullscreen,
  onThemeChange,
  onHintToggle,
  onFullscreenToggle,
  onLogout,
  onSettingsOpen,
  onHome,
  onBack,
  onMission,
  missionDisabled = false,
  missionPending = false,
}: DashboardHeaderProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const progressStyle = { "--scenario-progress": `${progress}%` } as CSSProperties;

  useEffect(() => {
    if (!isMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsMenuOpen(false);
      menuButtonRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  return (
    <header className={styles.header}>
      <div className={styles.brandGroup} aria-label="JOBIVERSE 시나리오">
        <button className={styles.headerIconButton} type="button" onClick={onBack} aria-label="뒤로가기">
          <ArrowLeft weight="bold" />
        </button>
        <button className={styles.headerIconButton} type="button" onClick={onHome} aria-label="홈으로 이동">
          <House weight="fill" />
        </button>
        <span className={styles.brandText}>JOBIVERSE</span>
      </div>

      <div
        className={styles.progressGroup}
        role="progressbar"
        aria-label="시나리오 진행도"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        style={progressStyle}
      >
        <span className={styles.progressLabel}>진행도</span>
        <span className={styles.progressTrack} aria-hidden="true">
          <span className={styles.progressValue} />
          <span className={styles.progressRocket}>
            <RocketLaunch weight="fill" />
          </span>
          <StarFour className={styles.progressDestination} weight={progress === 100 ? "fill" : "duotone"} />
        </span>
        <strong>{progress}%</strong>
      </div>

      <div className={styles.headerActions}>
        <button
          className={`${styles.headerActionButton} ${styles.missionCtaButton}`}
          type="button"
          onClick={onMission}
          disabled={missionDisabled}
          aria-busy={missionPending}
        >
          <Target weight="fill" aria-hidden="true" />
          <span>{missionPending ? "준비 중…" : "미션"}</span>
        </button>
        <button
          className={`${styles.headerIconButton} ${isHintOpen ? styles.headerIconButtonActive : ""}`}
          type="button"
          onClick={onHintToggle}
          aria-label={isHintOpen ? "힌트 닫기" : "힌트 열기"}
          aria-expanded={isHintOpen}
          title="힌트"
        >
          <LightbulbFilament weight={isHintOpen ? "fill" : "duotone"} />
        </button>
        <button
          className={styles.headerIconButton}
          type="button"
          onClick={onFullscreenToggle}
          aria-label={isFullscreen ? "전체화면 종료" : "전체화면 시작"}
          aria-pressed={isFullscreen}
          title={isFullscreen ? "전체화면 종료" : "전체화면"}
        >
          {isFullscreen ? <CornersIn weight="bold" /> : <CornersOut weight="bold" />}
        </button>

        <div className={styles.themeMenuWrap} ref={menuRef}>
          <button
            ref={menuButtonRef}
            className={`${styles.headerIconButton} ${isMenuOpen ? styles.headerIconButtonActive : ""}`}
            type="button"
            onClick={() => setIsMenuOpen((current) => !current)}
            aria-label={isMenuOpen ? "메뉴 닫기" : "메뉴 열기"}
            aria-expanded={isMenuOpen}
            title="메뉴"
          >
            <List weight="bold" />
          </button>
          <div className={`${styles.themeMenu} ${isMenuOpen ? styles.themeMenuOpen : ""}`} aria-hidden={!isMenuOpen}>
            <div className={styles.themeMenuHeading}>
              <span><Palette weight="duotone" /> SPACE MENU</span>
              <strong>화면 설정</strong>
            </div>
            {THEME_OPTIONS.map((option) => {
              const ThemeIcon = option.icon;
              return (
                <button
                  className={`${styles.themeOption} ${theme === option.id ? styles.themeOptionActive : ""}`}
                  type="button"
                  key={option.id}
                  onClick={() => onThemeChange(option.id)}
                  aria-pressed={theme === option.id}
                >
                  <span className={styles.themeOptionIcon} data-theme-preview={option.id}>
                    <ThemeIcon weight="fill" />
                  </span>
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                </button>
              );
            })}
            <div className={styles.utilityMenuDivider} />
            <button
              className={styles.utilityMenuAction}
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                onSettingsOpen();
              }}
            >
              <GearSix weight="duotone" aria-hidden="true" />
              <span>
                <strong>설정</strong>
                <small>사운드와 이동 방식을 조정해요</small>
              </span>
            </button>
            <button
              className={`${styles.utilityMenuAction} ${styles.utilityMenuActionDanger}`}
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                onLogout();
              }}
            >
              <SignOut weight="bold" aria-hidden="true" />
              <span>
                <strong>로그아웃</strong>
                <small>현재 계정에서 나가요</small>
              </span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
