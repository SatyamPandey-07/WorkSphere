/**
 * Tests for venue booking UX heuristic evaluation.
 */

interface UxHeuristic {
  heuristicId: string;
  name: string;
  score: number;     // 0-10 (10 = best UX)
  severity: "low" | "medium" | "high" | "critical";
  description: string;
}

interface UxEvaluation {
  pageId: string;
  heuristics: UxHeuristic[];
  evaluatedAt: number;
  evaluator: string;
}

function overallUxScore(evaluation: UxEvaluation): number {
  if (evaluation.heuristics.length === 0) return 0;
  const avg = evaluation.heuristics.reduce((s, h) => s + h.score, 0) / evaluation.heuristics.length;
  return Math.round(avg * 10) / 10;
}

function criticalIssues(evaluation: UxEvaluation): UxHeuristic[] {
  return evaluation.heuristics.filter((h) => h.severity === "critical");
}

function heuristicsBelow(evaluation: UxEvaluation, threshold: number): UxHeuristic[] {
  return evaluation.heuristics.filter((h) => h.score < threshold);
}

function uxLabel(score: number): "poor" | "fair" | "good" | "excellent" {
  if (score >= 8) return "excellent";
  if (score >= 6) return "good";
  if (score >= 4) return "fair";
  return "poor";
}

function priorityImprovements(evaluation: UxEvaluation, limit = 3): UxHeuristic[] {
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...evaluation.heuristics]
    .sort((a, b) => {
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[a.severity] - severityOrder[b.severity];
      }
      return a.score - b.score; // lower score = higher priority within same severity
    })
    .slice(0, limit);
}

const EVALUATION: UxEvaluation = {
  pageId: "booking-flow", evaluatedAt: 1_700_000_000_000, evaluator: "ux-team",
  heuristics: [
    { heuristicId: "h1", name: "Visibility of system status",   score: 8,  severity: "low",      description: "Good status indicators" },
    { heuristicId: "h2", name: "Error prevention",              score: 4,  severity: "high",     description: "Insufficient validation" },
    { heuristicId: "h3", name: "Consistency and standards",     score: 7,  severity: "medium",   description: "Some inconsistencies" },
    { heuristicId: "h4", name: "Recognition not recall",        score: 3,  severity: "critical", description: "User must remember steps" },
    { heuristicId: "h5", name: "Flexibility and efficiency",    score: 6,  severity: "low",      description: "Limited shortcuts" },
  ],
};

describe("Venue booking UX heuristics", () => {
  it("overallUxScore: (8+4+7+3+6)/5 = 5.6", () => {
    expect(overallUxScore(EVALUATION)).toBe(5.6);
  });

  it("criticalIssues: 1 critical heuristic", () => {
    expect(criticalIssues(EVALUATION)).toHaveLength(1);
    expect(criticalIssues(EVALUATION)[0].heuristicId).toBe("h4");
  });

  it("heuristicsBelow: 2 heuristics below score 5", () => {
    expect(heuristicsBelow(EVALUATION, 5)).toHaveLength(2);
  });

  it("uxLabel: 5.6 → fair", () => {
    expect(uxLabel(overallUxScore(EVALUATION))).toBe("fair");
  });

  it("priorityImprovements: critical first", () => {
    const improvements = priorityImprovements(EVALUATION);
    expect(improvements[0].severity).toBe("critical");
  });

  it("priorityImprovements: respects limit", () => {
    expect(priorityImprovements(EVALUATION, 2)).toHaveLength(2);
  });
});
