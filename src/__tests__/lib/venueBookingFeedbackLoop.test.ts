/**
 * Tests for venue booking continuous improvement feedback loop.
 */

interface ImprovementSuggestion {
  id: string;
  source: "guest" | "staff" | "analytics" | "management";
  category: "pricing" | "process" | "amenity" | "communication" | "tech" | "staffing";
  title: string;
  impactScore: number;   // 0-10
  effortScore: number;   // 0-10 (higher = more effort)
  votes: number;
  status: "proposed" | "reviewing" | "approved" | "in_progress" | "completed" | "rejected";
  createdAt: number;
}

function priorityMatrix(suggestion: ImprovementSuggestion): "quick_win" | "major_project" | "fill_in" | "thankless_task" {
  const highImpact = suggestion.impactScore >= 5;
  const highEffort = suggestion.effortScore >= 5;
  if (highImpact && !highEffort) return "quick_win";
  if (highImpact && highEffort)  return "major_project";
  if (!highImpact && !highEffort) return "fill_in";
  return "thankless_task";
}

function roi(suggestion: ImprovementSuggestion): number {
  if (suggestion.effortScore === 0) return Infinity;
  return Math.round((suggestion.impactScore / suggestion.effortScore) * 100) / 100;
}

function topSuggestions(suggestions: ImprovementSuggestion[], limit = 3): ImprovementSuggestion[] {
  return [...suggestions]
    .filter((s) => s.status !== "rejected" && s.status !== "completed")
    .sort((a, b) => roi(b) - roi(a))
    .slice(0, limit);
}

function completionRate(suggestions: ImprovementSuggestion[]): number {
  if (suggestions.length === 0) return 0;
  const done = suggestions.filter((s) => s.status === "completed").length;
  return Math.round((done / suggestions.length) * 100);
}

function suggestionsByCategory(suggestions: ImprovementSuggestion[]): Record<ImprovementSuggestion["category"], number> {
  const counts: Partial<Record<ImprovementSuggestion["category"], number>> = {};
  for (const s of suggestions) counts[s.category] = (counts[s.category] ?? 0) + 1;
  return counts as Record<ImprovementSuggestion["category"], number>;
}

const NOW = 1_700_000_000_000;
const SUGGESTIONS: ImprovementSuggestion[] = [
  { id: "s1", source: "guest",     category: "pricing",       title: "Dynamic pricing",   impactScore: 8, effortScore: 3, votes: 45, status: "approved",    createdAt: NOW - 10 * 86_400_000 },
  { id: "s2", source: "analytics", category: "process",       title: "Auto confirmation", impactScore: 7, effortScore: 7, votes: 30, status: "in_progress", createdAt: NOW - 20 * 86_400_000 },
  { id: "s3", source: "staff",     category: "communication", title: "SMS reminders",     impactScore: 5, effortScore: 2, votes: 20, status: "proposed",    createdAt: NOW - 5 * 86_400_000 },
  { id: "s4", source: "management",category: "tech",          title: "Old dashboard",     impactScore: 2, effortScore: 8, votes: 5,  status: "rejected",    createdAt: NOW - 30 * 86_400_000 },
];

describe("Continuous improvement feedback loop", () => {
  it("priorityMatrix: high impact low effort → quick_win", () => {
    expect(priorityMatrix(SUGGESTIONS[0])).toBe("quick_win");
  });

  it("priorityMatrix: high impact high effort → major_project", () => {
    expect(priorityMatrix(SUGGESTIONS[1])).toBe("major_project");
  });

  it("roi: s1 impact 8, effort 3 = 2.67", () => {
    expect(roi(SUGGESTIONS[0])).toBe(2.67);
  });

  it("topSuggestions: returns highest ROI non-rejected", () => {
    const top = topSuggestions(SUGGESTIONS);
    expect(top[0].id).toBe("s1"); // highest ROI = 8/3
    expect(top.every((s) => s.status !== "rejected")).toBe(true);
  });

  it("completionRate: 0 completed = 0%", () => {
    expect(completionRate(SUGGESTIONS)).toBe(0);
  });

  it("suggestionsByCategory: 1 pricing suggestion", () => {
    expect(suggestionsByCategory(SUGGESTIONS).pricing).toBe(1);
  });
});
