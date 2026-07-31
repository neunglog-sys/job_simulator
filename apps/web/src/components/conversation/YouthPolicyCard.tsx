import { ArrowRight, LightbulbFilament } from "@phosphor-icons/react";
import { YOUTH_POLICIES } from "../../data/youthPolicies";
import { usePolicyAge, usePolicyCard } from "../../lib/usePolicyCard";
import styles from "../../styles/oneToOneConversation.module.css";

type YouthPolicyCardProps = {
  onLearnMore: () => void;
};

export function YouthPolicyCard({ onLearnMore }: YouthPolicyCardProps) {
  // 프로필 조건에 맞는 제도를 백엔드가 찾아 문구까지 만들어 준다.
  // 조회 전이거나 조건에 맞는 제도가 없으면 null → 아래 일반 안내 문구를 그대로 둔다
  // (카드 자리가 비거나 늦게 튀어나오지 않게).
  const personalized = usePolicyCard();
  // 정부 API가 죽어 아래 일반 문구를 쓸 때, 나이에 맞는 제도만 이름을 댄다.
  // 전에는 나이와 무관하게 청년 제도 3건을 그대로 나열해 68세에게도 그대로 나갔다.
  const age = usePolicyAge();
  const names = YOUTH_POLICIES.filter(
    (policy) => age == null || (age >= policy.minAge && age <= policy.maxAge),
  ).map((policy) => policy.title);

  return (
    <article className={styles.youthPolicyCard}>
      <header className={styles.youthPolicyHeader}>
        <span className={styles.youthPolicyIcon} aria-hidden="true">
          <LightbulbFilament weight="duotone" />
        </span>
        <h2>{personalized?.title ?? "잠깐 혹시 이건 알고 계시나요?"}</h2>
      </header>
      {personalized ? (
        <p>{personalized.body}</p>
      ) : (
        <p>
          취업을 준비한다면 정부와 지자체에서 운영하는 다양한 취업 지원 제도를 활용해볼 수
          있습니다.{names.length ? ` ${names.join(", ")} 등을 통해` : " 이런 제도를 통해"} 취업
          상담, 직무교육, 일경험, 면접 준비 등을 지원받을 수 있습니다. 정책마다 연령, 소득, 취업
          상태 등 신청 조건이 다르므로 정부24나 거주지 관할 기관에서 세부 내용을 확인하는 것이
          좋습니다.
        </p>
      )}
      <button className={styles.youthPolicyLink} type="button" onClick={onLearnMore}>
        더 알아보기
        <ArrowRight aria-hidden="true" />
      </button>
    </article>
  );
}
