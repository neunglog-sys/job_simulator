const CAREER_AVATAR_CODES: ReadonlySet<string> = new Set([
  "kts-01",
  "kts-02",
  "kts-03",
  "kts-04",
  "kts-05",
  "ms-01",
  "ms-02",
  "ms-03",
  "ms-04",
  "ms-05",
  "ms-06",
  "ms-07",
  "ms-08",
  "ms-09",
  "ms-10",
  "ys-01",
  "ys-02",
  "ys-03",
  "ys-04",
  "ys-05",
  "ys-06",
  "ys-07",
  "ys-08",
  "ys-09",
  "ys-10",
  "jm-01",
  "jm-02",
  "jm-03",
  "jm-04",
  "jm-05",
  "yg-01",
  "yg-02",
  "yg-03",
  "yg-04",
  "yg-05",
  "stn-01",
  "stn-02",
  "stn-03",
  "stn-04",
  "stn-05",
  "cln-01",
  "gm-01",
  "hr-01",
  "sns-01",
  "wh-01",
]);

// data/recommendation/job_scenario_map.yaml의 세부 직무 연결을 프런트 폴백으로 보관한다.
// 과거 추천 결과에 scenario_slug가 없더라도 job_code만으로 대표 아바타를 찾을 수 있다.
const JOB_AVATAR_ALIASES: Readonly<Record<string, string>> = {
  "backend-developer": "yg-03",
  "j001": "ms-03",
  "j002": "ms-03",
  "j003": "ms-03",
  "j004": "ms-01",
  "j005": "ms-03",
  "j006": "ms-02",
  "j007": "ms-02",
  "j008": "ms-02",
  "j009": "ms-02",
  "j010": "ms-02",
  "j011": "ms-03",
  "j012": "ms-04",
  "j013": "ms-04",
  "j014": "stn-03",
  "j015": "ms-04",
  "j016": "ms-04",
  "j017": "ms-04",
  "j018": "ms-04",
  "j019": "ms-04",
  "j020": "ms-03",
  "j021": "kts-02",
  "j022": "ms-03",
  "j023": "ms-03",
  "j024": "ms-03",
  "j025": "stn-01",
  "j026": "stn-01",
  "j027": "stn-01",
  "j028": "stn-05",
  "j029": "stn-01",
  "j030": "stn-01",
  "j031": "stn-01",
  "j032": "ms-03",
  "j033": "stn-02",
  "j034": "stn-05",
  "j035": "stn-05",
  "j036": "ms-03",
  "j037": "stn-02",
  "j038": "stn-05",
  "j039": "stn-03",
  "j040": "stn-03",
  "j041": "stn-03",
  "j042": "stn-03",
  "j043": "stn-03",
  "j044": "kts-04",
  "j045": "kts-03",
  "j046": "ms-03",
  "j047": "kts-04",
  "j048": "kts-01",
  "j049": "kts-03",
  "j050": "kts-03",
  "j051": "ms-03",
  "j052": "stn-05",
  "j053": "kts-04",
  "j054": "kts-05",
  "j055": "kts-01",
  "j056": "kts-05",
  "j057": "kts-05",
  "j058": "kts-02",
  "j059": "kts-02",
  "j060": "kts-02",
  "j061": "kts-02",
  "j062": "yg-01",
  "j063": "yg-01",
  "j064": "yg-01",
  "j065": "yg-01",
  "j066": "yg-01",
  "j067": "sns-01",
  "j068": "sns-01",
  "j069": "ms-03",
  "j070": "yg-03",
  "j071": "yg-03",
  "j072": "yg-04",
  "j073": "yg-03",
  "j074": "yg-04",
  "j075": "yg-03",
  "j076": "yg-04",
  "j077": "yg-04",
  "j078": "yg-04",
  "j079": "ms-03",
  "j080": "ms-04",
  "j081": "ms-04",
  "j082": "jm-01",
  "j083": "ms-04",
  "j084": "ms-05",
  "j085": "ms-05",
  "j086": "ms-06",
  "j087": "ms-05",
  "j088": "ms-07",
  "j089": "ms-07",
  "j090": "ms-07",
  "j091": "ys-10",
  "j092": "ys-10",
  "j093": "kts-05",
  "j094": "ys-10",
  "j095": "ys-10",
  "j096": "ys-07",
  "j097": "ys-09",
  "j098": "ys-03",
  "j099": "ys-04",
  "j100": "ys-05",
  "j101": "jm-01",
  "j102": "jm-05",
  "j103": "jm-01",
  "marketer": "stn-01",
};

const SCENARIO_AVATAR_ALIASES: Readonly<Record<string, string>> = {
  "backend-dev-day1": "yg-03",
  "backend-developer": "yg-03",
};

function normalizeCode(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function getActiveCareerScenarioSlug(
  scenarioSlug: string | null,
): string | null {
  const normalizedScenarioSlug = normalizeCode(scenarioSlug);
  if (!normalizedScenarioSlug) return null;
  return SCENARIO_AVATAR_ALIASES[normalizedScenarioSlug] ?? normalizedScenarioSlug;
}

/**
 * 대표 직무는 자기 코드의 아바타를, 세부 직무(j001 등)는 연결된 시나리오의
 * 대표 아바타를 사용한다. 매핑되지 않은 값은 기존 시나리오 배경으로 폴백한다.
 */
export function getCareerAvatarSrc(
  jobCode: string,
  scenarioSlug: string | null,
): string | null {
  const normalizedJobCode = normalizeCode(jobCode);
  const normalizedScenarioSlug = getActiveCareerScenarioSlug(scenarioSlug) ?? "";

  const avatarCode = CAREER_AVATAR_CODES.has(normalizedJobCode)
    ? normalizedJobCode
    : JOB_AVATAR_ALIASES[normalizedJobCode] ??
      (CAREER_AVATAR_CODES.has(normalizedScenarioSlug)
        ? normalizedScenarioSlug
        : null);

  return avatarCode
    ? `${import.meta.env.BASE_URL}assets/career-avatars/${avatarCode}.webp`
    : null;
}
