import {
  Buildings,
  ClipboardText,
  SpinnerGap,
  SuitcaseSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import styles from "../../styles/oneToOneConversation.module.css";
import { ConversationModalShell } from "./ConversationModalShell";

export type VirtualCompanyGateReason =
  | "checking"
  | "survey"
  | "recommendation"
  | "scenario"
  | "error";

type VirtualCompanyGateModalProps = {
  reason: VirtualCompanyGateReason;
  onAction: () => void;
  onClose: () => void;
};

const gateContent = {
  survey: {
    icon: ClipboardText,
    title: "설문을 완료하고 추천 직무를 받아보세요.",
    description:
      "현재 대화의 설문을 완료하면 상담 내용을 함께 분석해 잘 맞는 가상 회사를 연결해 드려요.",
    actionLabel: "설문하러 가기",
  },
  recommendation: {
    icon: SuitcaseSimple,
    title: "추천 직무를 먼저 받아보세요.",
    description:
      "현재 대화의 설문 결과로 추천 직무를 확인한 뒤, 가장 잘 맞는 가상 회사에 입장할 수 있어요.",
    actionLabel: "추천 직무 확인하기",
  },
  scenario: {
    icon: Buildings,
    title: "체험할 추천 직무를 선택해 주세요.",
    description:
      "추천 결과에서 체험 가능한 직무를 선택하면 해당 가상 회사로 바로 이동할 수 있어요.",
    actionLabel: "추천 직무 보기",
  },
  error: {
    icon: WarningCircle,
    title: "추천 결과를 확인하지 못했어요.",
    description: "서버 연결을 확인한 뒤 다시 시도해 주세요.",
    actionLabel: "다시 확인하기",
  },
} as const;

export function VirtualCompanyGateModal({
  reason,
  onAction,
  onClose,
}: VirtualCompanyGateModalProps) {
  const content = reason === "checking" ? null : gateContent[reason];
  const ContentIcon = content?.icon;

  return (
    <ConversationModalShell
      title="가상 회사 입장 준비"
      description="현재 선택한 대화의 설문과 추천 결과를 기준으로 직무 체험을 연결합니다."
      icon={Buildings}
      size="gate"
      onClose={onClose}
    >
      {content && ContentIcon ? (
        <div className={styles.conversationModalState}>
          <ContentIcon weight="duotone" aria-hidden="true" />
          <strong>{content.title}</strong>
          <p>{content.description}</p>
          <button type="button" onClick={onAction}>
            {content.actionLabel}
          </button>
        </div>
      ) : (
        <div
          className={`${styles.conversationModalState} ${styles.virtualCompanyGateLoading}`}
          aria-live="polite"
        >
          <SpinnerGap aria-hidden="true" />
          <strong>현재 대화의 추천 결과를 확인하고 있어요.</strong>
          <p>잠시만 기다려 주세요.</p>
        </div>
      )}
    </ConversationModalShell>
  );
}
