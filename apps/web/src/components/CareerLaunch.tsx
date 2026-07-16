import {
  ArrowClockwise,
  ArrowRight,
  Smiley,
} from "@phosphor-icons/react";
import {
  motion,
  type MotionValue,
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
import { ApiError, createConsultation } from "../lib/api";
import { logout, useAuth } from "../lib/auth";
import { AuthModal, type AuthMode } from "./AuthModal";

type ScenePhase =
  | "boot"
  | "ground"
  | "icons"
  | "ready"
  | "ignition"
  | "launch"
  | "transition"
  | "orbit"
  | "settled";

type Career = {
  name: string;
  iconSrc: string;
  colors: [string, string];
  ground: [number, number];
  orbit: [number, number];
  mobile: [number, number];
  size: number;
  tilt: number;
  rings: [number, number, number];
  ringCount: 0 | 1 | 2;
  surfaceOpacity?: number;
};

type CareerStyle = CSSProperties & {
  "--index": number;
  "--release-order": number;
  "--ground-x": string;
  "--ground-y": string;
  "--orbit-x": string;
  "--orbit-y": string;
  "--mobile-x": string;
  "--mobile-y": string;
  "--planet-size": string;
  "--planet-scale": number;
  "--launch-planet-scale": number;
  "--planet-a": string;
  "--planet-b": string;
  "--tilt": string;
  "--ring-angle": string;
  "--ring-secondary-angle": string;
  "--ring-secondary-opacity": number;
  "--surface-opacity": number;
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

type PlanetPointerProfile = {
  x: number;
  y: number;
  stiffness: number;
  damping: number;
  mass: number;
};

const PHASE_ORDER: ScenePhase[] = [
  "boot",
  "ground",
  "icons",
  "ready",
  "ignition",
  "launch",
  "transition",
  "orbit",
  "settled",
];

const STORY_TIMELINE: Array<[ScenePhase, number]> = [
  ["ground", 180],
  ["icons", 850],
  ["ready", 2_800],
  ["ignition", 3_900],
  ["launch", 4_850],
  ["transition", 6_500],
  ["orbit", 8_700],
  ["settled", 11_150],
];

// Pop into place clockwise, beginning with the camera planet.
const CAREER_RELEASE_ORDER = [5, 8, 0, 6, 4, 2, 10, 9, 3, 7, 1];

const CAREERS: Career[] = [
  {
    name: "개발자",
    iconSrc: "/assets/career-icons/career-code.webp",
    colors: ["#667cff", "#62e4ee"],
    ground: [-38, 6],
    orbit: [36.5, 14.2],
    mobile: [34, 34],
    size: 128,
    tilt: -9,
    rings: [14, -17, 0.84],
    ringCount: 2,
  },
  {
    name: "디자이너",
    iconSrc: "/assets/career-icons/career-design.webp",
    colors: ["#a26cff", "#ff8fce"],
    ground: [-18, 0],
    orbit: [3, 0.5],
    mobile: [34, 7],
    size: 96,
    tilt: 11,
    rings: [-19, 16, 0.68],
    ringCount: 2,
  },
  {
    name: "영상 제작자",
    iconSrc: "/assets/career-icons/career-video.webp",
    colors: ["#796cf2", "#f596dc"],
    ground: [-34, -11],
    orbit: [12.5, -34],
    mobile: [-32, 18],
    size: 84,
    tilt: -12,
    rings: [7, -24, 0],
    ringCount: 1,
  },
  {
    name: "의료 직군",
    iconSrc: "/assets/career-icons/career-medical.webp",
    colors: ["#35cfc3", "#8ce9f5"],
    ground: [18, 12],
    orbit: [29, 26.5],
    mobile: [-31, 35],
    size: 92,
    tilt: 8,
    rings: [-11, 22, 0],
    ringCount: 0,
    surfaceOpacity: 0.46,
  },
  {
    name: "데이터 분석가",
    iconSrc: "/assets/career-icons/career-data.webp",
    colors: ["#587ee9", "#8fcff7"],
    ground: [26, 0],
    orbit: [31.5, -6.3],
    mobile: [-6, 24],
    size: 80,
    tilt: -7,
    rings: [18, -8, 0.82],
    ringCount: 1,
  },
  {
    name: "연구원",
    iconSrc: "/assets/career-icons/career-research.webp",
    colors: ["#b764de", "#ff91c5"],
    ground: [35, 11],
    orbit: [31.2, -28.2],
    mobile: [32, 20],
    size: 112,
    tilt: 10,
    rings: [-17, 12, 0.76],
    ringCount: 2,
  },
  {
    name: "우주 과학자",
    iconSrc: "/assets/career-icons/career-space.webp",
    colors: ["#6b78e8", "#91dcf5"],
    ground: [-27, 10],
    orbit: [9, -23],
    mobile: [-13, 3],
    size: 54,
    tilt: -13,
    rings: [10, -27, 0],
    ringCount: 1,
  },
  {
    name: "안전 관리 전문가",
    iconSrc: "/assets/career-icons/career-safety.webp",
    colors: ["#8e68f3", "#51dff2"],
    ground: [12, -9],
    orbit: [1.2, -15.8],
    mobile: [-25, 11],
    size: 68,
    tilt: -8,
    rings: [4, -21, 0],
    ringCount: 0,
  },
  {
    name: "콘텐츠 제작자",
    iconSrc: "/assets/career-icons/career-microphone.webp",
    colors: ["#e462b4", "#ff9fc9"],
    ground: [37, -10],
    orbit: [35.5, -16.8],
    mobile: [12, 43],
    size: 44,
    tilt: 7,
    rings: [-8, 25, 0],
    ringCount: 0,
  },
  {
    name: "기획자",
    iconSrc: "/assets/career-icons/career-idea.webp",
    colors: ["#f2869c", "#ffd18a"],
    ground: [-15, 13],
    orbit: [8.6, 22.5],
    mobile: [-12, 43],
    size: 52,
    tilt: -5,
    rings: [22, -14, 0],
    ringCount: 1,
  },
  {
    name: "보안 전문가",
    iconSrc: "/assets/career-icons/career-security.webp",
    colors: ["#4f8ee2", "#76d5e8"],
    ground: [14, 7],
    orbit: [22.4, -33.6],
    mobile: [10, 2],
    size: 54,
    tilt: 12,
    rings: [-23, 8, 0],
    ringCount: 0,
  },
];

const PLANET_POINTER_PROFILES: PlanetPointerProfile[] = [
  { x: -11, y: -7, stiffness: 78, damping: 24, mass: 0.76 },
  { x: 8, y: -5, stiffness: 92, damping: 26, mass: 0.64 },
  { x: -6, y: 9, stiffness: 70, damping: 23, mass: 0.84 },
  { x: 10, y: 4, stiffness: 86, damping: 25, mass: 0.7 },
  { x: -8, y: 6, stiffness: 98, damping: 27, mass: 0.62 },
  { x: 12, y: -8, stiffness: 74, damping: 24, mass: 0.82 },
  { x: 5, y: 7, stiffness: 104, damping: 28, mass: 0.58 },
  { x: -7, y: -4, stiffness: 88, damping: 25, mass: 0.68 },
  { x: 7, y: -9, stiffness: 68, damping: 22, mass: 0.88 },
  { x: -10, y: 3, stiffness: 96, damping: 27, mass: 0.62 },
  { x: 4, y: -6, stiffness: 82, damping: 24, mass: 0.74 },
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

const SMOKE_PUFFS = Array.from({ length: 28 }, (_, index) => {
  const side = index % 2 === 0 ? -1 : 1;
  const lane = Math.floor(index / 2);

  return {
    x: `${side * (10 + lane * 7 + ((lane * 5) % 9))}px`,
    y: `${8 + lane * 3.8}px`,
    size: `${20 + ((index * 17) % 24)}px`,
    delay: `${(index % 14) * 64}ms`,
  };
});

const VAPOR_PUFFS = Array.from({ length: 34 }, (_, index) => {
  const side = index % 2 === 0 ? -1 : 1;
  const lane = Math.floor(index / 2);

  return {
    x: `${side * (34 + ((lane * 79) % 560))}px`,
    y: `${18 + ((lane * 31) % 108)}px`,
    size: `${58 + ((index * 37) % 94)}px`,
    delay: `${180 + (index % 17) * 30}ms`,
  };
});

const EXHAUST_WISPS = Array.from({ length: 14 }, (_, index) => ({
  x: `${((index * 29) % 70) - 35}px`,
  y: `${7 + index * 6.25}%`,
  size: `${18 + ((index * 17) % 28)}px`,
  delay: `${(index % 6) * 72}ms`,
  duration: `${720 + (index % 4) * 110}ms`,
}));

function phaseAtLeast(current: ScenePhase, target: ScenePhase) {
  return PHASE_ORDER.indexOf(current) >= PHASE_ORDER.indexOf(target);
}

type CareerPlanetProps = {
  career: Career;
  index: number;
  pointerX: MotionValue<number>;
  pointerY: MotionValue<number>;
  reduceMotion: boolean;
};

function CareerPlanet({
  career,
  index,
  pointerX,
  pointerY,
  reduceMotion,
}: CareerPlanetProps) {
  const profile = PLANET_POINTER_PROFILES[index % PLANET_POINTER_PROFILES.length];
  const targetX = useTransform(
    pointerX,
    [-1, 1],
    reduceMotion ? [0, 0] : [-profile.x, profile.x],
  );
  const targetY = useTransform(
    pointerY,
    [-1, 1],
    reduceMotion ? [0, 0] : [-profile.y, profile.y],
  );
  const planetX = useSpring(targetX, {
    stiffness: profile.stiffness,
    damping: profile.damping,
    mass: profile.mass,
  });
  const planetY = useSpring(targetY, {
    stiffness: profile.stiffness,
    damping: profile.damping,
    mass: profile.mass,
  });
  const hasPrimaryRing = career.ringCount >= 1;
  const hasCrossRing = career.ringCount === 2;
  const releaseOrder = CAREER_RELEASE_ORDER[index] ?? index;
  const style: CareerStyle = {
    "--index": index,
    "--release-order": releaseOrder,
    "--ground-x": `${career.ground[0]}vw`,
    "--ground-y": `${career.ground[1]}vh`,
    "--orbit-x": `${career.orbit[0]}vw`,
    "--orbit-y": `${career.orbit[1]}vh`,
    "--mobile-x": `${career.mobile[0]}vw`,
    "--mobile-y": `${career.mobile[1]}vh`,
    "--planet-size": `${career.size}px`,
    "--planet-scale": career.size / 78,
    "--launch-planet-scale": 0.35 + (career.size / 78) * 0.55,
    "--planet-a": career.colors[0],
    "--planet-b": career.colors[1],
    "--tilt": `${career.tilt}deg`,
    "--ring-angle": `${career.rings[0]}deg`,
    "--ring-secondary-angle": `${career.rings[1]}deg`,
    "--ring-secondary-opacity": career.rings[2] * 0.9,
    "--surface-opacity": career.surfaceOpacity ?? 0.46,
  };

  return (
    <motion.div className="career-pointer-shift" style={{ x: planetX, y: planetY }}>
      <div
        className="career-node"
        style={style}
        role="img"
        aria-label={`${career.name}을 상징하는 직무 행성`}
      >
        <span className="planet-float">
          <span className="planet-shell">
            {hasPrimaryRing ? (
              <span
                className="planet-ring planet-ring-primary planet-ring-back"
                aria-hidden="true"
              />
            ) : null}
            {hasCrossRing ? (
              <span
                className="planet-ring planet-ring-secondary planet-ring-back"
                aria-hidden="true"
              />
            ) : null}
            <span className="planet-surface" aria-hidden="true" />
            <span className="planet-gloss" aria-hidden="true">
              <span className="planet-shine" />
            </span>
            <span className="planet-icon" aria-hidden="true">
              <img
                className="planet-icon-image"
                src={career.iconSrc}
                alt=""
                draggable={false}
              />
            </span>
            {hasPrimaryRing ? (
              <span
                className="planet-ring planet-ring-primary planet-ring-front"
                aria-hidden="true"
              />
            ) : null}
            {hasCrossRing ? (
              <span
                className="planet-ring planet-ring-secondary planet-ring-front"
                aria-hidden="true"
              />
            ) : null}
            <span className="planet-orbit-sparkles" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
          </span>
        </span>
      </div>
    </motion.div>
  );
}

export function CareerLaunch() {
  const reduceMotion = useReducedMotion();
  const timersRef = useRef<number[]>([]);
  const toastTimerRef = useRef<number | null>(null);
  const [phase, setPhase] = useState<ScenePhase>("boot");
  const [storyKey, setStoryKey] = useState(0);
  const [toast, setToast] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode | null>(null); // null = 모달 닫힘
  const auth = useAuth();

  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const smoothX = useSpring(pointerX, { stiffness: 90, damping: 24, mass: 0.7 });
  const smoothY = useSpring(pointerY, { stiffness: 90, damping: 24, mass: 0.7 });
  const starsX = useTransform(smoothX, [-1, 1], [-8, 8]);
  const starsY = useTransform(smoothY, [-1, 1], [-5, 5]);

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
    schedulePhase("launch", reduceMotion ? 30 : 950);
    schedulePhase("transition", reduceMotion ? 50 : 2_600);
    schedulePhase("orbit", reduceMotion ? 70 : 4_800);
    schedulePhase("settled", reduceMotion ? 90 : 7_250);
  }, [clearTimers, phase, reduceMotion, schedulePhase]);

  const startCareerExploration = useCallback(async () => {
    // 로그인 안 됐으면 먼저 로그인 유도 (상담은 사용자 소유 리소스).
    if (auth.status !== "authed") {
      setAuthMode("signIn");
      showToast("로그인하면 직무 탐색을 시작할 수 있어요.");
      return;
    }
    window.dispatchEvent(new CustomEvent(CLIENT_EVENTS.startCareerExploration));
    try {
      const consultation = await createConsultation();
      showToast(`AI 상담 세션을 시작했어요 (#${consultation.id}). 설문 화면으로 이어집니다.`);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "상담 시작에 실패했어요.");
    }
  }, [auth.status, showToast]);

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

  const isFlight = phase === "launch" || phase === "transition";
  const isOrbit = phaseAtLeast(phase, "orbit");
  const isFinal = isOrbit;

  const sceneClasses = [
    "career-scene",
    `phase-${phase}`,
    phaseAtLeast(phase, "ground") && "has-ground",
    phaseAtLeast(phase, "icons") && "has-icons",
    phaseAtLeast(phase, "ready") && "has-ready",
    phase === "ignition" && "is-ignition",
    isFlight && "is-flight",
    phaseAtLeast(phase, "transition") && "is-space",
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

      <div className="launch-planet-layer" aria-hidden="true">
        <div className="launch-planet-horizon">
          <span className="launch-planet-atmosphere" />
          <span className="launch-planet-crater launch-planet-crater-one" />
          <span className="launch-planet-crater launch-planet-crater-two" />
          <span className="launch-planet-crater launch-planet-crater-three" />
        </div>
      </div>

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
            {auth.status === "authed" ? (
              <>
                <span className="nav-account-greeting">{auth.me.name}님</span>
                <span className="nav-divider" aria-hidden="true" />
                <button
                  className="nav-account-button"
                  type="button"
                  onClick={() => {
                    logout();
                    showToast("로그아웃했어요.");
                  }}
                >
                  로그아웃
                </button>
              </>
            ) : (
              <>
                <button
                  className="nav-account-button sign-up-button"
                  type="button"
                  onClick={() => setAuthMode("signUp")}
                >
                  {LANDING_COPY.actions.signUp}
                </button>
                <span className="nav-divider" aria-hidden="true" />
                <button
                  className="nav-account-button sign-in-button"
                  type="button"
                  onClick={() => setAuthMode("signIn")}
                >
                  {LANDING_COPY.actions.signIn}
                </button>
              </>
            )}
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

      <section className="intro-copy" aria-hidden={phaseAtLeast(phase, "transition")}>
        <p className="eyebrow">{LANDING_COPY.intro.eyebrow}</p>
        <h1>{LANDING_COPY.intro.title.replace(/\n/g, " ")}</h1>
        <p className="intro-description">{LANDING_COPY.intro.description}</p>
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

      <div className="career-layer" aria-label="다양한 직무를 상징하는 행성들">
        {CAREERS.map((career, index) => (
          <CareerPlanet
            career={career}
            index={index}
            key={career.name}
            pointerX={pointerX}
            pointerY={pointerY}
            reduceMotion={Boolean(reduceMotion)}
          />
        ))}
      </div>

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

      <div className="exhaust-trail-layer" aria-hidden="true">
        <span className="exhaust-trail-halo" />
        <span className="exhaust-trail-core" />
        <span className="exhaust-trail-wisps">
          {EXHAUST_WISPS.map((wisp, index) => (
            <i
              key={index}
              style={
                {
                  "--exhaust-x": wisp.x,
                  "--exhaust-y": wisp.y,
                  "--exhaust-size": wisp.size,
                  "--exhaust-delay": wisp.delay,
                  "--exhaust-duration": wisp.duration,
                } as CSSProperties
              }
            />
          ))}
        </span>
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

      {authMode && (
        <AuthModal
          mode={authMode}
          onClose={() => setAuthMode(null)}
          onModeChange={setAuthMode}
          onSuccess={() => {
            setAuthMode(null);
            showToast("환영해요! 직무 여정을 시작할 준비가 됐어요.");
          }}
        />
      )}
    </main>
  );
}
