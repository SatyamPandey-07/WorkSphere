/**
 * Tests for AI-assisted venue tag suggestion and confidence scoring.
 */

interface TagSuggestion {
  tag: string;
  confidence: number; // 0-1
  source: "ai" | "user" | "admin";
}

function filterHighConfidenceTags(
  suggestions: TagSuggestion[],
  threshold = 0.8
): TagSuggestion[] {
  return suggestions.filter((s) => s.confidence >= threshold);
}

function topTags(suggestions: TagSuggestion[], limit = 5): TagSuggestion[] {
  return [...suggestions]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

function mergeTagSets(
  existing: string[],
  suggestions: TagSuggestion[],
  threshold = 0.8
): string[] {
  const newTags = filterHighConfidenceTags(suggestions, threshold)
    .map((s) => s.tag)
    .filter((t) => !existing.includes(t));
  return [...existing, ...newTags];
}

function conflictingTags(suggested: TagSuggestion[], blocklist: string[]): TagSuggestion[] {
  return suggested.filter((s) => blocklist.includes(s.tag));
}

const SUGGESTIONS: TagSuggestion[] = [
  { tag: "wifi",           confidence: 0.95, source: "ai"   },
  { tag: "quiet",          confidence: 0.88, source: "ai"   },
  { tag: "coffee",         confidence: 0.75, source: "user" },
  { tag: "co-working",     confidence: 0.92, source: "ai"   },
  { tag: "natural-light",  confidence: 0.60, source: "ai"   },
];

describe("Venue AI tagging", () => {
  it("filterHighConfidenceTags: above 0.8 threshold", () => {
    const filtered = filterHighConfidenceTags(SUGGESTIONS);
    expect(filtered.every((s) => s.confidence >= 0.8)).toBe(true);
    expect(filtered.length).toBe(3);
  });

  it("filterHighConfidenceTags: custom threshold 0.9", () => {
    expect(filterHighConfidenceTags(SUGGESTIONS, 0.9)).toHaveLength(2);
  });

  it("topTags: sorted by confidence", () => {
    const top = topTags(SUGGESTIONS, 3);
    expect(top[0].confidence).toBeGreaterThanOrEqual(top[1].confidence);
  });

  it("topTags: limited to specified count", () => {
    expect(topTags(SUGGESTIONS, 2)).toHaveLength(2);
  });

  it("mergeTagSets: adds new high-confidence tags", () => {
    const merged = mergeTagSets(["coffee"], SUGGESTIONS);
    expect(merged).toContain("wifi");
    expect(merged).toContain("quiet");
  });

  it("mergeTagSets: no duplicates", () => {
    const merged = mergeTagSets(["wifi"], SUGGESTIONS);
    expect(merged.filter((t) => t === "wifi")).toHaveLength(1);
  });

  it("conflictingTags: finds blocked tags in suggestions", () => {
    const blocked = ["quiet", "coffee"];
    const conflicts = conflictingTags(SUGGESTIONS, blocked);
    expect(conflicts.map((s) => s.tag)).toContain("quiet");
  });

  it("conflictingTags: no conflicts when blocklist is empty", () => {
    expect(conflictingTags(SUGGESTIONS, [])).toHaveLength(0);
  });
});
