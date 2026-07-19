import { ArrowRight } from "@phosphor-icons/react";
import styles from "../../styles/oneToOneConversation.module.css";

type SurveyStartMessageButtonProps = {
  onClick: () => void;
};

export function SurveyStartMessageButton({ onClick }: SurveyStartMessageButtonProps) {
  return (
    <button className={styles.surveyStartMessageButton} type="button" onClick={onClick}>
      <span>설문하기</span>
      <ArrowRight aria-hidden="true" />
    </button>
  );
}
