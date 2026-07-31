import { useRef, type FormEvent } from "react";
import styles from "../../styles/oneToOneConversation.module.css";
import type { SurveyAnswers, SurveyQuestionData } from "../../types/survey";
import { GlassScrollbar } from "./GlassScrollbar";
import { SurveyQuestion } from "./SurveyQuestion";

type SurveyDrawerProps = {
  questions: SurveyQuestionData[];
  answers: SurveyAnswers;
  submitting: boolean;
  error: string | null;
  onAnswerChange: (questionId: string, value: string) => void;
  onSubmit: () => void;
};

export function SurveyDrawer({
  questions,
  answers,
  submitting,
  error,
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
        {questions.length === 0 ? (
          <p style={{ margin: 0, padding: "16px 4px", color: "#655a73", fontSize: 14, lineHeight: "21px" }}>
            설문 문항을 불러오는 중이에요…
          </p>
        ) : (
          <div className={styles.surveyQuestionList}>
            {questions.map((question) => (
              <SurveyQuestion
                key={question.id}
                question={question}
                value={answers[question.id]}
                disabled={submitting}
                onChange={onAnswerChange}
              />
            ))}
          </div>
        )}
      </div>
      <GlassScrollbar
        viewportRef={questionViewportRef}
        className={styles.surveyScrollbar}
        refreshKey={questions.length}
      />

      {error ? (
        <p className={styles.surveyError} role="alert">
          {error}
        </p>
      ) : null}

      <button
        className={styles.surveySubmitButton}
        type="submit"
        disabled={submitting || questions.length === 0}
      >
        {submitting ? "제출 중…" : "제출하기"}
      </button>
    </form>
  );
}
