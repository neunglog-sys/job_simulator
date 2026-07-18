import { X } from "@phosphor-icons/react";
import { useRef, type FormEvent } from "react";
import { surveyQuestions } from "../../data/surveyMockData";
import styles from "../../styles/oneToOneConversation.module.css";
import type { SurveyAnswers } from "../../types/survey";
import { GlassScrollbar } from "./GlassScrollbar";
import { SurveyQuestion } from "./SurveyQuestion";

type SurveyDrawerProps = {
  open: boolean;
  answers: SurveyAnswers;
  onAnswerChange: (questionId: string, value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function SurveyDrawer({
  open,
  answers,
  onAnswerChange,
  onClose,
  onSubmit,
}: SurveyDrawerProps) {
  const questionViewportRef = useRef<HTMLDivElement>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <div
      className={`${styles.surveyDrawerLayer} ${open ? styles.surveyDrawerLayerOpen : ""}`}
      aria-hidden={!open}
    >
      <form className={styles.surveyDrawer} onSubmit={handleSubmit}>
        <button
          className={styles.surveyCloseButton}
          type="button"
          onClick={onClose}
          disabled={!open}
          aria-label="설문 패널 닫기"
        >
          <X aria-hidden="true" />
        </button>

        <div
          ref={questionViewportRef}
          className={styles.surveyQuestionViewport}
          aria-label="직무 추천 설문 질문"
        >
          <div className={styles.surveyQuestionList}>
            {surveyQuestions.map((question) => (
              <SurveyQuestion
                key={question.id}
                question={question}
                value={answers[question.id]}
                disabled={!open}
                onChange={onAnswerChange}
              />
            ))}
          </div>
        </div>
        <GlassScrollbar
          viewportRef={questionViewportRef}
          className={styles.surveyScrollbar}
          refreshKey={`${open}-${surveyQuestions.length}`}
        />

        <button className={styles.surveySubmitButton} type="submit" disabled={!open}>
          제출하기
        </button>
      </form>
    </div>
  );
}
