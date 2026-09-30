/**
 * Tests for post-booking survey analysis.
 */

interface SurveyResponse {
  responseId: string;
  bookingId: string;
  venueId: string;
  userId: string;
  questions: {
    id: string;
    question: string;
    type: "rating" | "text" | "boolean";
    value: number | string | boolean;
  }[];
  completedAt: number;
}

function extractRatings(response: SurveyResponse): Record<string, number> {
  const ratings: Record<string, number> = {};
  for (const q of response.questions) {
    if (q.type === "rating" && typeof q.value === "number") {
      ratings[q.id] = q.value;
    }
  }
  return ratings;
}

function avgSurveyRating(responses: SurveyResponse[], venueId: string): number {
  const relevant = responses.filter((r) => r.venueId === venueId);
  if (relevant.length === 0) return 0;
  const allRatings = relevant.flatMap((r) =>
    r.questions.filter((q) => q.type === "rating").map((q) => Number(q.value))
  );
  if (allRatings.length === 0) return 0;
  return Math.round((allRatings.reduce((s, v) => s + v, 0) / allRatings.length) * 10) / 10;
}

function textFeedback(responses: SurveyResponse[], venueId: string): string[] {
  return responses
    .filter((r) => r.venueId === venueId)
    .flatMap((r) =>
      r.questions
        .filter((q) => q.type === "text" && typeof q.value === "string" && (q.value as string).trim())
        .map((q) => q.value as string)
    );
}

function surveyCompletionRate(responses: SurveyResponse[], venueId: string, totalBookings: number): number {
  const completed = responses.filter((r) => r.venueId === venueId).length;
  if (totalBookings === 0) return 0;
  return Math.round((completed / totalBookings) * 100);
}

const NOW = 1_700_000_000_000;
const RESPONSES: SurveyResponse[] = [
  {
    responseId: "sr1", bookingId: "b1", venueId: "v1", userId: "u1", completedAt: NOW - 1000,
    questions: [
      { id: "q1", question: "How was the space?",  type: "rating",  value: 4 },
      { id: "q2", question: "Any comments?",       type: "text",    value: "Great wifi!" },
      { id: "q3", question: "Would recommend?",    type: "boolean", value: true },
    ],
  },
  {
    responseId: "sr2", bookingId: "b2", venueId: "v1", userId: "u2", completedAt: NOW - 500,
    questions: [
      { id: "q1", question: "How was the space?",  type: "rating",  value: 5 },
      { id: "q2", question: "Any comments?",       type: "text",    value: "" },
    ],
  },
];

describe("Post-booking survey analysis", () => {
  it("extractRatings: gets all rating questions", () => {
    const ratings = extractRatings(RESPONSES[0]);
    expect(ratings.q1).toBe(4);
    expect(ratings.q2).toBeUndefined(); // q2 is text
  });

  it("avgSurveyRating: v1 = (4+5)/2 = 4.5", () => {
    expect(avgSurveyRating(RESPONSES, "v1")).toBe(4.5);
  });

  it("avgSurveyRating: unknown venue → 0", () => {
    expect(avgSurveyRating(RESPONSES, "v99")).toBe(0);
  });

  it("textFeedback: returns non-empty text responses", () => {
    const feedback = textFeedback(RESPONSES, "v1");
    expect(feedback).toContain("Great wifi!");
    expect(feedback).not.toContain(""); // empty strings excluded
  });

  it("surveyCompletionRate: 2 of 10 bookings = 20%", () => {
    expect(surveyCompletionRate(RESPONSES, "v1", 10)).toBe(20);
  });

  it("surveyCompletionRate: 0 bookings → 0", () => {
    expect(surveyCompletionRate(RESPONSES, "v1", 0)).toBe(0);
  });
});
