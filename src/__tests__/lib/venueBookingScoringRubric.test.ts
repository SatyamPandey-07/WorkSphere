/**
 * Tests for venue quality scoring rubric evaluation.
 */

interface RubricCriterion {
  id: string;
  name: string;
  weight: number;   // relative weight (0-1, sum = 1)
  maxScore: number;
  description: string;
}

interface RubricEvaluation {
  criterionId: string;
  score: number;    // 0 to maxScore
  evaluatorNotes: string;
}

const RUBRIC: RubricCriterion[] = [
  { id: "r1", name: "Cleanliness",      weight: 0.25, maxScore: 10, description: "Overall cleanliness" },
  { id: "r2", name: "Value for Money",  weight: 0.20, maxScore: 10, description: "Price vs quality ratio" },
  { id: "r3", name: "Facilities",       weight: 0.20, maxScore: 10, description: "Equipment & amenities" },
  { id: "r4", name: "Location",         weight: 0.15, maxScore: 10, description: "Accessibility & area" },
  { id: "r5", name: "Communication",    weight: 0.10, maxScore: 10, description: "Responsiveness" },
  { id: "r6", name: "Check-in Process", weight: 0.10, maxScore: 10, description: "Ease of access" },
];

function weightedRubricScore(evaluations: RubricEvaluation[]): number {
  let total = 0;
  for (const eval_ of evaluations) {
    const criterion = RUBRIC.find((r) => r.id === eval_.criterionId);
    if (!criterion) continue;
    const normalised = eval_.score / criterion.maxScore;
    total += normalised * criterion.weight;
  }
  return Math.round(total * 100) / 100;
}

function toStarRating(rubricScore: number): number {
  // rubricScore is 0-1, convert to 0-5 stars
  return Math.round(rubricScore * 5 * 10) / 10;
}

function lowestScoringCriteria(evaluations: RubricEvaluation[], count = 2): RubricEvaluation[] {
  return [...evaluations]
    .sort((a, b) => {
      const cA = RUBRIC.find((r) => r.id === a.criterionId)!;
      const cB = RUBRIC.find((r) => r.id === b.criterionId)!;
      return (a.score / cA.maxScore) - (b.score / cB.maxScore);
    })
    .slice(0, count);
}

function evaluationCompleteness(evaluations: RubricEvaluation[]): number {
  return Math.round((evaluations.length / RUBRIC.length) * 100);
}

const EVALUATIONS: RubricEvaluation[] = [
  { criterionId: "r1", score: 9,  evaluatorNotes: "Spotless" },
  { criterionId: "r2", score: 7,  evaluatorNotes: "Good value" },
  { criterionId: "r3", score: 8,  evaluatorNotes: "Modern AV" },
  { criterionId: "r4", score: 9,  evaluatorNotes: "Central" },
  { criterionId: "r5", score: 6,  evaluatorNotes: "Slow response" },
  { criterionId: "r6", score: 10, evaluatorNotes: "Seamless" },
];

describe("Quality scoring rubric evaluation", () => {
  it("weightedRubricScore: high scores → near 1.0", () => {
    const score = weightedRubricScore(EVALUATIONS);
    expect(score).toBeGreaterThan(0.75);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("toStarRating: score 0.8 → 4.0 stars", () => {
    expect(toStarRating(0.8)).toBe(4.0);
  });

  it("lowestScoringCriteria: communication has score 6 = lowest", () => {
    const lowest = lowestScoringCriteria(EVALUATIONS, 1);
    expect(lowest[0].criterionId).toBe("r5");
  });

  it("evaluationCompleteness: 6 of 6 = 100%", () => {
    expect(evaluationCompleteness(EVALUATIONS)).toBe(100);
  });

  it("evaluationCompleteness: 3 of 6 = 50%", () => {
    expect(evaluationCompleteness(EVALUATIONS.slice(0, 3))).toBe(50);
  });
});
