import type { PolicyProfileGender, PolicyProfileUpdate } from "./api";

export const POLICY_BIRTH_YEAR_MIN = 1900;
export const POLICY_BIRTH_YEAR_MAX = 2026;

export const POLICY_REGION_CTPV = [
  "서울특별시",
  "부산광역시",
  "대구광역시",
  "인천광역시",
  "광주광역시",
  "전남광주통합특별시",
  "대전광역시",
  "울산광역시",
  "세종특별자치시",
  "경기도",
  "강원특별자치도",
  "충청북도",
  "충청남도",
  "전북특별자치도",
  "전라남도",
  "경상북도",
  "경상남도",
  "제주특별자치도",
] as const;

export type PolicyProfileForm = {
  birthYear: string;
  gender: "" | PolicyProfileGender;
  regionCtpv: string;
  regionSgg: string;
  disability: "" | "yes" | "no";
  sensitiveAgreed: boolean;
};

export const EMPTY_POLICY_PROFILE_FORM: PolicyProfileForm = {
  birthYear: "",
  gender: "",
  regionCtpv: "",
  regionSgg: "",
  disability: "",
  sensitiveAgreed: false,
};

export function buildPolicyProfileUpdate(form: PolicyProfileForm): {
  profile: PolicyProfileUpdate;
  error: string;
} {
  const profile: PolicyProfileUpdate = {};
  const birthYear = form.birthYear.trim();
  const regionSgg = form.regionSgg.trim();

  if (birthYear) {
    const parsedBirthYear = Number(birthYear);
    if (
      !Number.isInteger(parsedBirthYear) ||
      parsedBirthYear < POLICY_BIRTH_YEAR_MIN ||
      parsedBirthYear > POLICY_BIRTH_YEAR_MAX
    ) {
      return {
        profile,
        error: `출생 연도는 ${POLICY_BIRTH_YEAR_MIN}년부터 ${POLICY_BIRTH_YEAR_MAX}년 사이로 입력해주세요.`,
      };
    }
    profile.birth_year = parsedBirthYear;
  }

  if (form.gender) profile.gender = form.gender;
  if (form.regionCtpv) profile.region_ctpv = form.regionCtpv;

  if (regionSgg && !form.regionCtpv) {
    return { profile, error: "시군구를 입력하려면 먼저 시도를 선택해주세요." };
  }
  if (regionSgg) profile.region_sgg = regionSgg;

  if (form.disability) {
    if (!form.sensitiveAgreed) {
      return {
        profile,
        error: "장애 여부를 저장하려면 민감정보 수집·이용에 동의해주세요.",
      };
    }
    profile.has_disability = form.disability === "yes";
    profile.sensitive_agreed = true;
  }

  return { profile, error: "" };
}
