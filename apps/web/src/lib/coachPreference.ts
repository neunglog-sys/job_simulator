export type CoachAvatarId = "male" | "female";

export type CoachProfile = {
  id: CoachAvatarId;
  name: string;
  role: string;
  description: string;
  portraitSrc: string;
  idleVideoSrc: string | null;
};

export const COACH_STORAGE_KEY = "jobiverse-career-coach";

export const COACH_PROFILES: Record<CoachAvatarId, CoachProfile> = {
  male: {
    id: "male",
    name: "이성현",
    role: "AI 진로 코치",
    description: "차분하게 방향을 정리하고 실행 계획을 함께 세워요.",
    portraitSrc: "/coach/lee-seonghyeon.webp",
    idleVideoSrc: "/avatar-idle-720p.mp4",
  },
  female: {
    id: "female",
    name: "임예원",
    role: "AI 진로 코치",
    description: "세심하게 이야기를 듣고 강점과 가능성을 함께 찾아요.",
    portraitSrc: "/coach/im-yewon.webp",
    idleVideoSrc: null,
  },
};

export function isCoachAvatarId(value: unknown): value is CoachAvatarId {
  return value === "male" || value === "female";
}

export function getStoredCoachId(): CoachAvatarId | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(COACH_STORAGE_KEY);
    return isCoachAvatarId(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function saveCoachId(coachId: CoachAvatarId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COACH_STORAGE_KEY, coachId);
  } catch {
    // 저장소가 차단된 환경에서도 현재 화면의 선택은 그대로 적용한다.
  }
}
