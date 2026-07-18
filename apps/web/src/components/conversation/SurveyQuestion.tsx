import styles from "../../styles/oneToOneConversation.module.css";
import type { SurveyQuestionData } from "../../types/survey";

type SurveyQuestionProps = {
  question: SurveyQuestionData;
  value?: string;
  disabled: boolean;
  onChange: (questionId: string, value: string) => void;
};

export function SurveyQuestion({ question, value, disabled, onChange }: SurveyQuestionProps) {
  return (
    <fieldset className={styles.surveyQuestion} disabled={disabled}>
      <legend className={styles.surveyQuestionHeader}>
        <span className={styles.surveyQuestionMark} aria-hidden="true">
          Q
        </span>
        <span>{question.prompt}</span>
      </legend>

      <div className={styles.surveyOptions}>
        {question.options.map((option) => (
          <label className={styles.surveyOption} key={option.value}>
            <input
              className={styles.surveyRadioInput}
              type="radio"
              name={question.id}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(question.id, option.value)}
            />
            <span className={styles.surveyRadioControl} aria-hidden="true" />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
