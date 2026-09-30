/**
 * Tests for venue booking search intent classification.
 */

type SearchIntentType = "immediate" | "planning" | "browsing" | "comparison" | "research";

interface SearchIntent {
  query: string;
  dateFilter?: string;
  priceFilter?: boolean;
  locationFilter?: boolean;
  amenityFilter?: boolean;
  previousSearches: number;
  sessionDurationMs: number;
}

function classifySearchIntent(intent: SearchIntent): SearchIntentType {
  const { query, dateFilter, priceFilter, sessionDurationMs, previousSearches } = intent;

  if (dateFilter && (query.includes("today") || query.includes("now") || query.includes("tonight"))) {
    return "immediate";
  }

  if (dateFilter && previousSearches >= 3 && sessionDurationMs < 300_000) {
    return "planning";
  }

  if (priceFilter && intent.amenityFilter) {
    return "comparison";
  }

  if (query.includes("what is") || query.includes("how") || query.includes("guide")) {
    return "research";
  }

  return "browsing";
}

function intentConversionProbability(intent: SearchIntentType): number {
  const probabilities: Record<SearchIntentType, number> = {
    immediate: 0.45, planning: 0.35, comparison: 0.30, browsing: 0.10, research: 0.05,
  };
  return probabilities[intent];
}

function suggestNextAction(intent: SearchIntentType): string {
  const actions: Record<SearchIntentType, string> = {
    immediate:  "Show available slots for today",
    planning:   "Show weekly availability calendar",
    comparison: "Show side-by-side venue comparison",
    browsing:   "Show featured venues",
    research:   "Show venue guide and FAQ",
  };
  return actions[intent];
}

describe("Venue booking search intent classification", () => {
  it("classifySearchIntent: 'today' with date filter → immediate", () => {
    const intent: SearchIntent = { query: "cowork today", dateFilter: "2026-10-01", priceFilter: false, locationFilter: true, amenityFilter: false, previousSearches: 0, sessionDurationMs: 30_000 };
    expect(classifySearchIntent(intent)).toBe("immediate");
  });

  it("classifySearchIntent: 3+ searches with date filter → planning", () => {
    const intent: SearchIntent = { query: "meeting room next week", dateFilter: "2026-10-08", priceFilter: false, locationFilter: false, amenityFilter: false, previousSearches: 4, sessionDurationMs: 120_000 };
    expect(classifySearchIntent(intent)).toBe("planning");
  });

  it("classifySearchIntent: price + amenity filters → comparison", () => {
    const intent: SearchIntent = { query: "coworking space", priceFilter: true, locationFilter: false, amenityFilter: true, previousSearches: 2, sessionDurationMs: 200_000 };
    expect(classifySearchIntent(intent)).toBe("comparison");
  });

  it("classifySearchIntent: 'what is coworking' → research", () => {
    const intent: SearchIntent = { query: "what is coworking space", priceFilter: false, locationFilter: false, amenityFilter: false, previousSearches: 0, sessionDurationMs: 60_000 };
    expect(classifySearchIntent(intent)).toBe("research");
  });

  it("intentConversionProbability: immediate highest (0.45)", () => {
    expect(intentConversionProbability("immediate")).toBe(0.45);
    expect(intentConversionProbability("research")).toBe(0.05);
  });

  it("suggestNextAction: returns action string for each intent", () => {
    expect(suggestNextAction("immediate")).toContain("today");
    expect(suggestNextAction("comparison")).toContain("comparison");
  });
});
