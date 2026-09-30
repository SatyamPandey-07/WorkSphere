/**
 * Tests for dynamic feedback survey builder.
 */

type QuestionType = "rating" | "nps" | "multiple_choice" | "text" | "boolean";

interface SurveyQuestion {
  questionId: string;
  text: string;
  type: QuestionType;
  required: boolean;
  options?: string[];
  followUpCondition?: { questionId: string; answer: string };
}

interface SurveyResponse {
  questionId: string;
  answer: string | number | boolean;
}

function isQuestionApplicable(
  question: SurveyQuestion,
  responses: SurveyResponse[]
): boolean {
  if (!question.followUpCondition) return true;
  const trigger = responses.find((r) => r.questionId === question.followUpCondition!.questionId);
  return trigger?.answer === question.followUpCondition.answer;
}

function validateSurveyResponse(
  questions: SurveyQuestion[],
  responses: SurveyResponse[]
): string[] {
  const errors: string[] = [];
  for (const q of questions) {
    if (!isQuestionApplicable(q, responses)) continue;
    const response = responses.find((r) => r.questionId === q.questionId);
    if (q.required && !response) {
      errors.push(`Question "${q.text}" is required`);
    }
    if (q.type === "rating" && response) {
      const val = Number(response.answer);
      if (isNaN(val) || val < 1 || val > 5) errors.push(`"${q.text}": rating must be 1-5`);
    }
    if (q.type === "nps" && response) {
      const val = Number(response.answer);
      if (isNaN(val) || val < 0 || val > 10) errors.push(`"${q.text}": NPS must be 0-10`);
    }
  }
  return errors;
}

function surveyCompletionPct(questions: SurveyQuestion[], responses: SurveyResponse[]): number {
  const applicable = questions.filter((q) => isQuestionApplicable(q, responses));
  if (applicable.length === 0) return 100;
  const answered = applicable.filter((q) => responses.some((r) => r.questionId === q.questionId));
  return Math.round((answered.length / applicable.length) * 100);
}

const QUESTIONS: SurveyQuestion[] = [
  { questionId: "q1", text: "How was your experience?", type: "rating",   required: true  },
  { questionId: "q2", text: "Would you recommend us?",  type: "nps",      required: true  },
  { questionId: "q3", text: "What can we improve?",     type: "text",     required: false, followUpCondition: { questionId: "q1", answer: "3" } },
];

describe("Dynamic feedback survey builder", () => {
  it("isQuestionApplicable: no condition → always applicable", () => {
    expect(isQuestionApplicable(QUESTIONS[0], [])).toBe(true);
  });

  it("isQuestionApplicable: condition not met → not applicable", () => {
    const responses: SurveyResponse[] = [{ questionId: "q1", answer: 5 }];
    expect(isQuestionApplicable(QUESTIONS[2], responses)).toBe(false);
  });

  it("isQuestionApplicable: condition met → applicable", () => {
    const responses: SurveyResponse[] = [{ questionId: "q1", answer: "3" }];
    expect(isQuestionApplicable(QUESTIONS[2], responses)).toBe(true);
  });

  it("validateSurveyResponse: missing required → error", () => {
    const errors = validateSurveyResponse(QUESTIONS, [{ questionId: "q2", answer: 8 }]);
    expect(errors.some((e) => /How was your experience/i.test(e))).toBe(true);
  });

  it("validateSurveyResponse: valid responses → no errors", () => {
    const responses: SurveyResponse[] = [
      { questionId: "q1", answer: 4 },
      { questionId: "q2", answer: 9 },
    ];
    expect(validateSurveyResponse(QUESTIONS, responses)).toHaveLength(0);
  });

  it("surveyCompletionPct: 2 of 2 applicable answered = 100%", () => {
    const responses: SurveyResponse[] = [
      { questionId: "q1", answer: 4 }, { questionId: "q2", answer: 9 },
    ];
    expect(surveyCompletionPct(QUESTIONS, responses)).toBe(100);
  });

  it("surveyCompletionPct: 1 of 2 answered = 50%", () => {
    const responses: SurveyResponse[] = [{ questionId: "q1", answer: 4 }];
    expect(surveyCompletionPct(QUESTIONS, responses)).toBe(50);
  });
});
