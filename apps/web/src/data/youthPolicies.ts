export type YouthPolicy = {
  slug: string;
  title: string;
  summary: string;
  eligibility: string;
  applyUrl: string;
};

// 2026-07 기준 확인된 실제 정부 청년 정책 3건 (고용노동부/work24 공개 자료 기반, 조건은 수시 변경될 수 있어
// 최종 확인은 각 링크에서). 대상자에게 실제로 도움이 되는 정보를 주자는 목적이라 임의로 지어내지 않고,
// 확인 가능한 정책만 담았다.
export const YOUTH_POLICIES: YouthPolicy[] = [
  {
    slug: "youth-job-leap-incentive",
    title: "청년일자리도약장려금",
    summary:
      "우선지원대상기업(수도권) 또는 우선지원대상기업·중견기업(비수도권)이 취업애로청년을 정규직으로 채용해 6개월 이상 고용을 유지하면 기업에 1년간 최대 720만 원을 지원해요. 청년 입장에서는 이런 기업의 정규직 채용 기회가 늘어나는 효과가 있어요.",
    eligibility: "우선지원대상기업(수도권 5인 이상 등)에 정규직으로 채용되는 취업애로청년",
    applyUrl: "https://www.work24.go.kr",
  },
  {
    slug: "national-employment-support",
    title: "국민취업지원제도",
    summary:
      "만 15~69세 구직자 대상 취업지원 서비스예요. Ⅰ유형(중위소득 60% 이하, 청년은 120% 이하로 완화)은 구직촉진수당 월 60만 원씩 최대 6개월(총 360만 원), Ⅱ유형(청년은 소득 무관)은 취업활동비를 지원받을 수 있어요.",
    eligibility: "만 15~69세 구직자 (청년은 소득·재산 요건 완화)",
    applyUrl: "https://www.work24.go.kr/ua/z/z/1300/selectEmssRqutIntro.do",
  },
  {
    slug: "youth-challenge-support",
    title: "청년도전지원사업",
    summary:
      "신청일 이전 6개월 이상 취업·교육·직업훈련 이력이 없는 구직단념청년 등을 대상으로 상담, 프로그램 참여를 통해 구직 활동을 다시 시작할 수 있도록 지원해요. 2026년 신청 기간은 1월 29일~9월 30일(프로그램별 상이)이에요.",
    eligibility: "만 18~34세(지자체별 최대 39세) 구직단념청년·자립준비청년 등",
    applyUrl: "https://www.work.go.kr/youngChallenge/index.do",
  },
];
