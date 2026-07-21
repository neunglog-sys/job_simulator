import { ArrowSquareOut, LightbulbFilament } from "@phosphor-icons/react";
import { YOUTH_POLICIES } from "../../data/youthPolicies";
import styles from "../../styles/oneToOneConversation.module.css";
import { ConversationModalShell } from "./ConversationModalShell";

type YouthPolicyModalProps = {
  onClose: () => void;
};

export function YouthPolicyModal({ onClose }: YouthPolicyModalProps) {
  return (
    <ConversationModalShell
      title="청년정책 알아보기"
      description="정부와 지자체가 운영하는 청년 취업 지원 제도예요. 조건이 맞는지 링크에서 꼭 다시 확인해주세요."
      icon={LightbulbFilament}
      onClose={onClose}
    >
      <div className={styles.conversationHistoryList}>
        {YOUTH_POLICIES.map((policy) => (
          <article className={styles.youthPolicyModalItem} key={policy.slug}>
            <h3>{policy.title}</h3>
            <p>{policy.summary}</p>
            <span className={styles.youthPolicyModalEligibility}>대상: {policy.eligibility}</span>
            <a
              className={styles.youthPolicyLink}
              href={policy.applyUrl}
              target="_blank"
              rel="noreferrer"
            >
              신청 바로가기
              <ArrowSquareOut aria-hidden="true" />
            </a>
          </article>
        ))}
      </div>
    </ConversationModalShell>
  );
}
