/**
 * 4단계 미니게임 공용 타입 — 백엔드 data/minigames/<slug>.yaml 과 짝.
 * 형식 정의는 data/minigames/_SCHEMA.md.
 */

/** 좌표 기준 캔버스. YAML의 at:[x,y]는 이 크기 기준이고 화면 크기에 맞춰 비율로 환산된다. */
export const SCENE = { w: 960, h: 440 } as const;

/** 백엔드 MINIGAME_COMPETENCY에 등록된 키 11종 — 이 문자열이 곧 점수 반영 키다.
 *  YAML의 engine 값이 여기 없으면 백엔드 로더가 걸러내 minigame이 null로 온다.
 *  typing 은 팀 확정(2026-07-20) 예외 엔진 — backend 시나리오 전용, 속도 미채점. */
export const ENGINES = [
  "spot",
  "gauge",
  "sort",
  "match",
  "route",
  "sequence",
  "pour",
  "trace",
  "physics",
  "place",
  "typing",
] as const;

export type Engine = (typeof ENGINES)[number];

export type Hotspot = {
  id: string;
  sprite: string;
  at: [number, number];
  label?: string;
};

export type Vessel = {
  id: string;
  label?: string;
  /** 목표 높이 0~1. 화면엔 숫자가 아니라 표시선으로만 그린다. */
  target: number;
  /** 이 폭 안이면 만점 */
  tolerance: number;
};

export type PourData = {
  vessels?: Vessel[];
  /** 넘쳤을 때 / 모자랄 때 감점 (YAML scoring 에서 옮겨온다) */
  overPenalty?: number;
  underPenalty?: number;
};

export type SpotData = {
  scene?: string;
  mark?: "x" | "tag" | "shutter";
  targets?: Hotspot[];
  decoys?: Hotspot[];
  /** 오답 1건당 감점 (기본 10) — YAML scoring.decoy_penalty 에서 옮겨온다. */
  decoyPenalty?: number;
};

/** 서버로 보내는 결과. engine은 MiniGamePanel이 붙이므로 게임은 성적만 낸다. */
export type MinigameResult = {
  accuracy: number; // 0~100
  time_seconds?: number;
  mistakes?: number;
};

/** 시뮬레이션 응답의 minigame 필드 (없으면 null → '준비 중' 빈 창으로 폴백). */
export type MinigameDef = {
  /** data/minigames/<id>.yaml의 시나리오 ID — 게임별 배경·자산 선택에 사용한다. */
  id?: string;
  engine: Engine;
  title: string;
  intro: string;
  time_limit: number | null;
  pass_score: number;
  data: Record<string, unknown>;
  scoring?: Record<string, unknown>;
};
