import { ArrowRight, LightbulbFilament } from "@phosphor-icons/react";
import styles from "../../styles/oneToOneConversation.module.css";

type YouthPolicyCardProps = {
  onLearnMore: () => void;
};

export function YouthPolicyCard({ onLearnMore }: YouthPolicyCardProps) {
  return (
    <article className={styles.youthPolicyCard}>
      <header className={styles.youthPolicyHeader}>
        <span className={styles.youthPolicyIcon} aria-hidden="true">
          <LightbulbFilament weight="duotone" />
        </span>
        <h2>잠깐 혹시 이건 알고 계시나요?</h2>
      </header>
      <p>
        취업을 준비하는 청년이라면 정부와 지자체에서 운영하는 다양한 청년정책을 활용해볼 수
        있습니다. 청년일자리도약장려금, 국민취업지원제도, 청년도전지원사업 등을 통해 취업 상담,
        직무교육, 일경험, 면접 준비 등을 지원받을 수 있습니다. 정책마다 연령, 소득, 취업 상태 등
        신청 조건이 다르므로 청년정책 통합 플랫폼이나 거주지 관할 기관에서 세부 내용을 확인하는
        것이 좋습니다. 자신에게 맞는 제도를 적극적으로 활용하면 취업 준비에 필요한 시간과 비용
        부담을 줄일 수 있습니다.
      </p>
      <button className={styles.youthPolicyLink} type="button" onClick={onLearnMore}>
        더 알아보기
        <ArrowRight aria-hidden="true" />
      </button>
    </article>
  );
}
