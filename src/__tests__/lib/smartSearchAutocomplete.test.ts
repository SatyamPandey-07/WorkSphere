/**
 * Tests for search autocomplete suggestion generation.
 */

interface AutocompleteSuggestion {
  text: string;
  type: "venue" | "city" | "category" | "recent";
  score: number;
}

function filterSuggestions(
  suggestions: AutocompleteSuggestion[],
  query: string,
  limit = 5
): AutocompleteSuggestion[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return suggestions
    .filter((s) => s.text.toLowerCase().includes(q))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function deduplicateSuggestions(
  suggestions: AutocompleteSuggestion[]
): AutocompleteSuggestion[] {
  const seen = new Set<string>();
  return suggestions.filter((s) => {
    const key = s.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rankSuggestion(suggestion: AutocompleteSuggestion): number {
  const typeBoost: Record<AutocompleteSuggestion["type"], number> = {
    recent: 10, venue: 5, city: 3, category: 2,
  };
  return suggestion.score + typeBoost[suggestion.type];
}

const SUGGESTIONS: AutocompleteSuggestion[] = [
  { text: "Coffee Hub NYC",       type: "venue",    score: 8 },
  { text: "Coworking Space",      type: "category", score: 6 },
  { text: "New York City",        type: "city",     score: 5 },
  { text: "Coffee Corner",        type: "recent",   score: 9 },
  { text: "NYC Workspace",        type: "venue",    score: 7 },
];

describe("Search autocomplete", () => {
  it("filterSuggestions: matches query substring", () => {
    const results = filterSuggestions(SUGGESTIONS, "coffee");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((s) => s.text.toLowerCase().includes("coffee"))).toBe(true);
  });

  it("filterSuggestions: empty query → empty", () => {
    expect(filterSuggestions(SUGGESTIONS, "")).toHaveLength(0);
  });

  it("filterSuggestions: respects limit", () => {
    expect(filterSuggestions(SUGGESTIONS, "c", 2)).toHaveLength(2);
  });

  it("filterSuggestions: sorted by score descending", () => {
    const results = filterSuggestions(SUGGESTIONS, "c");
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
  });

  it("deduplicateSuggestions: removes exact duplicates", () => {
    const duped = [
      ...SUGGESTIONS,
      { text: "Coffee Hub NYC", type: "venue" as const, score: 3 },
    ];
    const deduped = deduplicateSuggestions(duped);
    const texts = deduped.map((s) => s.text.toLowerCase());
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("rankSuggestion: recent type gets highest boost", () => {
    const recent: AutocompleteSuggestion = { text: "x", type: "recent", score: 1 };
    const venue: AutocompleteSuggestion = { text: "y", type: "venue",  score: 1 };
    expect(rankSuggestion(recent)).toBeGreaterThan(rankSuggestion(venue));
  });
});
