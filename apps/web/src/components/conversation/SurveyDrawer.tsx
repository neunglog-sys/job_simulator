import { useRef, type FormEvent } from "react";
import { surveyQuestions } from "../../data/surveyMockData";
import styles from "../../styles/oneToOneConversation.module.css";
import type { SurveyAnswers } from "../../types/survey";
import { GlassScrollbar } from "./GlassScrollbar";
import { SurveyQuestion } from "./SurveyQuestion";

type SurveyDrawerProps = {
  answers: SurveyAnswers;
  onAnswerChange: (questionId: string, value: string) => void;
  onSubmit: () => void;
};

export function SurveyDrawer({
  answers,
  onAnswerChange,
  onSubmit,
}: SurveyDrawerProps) {
  const questionViewportRef = useRef<HTMLDivElement>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className={styles.surveyDrawer} onSubmit={handleSubmit} aria-label="직무 추천 설문">
      <div className={styles.panelHeading}>
        <span>CAREER SURVEY</span>
        <h2>나에게 맞는 직무를 찾기 위한 설문</h2>
        <p>응답은 탭을 이동해도 그대로 저장됩니다.</p>
      </div>
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
                disabled={false}
                onChange={onAnswerChange}
              />
            ))}
          </div>
        </div>
        <GlassScrollbar
          viewportRef={questionViewportRef}
          className={styles.surveyScrollbar}
          refreshKey={surveyQuestions.length}
        />

        <button className={styles.surveySubmitButton} type="submit">
          제출하기
        </button>
    </form>
  );
}
