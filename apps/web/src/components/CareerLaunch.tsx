import {
  ArrowClockwise,
  ArrowRight,
  ChartLineUp,
  Code,
  FirstAid,
  Flask,
  LightbulbFilament,
  MicrophoneStage,
  Palette,
  Planet,
  ShieldCheck,
  Smiley,
  VideoCamera,
  type Icon,
} from "@phosphor-icons/react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { CLIENT_EVENTS, FRONTEND_ENDPOINTS } from "../config/endpoints";
import { AVATAR_IMAGE, LANDING_COPY } from "../content";

type ScenePhase =
  | "boot"
  | "ground"
  | "icons"
  | "ready"
  | "ignition"
  | "launch"
  | "orbit"
  | "settled";

type Career = {
  name: string;
  icon: Icon;
  colors: [string, string];
  ground: [number, number];
  orbit: [number, number];
  mobile: [number, number];
  size: number;
  tilt: number;
};

type CareerStyle = CSSProperties & {
  "--index": number;
  "--ground-x": string;
  "--ground-y": string;
  "--orbit-x": string;
  "--orbit-y": string;
  "--mobile-x": string;
  "--mobile-y": string;
  "--planet-size": string;
  "--planet-scale": number;
  "--planet-a": string;
  "--planet-b": string;
  "--tilt": string;
};

type CelestialStyle = CSSProperties & {
  "--star-size"?: string;
  "--twinkle-duration"?: string;
  "--twinkle-delay"?: string;
  "--meteor-angle"?: string;
  "--meteor-x"?: string;
  "--meteor-y"?: string;
  "--meteor-curve-y"?: string;
  "--meteor-opacity"?: number;
  "--meteor-duration"?: string;
  "--meteor-delay"?: string;
};

const PHASE_ORDER: ScenePhase[] = [
  "boot",
  "ground",
  "icons",
  "ready",
  "ignition",
  "launch",
  "orbit",
  "settled",
];

const STORY_TIMELINE: Array<[ScenePhase, number]> = [
  ["ground", 180],
  ["icons", 820],
  ["ready", 2_650],
  ["ignition", 3_450],
  ["launch", 4_180],
  ["orbit", 7_050],
  ["settled", 9_050],
];

const CAREERS: Career[] = [
  {
    name: "개발자",
    icon: Code,
    colors: ["#3076ef", "#69d3ff"],
    ground: [-31, 28],
    orbit: [34, 17],
    mobile: [34, 34],
    size: 128,
    tilt: -9,
  },
  {
    name: "디자이너",
    icon: Palette,
    colors: ["#8952df", "#d68cff"],
    ground: [-20, 34],
    orbit: [5, 4],
    mobile: [34, 7],
    size: 96,
    tilt: 11,
  },
  {
    name: "영상 제작자",
    icon: VideoCamera,
    colors: ["#6950d4", "#a58aff"],
    ground: [-9, 27],
    orbit: [12, -32],
    mobile: [-32, 18],
    size: 84,
    tilt: -12,
  },
  {
    name: "의료 직군",
    icon: FirstAid,
    colors: ["#23aebc", "#78ead8"],
    ground: [7, 34],
    orbit: [25, 21],
    mobile: [-31, 35],
    size: 92,
    tilt: 8,
  },
  {
    name: "데이터 분석가",
    icon: ChartLineUp,
    colors: ["#4358cf", "#92a4ff"],
    ground: [18, 27],
    orbit: [29, -2],
    mobile: [-6, 24],
    size: 80,
    tilt: -7,
  },
  {
    name: "연구원",
    icon: Flask,
    colors: ["#d24d9e", "#ff91c7"],
    ground: [30, 33],
    orbit: [33, -28],
    mobile: [32, 20],
    size: 112,
    tilt: 10,
  },
  {
    name: "우주 과학자",
    icon: Planet,
    colors: ["#5b60d5", "#9ba4ff"],
    ground: [-26, 20],
    orbit: [5, -16],
    mobile: [-16, 6],
    size: 66,
    tilt: -13,
  },
  {
    name: "콘텐츠 제작자",
    icon: MicrophoneStage,
    colors: ["#df4b99", "#ff91bd"],
    ground: [27, 18],
    orbit: [35, -13],
    mobile: [12, 43],
    size: 74,
    tilt: 7,
  },
  {
    name: "기획자",
    icon: LightbulbFilament,
    colors: ["#e27664", "#ffb776"],
    ground: [-14, 38],
    orbit: [9, 21],
    mobile: [-12, 43],
    size: 58,
    tilt: -5,
  },
  {
    name: "보안 전문가",
    icon: ShieldCheck,
    colors: ["#3972d2", "#72b7ef"],
    ground: [14, 39],
    orbit: [23, -34],
    mobile: [10, 2],
    size: 70,
    tilt: 12,
  },
];

const STAR_POINTS = Array.from({ length: 64 }, (_, index) => {
  let left = (index * 37 + 11) % 97;
  let top = (index * 53 + 7) % 89;

  // Keep the final headline area quiet while distributing extra stars elsewhere.
  if (left >= 4 && left <= 44 && top >= 27 && top <= 73) {
    if (index % 2 === 0) {
      top = 9 + ((index * 7) % 17);
    } else {
      left = 47 + ((index * 19) % 49);
    }
  }

  return {
    left: `${left}%`,
    top: `${top}%`,
    size: `${index % 23 === 0 ? 3 : index % 8 === 0 ? 2 : 1}px`,
    delay: `${-(index % 11) * 0.37}s`,
    duration: `${2.35 + (index % 6) * 0.31}s`,
    tone: index % 17 === 0 ? "warm" : index % 7 === 0 ? "bright" : "soft",
    mobileOptional: index >= 46,
  };
});

const SPARKLE_POINTS = [
  { left: "8%", top: "17%", size: "13px", delay: "-1.1s", duration: "4.2s" },
  { left: "24%", top: "13%", size: "9px", delay: "-3.2s", duration: "4.8s" },
  { left: "47%", top: "16%", size: "12px", delay: "-2.4s", duration: "3.9s" },
  { left: "58%", top: "9%", size: "8px", delay: "-0.7s", duration: "4.6s" },
  { left: "73%", top: "13%", size: "14px", delay: "-3.8s", duration: "5.1s" },
  { left: "92%", top: "17%", size: "10px", delay: "-1.9s", duration: "4.4s" },
  { left: "50%", top: "67%", size: "8px", delay: "-2.9s", duration: "4.9s", mobileOptional: true },
  { left: "88%", top: "55%", size: "11px", delay: "-0.3s", duration: "4.1s", mobileOptional: true },
];

const METEORS = [
  {
    top: "9%",
    left: "94%",
    width: "178px",
    angle: "-29deg",
    x: "-500px",
    y: "190px",
    curveY: "92px",
    opacity: 0.82,
    duration: "10.8s",
    delay: "-2.2s",
  },
  {
    top: "28%",
    left: "78%",
    width: "142px",
    angle: "-27deg",
    x: "-420px",
    y: "174px",
    curveY: "82px",
    opacity: 0.68,
    duration: "14.6s",
    delay: "-8.4s",
  },
  {
    top: "6%",
    left: "61%",
    width: "128px",
    angle: "-31deg",
    x: "-340px",
    y: "152px",
    curveY: "72px",
    opacity: 0.62,
    duration: "17.8s",
    delay: "-13.2s",
  },
  {
    top: "16%",
    left: "46%",
    width: "108px",
    angle: "-26deg",
    x: "-282px",
    y: "138px",
    curveY: "64px",
    opacity: 0.52,
    duration: "19.6s",
    delay: "-5.5s",
    mobileOptional: true,
  },
  {
    top: "4%",
    left: "29%",
    width: "92px",
    angle: "-30deg",
    x: "-220px",
    y: "118px",
    curveY: "54px",
    opacity: 0.46,
    duration: "21.8s",
    delay: "-17.4s",
    mobileOptional: true,
  },
];

const SMOKE_PUFFS = Array.from({ length: 28 }, (_, index) => ({
  x: `${((index * 31) % 110) - 55}px`,
  y: `${28 + ((index * 23) % 94)}px`,
  size: `${42 + ((index * 29) % 68)}px`,
  delay: `${(index % 10) * 44}ms`,
}));

const VAPOR_PUFFS = Array.from({ length: 38 }, (_, index) => {
  const side = index % 2 === 0 ? -1 : 1;
  const lane = Math.floor(index / 2);

  return {
    x: `${side * (42 + ((lane * 83) % 620))}px`,
    y: `${-(34 + ((index * 37) % 172))}px`,
    size: `${72 + ((index * 41) % 116)}px`,
    delay: `${(index % 13) * 38}ms`,
  };
});

function phaseAtLeast(current: ScenePhase, target: ScenePhase) {
  return PHASE_ORDER.indexOf(current) >= PHASE_ORDER.indexOf(target);
}

export function CareerLaunch() {
  const reduceMotion = useReducedMotion();
  const timersRef = useRef<number[]>([]);
  const toastTimerRef = useRef<number | null>(null);
  const [phase, setPhase] = useState<ScenePhase>("boot");
  const [storyKey, setStoryKey] = useState(0);
  const [toast, setToast] = useState("");

  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const smoothX = useSpring(pointerX, { stiffness: 90, damping: 24, mass: 0.7 });
  const smoothY = useSpring(pointerY, { stiffness: 90, damping: 24, mass: 0.7 });
  const starsX = useTransform(smoothX, [-1, 1], [-8, 8]);
  const starsY = useTransform(smoothY, [-1, 1], [-5, 5]);
  const objectsX = useTransform(smoothX, [-1, 1], [10, -10]);
  const objectsY = useTransform(smoothY, [-1, 1], [7, -7]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);

  const schedulePhase = useCallback((nextPhase: ScenePhase, delay: number) => {
    const timer = window.setTimeout(() => setPhase(nextPhase), delay);
    timersRef.current.push(timer);
  }, []);

  useEffect(() => {
    clearTimers();
    setPhase("boot");

    if (reduceMotion) {
      schedulePhase("settled", 80);
      return clearTimers;
    }

    STORY_TIMELINE.forEach(([nextPhase, delay]) => schedulePhase(nextPhase, delay));
    return clearTimers;
  }, [clearTimers, reduceMotion, schedulePhase, storyKey]);

  useEffect(
    () => () => {
      clearTimers();
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    },
    [clearTimers],
  );

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 2_500);
  }, []);

  const launchNow = useCallback(() => {
    if (phaseAtLeast(phase, "launch")) return;
    clearTimers();
    setPhase("ignition");
    schedulePhase("launch", reduceMotion ? 40 : 620);
    schedulePhase("orbit", reduceMotion ? 80 : 3_500);
    schedulePhase("settled", reduceMotion ? 100 : 5_500);
  }, [clearTimers, phase, reduceMotion, schedulePhase]);

  const startCareerExploration = useCallback(() => {
    window.dispatchEvent(new CustomEvent(CLIENT_EVENTS.startCareerExploration));
    showToast("AI 아바타 설문을 시작할 준비가 됐어요.");
  }, [showToast]);

  const handleNavPrimaryAction = useCallback(() => {
    if (!phaseAtLeast(phase, "orbit")) {
      launchNow();
      return;
    }

    startCareerExploration();
  }, [launchNow, phase, startCareerExploration]);

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (reduceMotion || event.pointerType === "touch") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    pointerX.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1);
    pointerY.set(((event.clientY - bounds.top) / bounds.height) * 2 - 1);
  };

  const handlePointerLeave = () => {
    pointerX.set(0);
    pointerY.set(0);
  };

  const isFlight = phase === "launch";
  const isOrbit = phaseAtLeast(phase, "orbit");
  const isFinal = phaseAtLeast(phase, "settled");

  const sceneClasses = [
    "career-scene",
    `phase-${phase}`,
    phaseAtLeast(phase, "ground") && "has-ground",
    phaseAtLeast(phase, "icons") && "has-icons",
    phaseAtLeast(phase, "ready") && "has-ready",
    phase === "ignition" && "is-ignition",
    isFlight && "is-flight",
    phaseAtLeast(phase, "launch") && "is-space",
    isOrbit && "is-orbit",
    isFinal && "is-final",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main
      className={sceneClasses}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      aria-label="직무 아카데미아 AI 직무 체험 랜딩 페이지"
    >
      <div className="scene-background ground-sky" aria-hidden="true" />
      <div className="scene-background space-sky" aria-hidden="true">
        <div className="nebula nebula-one" />
        <div className="nebula nebula-two" />
      </div>

      <motion.div
        className="star-field"
        style={{ x: starsX, y: starsY }}
        aria-hidden="true"
      >
        {STAR_POINTS.map((star, index) => (
          <i
            className={`star star-${star.tone}${
              star.mobileOptional ? " star-mobile-optional" : ""
            }`}
            key={index}
            style={
              {
                left: star.left,
                top: star.top,
                "--star-size": star.size,
                "--twinkle-duration": star.duration,
                "--twinkle-delay": star.delay,
              } as CelestialStyle
            }
          />
        ))}
        {SPARKLE_POINTS.map((sparkle, index) => (
          <i
            className={`cosmic-sparkle${
              sparkle.mobileOptional ? " star-mobile-optional" : ""
            }`}
            key={`sparkle-${index}`}
            style={
              {
                left: sparkle.left,
                top: sparkle.top,
                "--star-size": sparkle.size,
                "--twinkle-duration": sparkle.duration,
                "--twinkle-delay": sparkle.delay,
              } as CelestialStyle
            }
          />
        ))}
        {METEORS.map((meteor, index) => (
          <i
            className={`meteor${meteor.mobileOptional ? " meteor-mobile-optional" : ""}`}
            key={`meteor-${index}`}
            style={
              {
                top: meteor.top,
                left: meteor.left,
                width: meteor.width,
                "--meteor-angle": meteor.angle,
                "--meteor-x": meteor.x,
                "--meteor-y": meteor.y,
                "--meteor-curve-y": meteor.curveY,
                "--meteor-opacity": meteor.opacity,
                "--meteor-duration": meteor.duration,
                "--meteor-delay": meteor.delay,
              } as CelestialStyle
            }
          >
            <span className="meteor-body">
              <span className="meteor-streak" />
              <span className="meteor-head" />
            </span>
          </i>
        ))}
      </motion.div>

      <nav className="site-nav" aria-label="주요 메뉴">
        <a
          className="brand"
          href={FRONTEND_ENDPOINTS.home}
          aria-label="직무 아카데미아 홈"
        >
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span>{LANDING_COPY.brand}</span>
        </a>
        <div className="nav-actions">
          <div className="account-actions" aria-label="회원 메뉴">
            <button
              className="nav-account-button sign-up-button"
              type="button"
              onClick={() => showToast("회원가입 화면은 인증 기능과 연결할 수 있어요.")}
            >
              {LANDING_COPY.actions.signUp}
            </button>
            <span className="nav-divider" aria-hidden="true" />
            <button
              className="nav-account-button sign-in-button"
              type="button"
              onClick={() => showToast("로그인 화면은 인증 기능과 연결할 수 있어요.")}
            >
              {LANDING_COPY.actions.signIn}
            </button>
          </div>
          <button
            className="button button-primary nav-primary"
            type="button"
            onClick={handleNavPrimaryAction}
          >
            <span>{LANDING_COPY.actions.getStarted}</span>
            <ArrowRight aria-hidden="true" />
          </button>
        </div>
      </nav>

      <section className="intro-copy" aria-hidden={phaseAtLeast(phase, "launch")}>
        <p className="eyebrow">{LANDING_COPY.intro.eyebrow}</p>
        <h1>
          {LANDING_COPY.intro.title.split("\n").map((line) => (
            <span key={line}>{line}</span>
          ))}
        </h1>
        <p className="intro-description">{LANDING_COPY.intro.description}</p>
        <button
          className="button button-primary hero-primary"
          type="button"
          onClick={launchNow}
        >
          <span>{LANDING_COPY.actions.launch}</span>
          <ArrowRight aria-hidden="true" />
        </button>
      </section>

      <section className="final-copy" aria-hidden={!isFinal}>
        <p className="eyebrow">{LANDING_COPY.final.eyebrow}</p>
        <h2>
          {LANDING_COPY.final.title.split("\n").map((line) => (
            <span key={line}>{line}</span>
          ))}
        </h2>
        <p>{LANDING_COPY.final.description}</p>
        <button
          className="button button-light final-primary"
          type="button"
          onClick={startCareerExploration}
          tabIndex={isFinal ? 0 : -1}
        >
          <span>{LANDING_COPY.actions.getStarted}</span>
          <ArrowRight aria-hidden="true" />
        </button>
      </section>

      <motion.div
        className="career-layer"
        style={{ x: objectsX, y: objectsY }}
        aria-label="다양한 직무를 상징하는 행성들"
      >
        {CAREERS.map((career, index) => {
          const CareerIcon = career.icon;
          const style: CareerStyle = {
            "--index": index,
            "--ground-x": `${career.ground[0]}vw`,
            "--ground-y": `${career.ground[1]}vh`,
            "--orbit-x": `${career.orbit[0]}vw`,
            "--orbit-y": `${career.orbit[1]}vh`,
            "--mobile-x": `${career.mobile[0]}vw`,
            "--mobile-y": `${career.mobile[1]}vh`,
            "--planet-size": `${career.size}px`,
            "--planet-scale": career.size / 78,
            "--planet-a": career.colors[0],
            "--planet-b": career.colors[1],
            "--tilt": `${career.tilt}deg`,
          };

          return (
            <div
              className="career-node"
              key={career.name}
              style={style}
              role="img"
              aria-label={`${career.name}을 상징하는 직무 행성`}
            >
              <span className="planet-float">
                <span className="planet-shell">
                  <span className="planet-ring" aria-hidden="true" />
                  <span className="planet-shine" aria-hidden="true" />
                  <span className="planet-icon" aria-hidden="true">
                    <CareerIcon className="planet-icon-depth" weight="fill" />
                    <CareerIcon className="planet-icon-face" weight="duotone" />
                  </span>
                </span>
              </span>
            </div>
          );
        })}
      </motion.div>

      <div
        className="avatar-layer"
        aria-hidden={!isFinal}
        aria-label="구름 위에서 직무 행성들을 바라보는 사용자 아바타"
      >
        <div className="avatar-float">
          {AVATAR_IMAGE ? (
            <img
              className="avatar-image"
              src={AVATAR_IMAGE}
              alt="구름 위에서 직무 행성들을 바라보는 사용자 아바타"
            />
          ) : (
            <div className="avatar-placeholder" aria-hidden="true">
              <span className="avatar-antenna" />
              <span className="avatar-head">
                <span className="avatar-visor">
                  <Smiley weight="fill" />
                </span>
              </span>
              <span className="avatar-body">
                <span className="avatar-core" />
              </span>
              <span className="avatar-arm avatar-arm-left" />
              <span className="avatar-arm avatar-arm-right" />
            </div>
          )}
        </div>
      </div>

      <div className="launch-vapor-layer" aria-hidden="true">
        <span className="vapor-sheet vapor-sheet-back" />
        <span className="vapor-sheet vapor-sheet-front" />
        {VAPOR_PUFFS.map((puff, index) => (
          <i
            className="launch-vapor-puff"
            key={index}
            style={
              {
                "--vapor-x": puff.x,
                "--vapor-y": puff.y,
                "--vapor-size": puff.size,
                "--vapor-delay": puff.delay,
              } as CSSProperties
            }
          />
        ))}
      </div>

      <div className="rocket-layer" aria-hidden="true">
        <div className="smoke-layer">
          {SMOKE_PUFFS.map((puff, index) => (
            <i
              className="smoke-puff"
              key={index}
              style={
                {
                  "--smoke-x": puff.x,
                  "--smoke-y": puff.y,
                  "--smoke-size": puff.size,
                  "--smoke-delay": puff.delay,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <div className="rocket-shake">
          <img src="/assets/rocket.png" alt="" />
          <div className="rocket-flame" />
        </div>
      </div>

      <div className="cloud-image-layer" aria-hidden="true">
        <img src="/assets/cloud-bank.png" alt="" />
      </div>

      <button
        className="replay-button"
        type="button"
        onClick={() => setStoryKey((key) => key + 1)}
        aria-label="애니메이션 다시 보기"
        tabIndex={isFinal ? 0 : -1}
      >
        <ArrowClockwise aria-hidden="true" />
        <span>{LANDING_COPY.actions.replay}</span>
      </button>

      <div className={`toast ${toast ? "toast-visible" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </main>
  );
}
