import { useEffect, useState, type CSSProperties } from "react";
import { AiCoachPanel } from "../components/scenario/AiCoachPanel";
import { DashboardHeader } from "../components/scenario/DashboardHeader";
import { GameMapLayer } from "../components/scenario/GameMapLayer";
import { HintPanel } from "../components/scenario/HintPanel";
import { MovementArea } from "../components/scenario/MovementArea";
import { ScenarioControlPanel } from "../components/scenario/ScenarioControlPanel";
import type { HintCardData, Position } from "../components/scenario/types";
import { logout } from "../lib/auth";
import styles from "../styles/scenarioGame.module.css";

const HINTS: HintCardData[] = [
  {
    id: "request",
    title: "요청의 핵심을 먼저 찾기",
    category: "상황 파악",
    description: "고객이 말한 현상과 실제로 원하는 결과를 구분하면 해결 순서가 선명해집니다.",
  },
  {
    id: "history",
    title: "이전 처리 이력 확인하기",
    category: "정보 탐색",
    description: "같은 문제가 반복되었는지 확인하고, 이미 시도한 방법은 다시 안내하지 않도록 주의하세요.",
  },
  {
    id: "explain",
    title: "다음 행동까지 안내하기",
    category: "고객 안내",
    description: "처리 결과뿐 아니라 고객이 다음에 해야 할 일을 짧고 분명하게 전달해보세요.",
  },
];

const DEFAULT_COACH_MESSAGE =
  "첫 번째 미션이 시작됐어요. 방향키나 WASD로 이동하고, 빛나는 업무 오브젝트를 눌러 상황을 확인해보세요.";
const DEFAULT_SCENARIO_MAP_IMAGE =
  `${import.meta.env.BASE_URL}assets/scenario/maps/modern-design-video-studio.webp`;

type ScenarioScreenStyle = CSSProperties & {
  "--scenario-map-image": string;
};

type ScenarioStageStyle = CSSProperties & {
  "--scenario-stage-scale": number;
  "--scenario-ui-text-scale": number;
};

function getStageScale() {
  return Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
}

export function ScenarioGamePage() {
  const [isHintOpen, setIsHintOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [coachMessage, setCoachMessage] = useState(DEFAULT_COACH_MESSAGE);
  const [playerPosition, setPlayerPosition] = useState<Position>({ x: 420, y: 290 });
  const [stageScale, setStageScale] = useState(getStageScale);
  const mapImage =
    import.meta.env.VITE_SCENARIO_MAP_IMAGE?.trim() ||
    DEFAULT_SCENARIO_MAP_IMAGE;

  useEffect(() => {
    const handleResize = () => setStageScale(getStageScale());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      setStageScale(getStageScale());
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      setCoachMessage("브라우저에서 전체화면 전환을 허용하지 않았어요. F11 키로도 전환할 수 있습니다.");
    }
  };

  const screenStyle: ScenarioScreenStyle = {
    "--scenario-map-image": `url("${mapImage}")`,
  };

  const stageStyle: ScenarioStageStyle = {
    "--scenario-stage-scale": stageScale,
    "--scenario-ui-text-scale": Math.min(1.5, Math.max(1, 1 / stageScale)),
  };

  return (
    <main className={styles.gameScreen} style={screenStyle}>
      <div className={styles.mapBackdrop} aria-hidden="true" />
      <div className={styles.designStage} style={stageStyle} data-debug="false">
        <GameMapLayer imageUrl={mapImage} />
        <MovementArea
          position={playerPosition}
          onPositionChange={setPlayerPosition}
          onCoachMessage={setCoachMessage}
        />
        <DashboardHeader
          isHintOpen={isHintOpen}
          isFullscreen={isFullscreen}
          onHintToggle={() => setIsHintOpen((current) => !current)}
          onFullscreenToggle={toggleFullscreen}
          onLogout={() => {
            logout();
            window.location.assign("/");
          }}
          onMenuOpen={() => setCoachMessage("메뉴 기능은 다음 시나리오 단계와 연결될 예정이에요.")}
          onSettingsOpen={() => setCoachMessage("설정 메뉴에서 사운드와 이동 방식을 조정할 수 있게 될 예정이에요.")}
          onHome={() => window.location.assign("/")}
          onBack={() => {
            if (window.history.length > 1) window.history.back();
            else window.location.assign("/");
          }}
        />
        <HintPanel isOpen={isHintOpen} hints={HINTS} />
        <div className={styles.bottomHud}>
          <ScenarioControlPanel onCoachMessage={setCoachMessage} />
          <AiCoachPanel message={coachMessage} />
        </div>
        <span className={styles.keyboardGuide} aria-hidden="true">
          <kbd>WASD</kbd>
          <span>이동</span>
        </span>
      </div>
    </main>
  );
}
