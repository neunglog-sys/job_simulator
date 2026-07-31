export type SurveyOption = {
  value: string;
  label: string;
};

export type SurveyQuestionData = {
  id: string;
  prompt: string;
  options: SurveyOption[];
};

export type SurveyAnswers = Record<string, string>;
