import styles from "../../styles/oneToOneConversation.module.css";

type SurveyTestToggleButtonProps = {
  open: boolean;
  onToggle: () => void;
};

export function SurveyTestToggleButton({ open, onToggle }: SurveyTestToggleButtonProps) {
  return (
    <button className={styles.surveyTestToggleButton} type="button" onClick={onToggle}>
      {open ? "설문 패널 닫기" : "설문 패널 테스트"}
    </button>
  );
}
