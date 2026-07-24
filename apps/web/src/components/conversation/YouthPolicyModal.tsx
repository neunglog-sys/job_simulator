import { ArrowSquareOut, LightbulbFilament } from "@phosphor-icons/react";
import { YOUTH_POLICIES } from "../../data/youthPolicies";
import type { PolicyCardItem } from "../../lib/api";
import { usePolicyCard } from "../../lib/usePolicyCard";
import styles from "../../styles/oneToOneConversation.module.css";
import { ConversationModalShell } from "./ConversationModalShell";

type YouthPolicyModalProps = {
  onClose: () => void;
};

type ModalItem = {
  key: string;
  title: string;
  summary: string;
  /** 대상 조건(고정 목록) 또는 소관 기관(API) — 둘 중 있는 쪽을 보여준다. */
  meta: string;
  link: string;
};

const FALLBACK_ITEMS: ModalItem[] = YOUTH_POLICIES.map((policy) => ({
  key: policy.slug,
  title: policy.title,
  summary: policy.summary,
  meta: `대상: ${policy.eligibility}`,
  link: policy.applyUrl,
}));

export function YouthPolicyModal({ onClose }: YouthPolicyModalProps) {
  const card = usePolicyCard();

  // 카드 본문이 언급한 제도를 그대로 펼친다 — 목록에 본문에 없는 제도가 섞이면
  // 사용자가 어느 걸 말한 건지 헷갈린다. 조건에 맞는 제도를 못 찾았을 때만 고정 목록.
  const toItem = (policy: PolicyCardItem, index: number): ModalItem => ({
    key: `${policy.name}-${index}`,
    title: policy.name,
    summary: policy.summary || "",
    meta: policy.provider ? `운영: ${policy.provider}` : "",
    link: policy.link,
  });

  // 본문이 언급한 제도를 맨 위에 두고, 함께 골라둔 제도를 잇는다.
  // 본문에서 읽은 제도를 목록 처음에서 다시 만나야 어느 걸 말한 건지 헷갈리지 않는다.
  const cited = (card?.cited ?? []).map(toItem);
  const more = (card?.more ?? []).map((policy, i) => toItem(policy, cited.length + i));
  const items: ModalItem[] = cited.length ? [...cited, ...more] : FALLBACK_ITEMS;

  return (
    <ConversationModalShell
      title="청년정책 알아보기"
      description="정부와 지자체가 운영하는 청년 취업 지원 제도예요. 조건이 맞는지 링크에서 꼭 다시 확인해주세요."
      icon={LightbulbFilament}
      onClose={onClose}
    >
      <div className={styles.conversationHistoryList}>
        {items.map((item) => (
          <article className={styles.youthPolicyModalItem} key={item.key}>
            <h3>{item.title}</h3>
            {item.summary ? <p>{item.summary}</p> : null}
            {item.meta ? (
              <span className={styles.youthPolicyModalEligibility}>{item.meta}</span>
            ) : null}
            {item.link ? (
              <a
                className={styles.youthPolicyLink}
                href={item.link}
                target="_blank"
                rel="noreferrer"
              >
                신청 바로가기
                <ArrowSquareOut aria-hidden="true" />
              </a>
            ) : null}
          </article>
        ))}
      </div>
    </ConversationModalShell>
  );
}
