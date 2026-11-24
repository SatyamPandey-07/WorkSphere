import {
  DEFAULT_VENUE_AMENITIES,
  VENUE_AMENITIES,
  damerauLevenshteinDistance,
  getAmenitySuggestions,
  getFuzzyAmenitySuggestion,
  levenshteinDistance,
  sanitizeVenueSearchQuery,
} from "@/lib/search/venueSearchSanitizer";

describe("levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance("wifi", "wifi")).toBe(0);
    expect(levenshteinDistance("ergonomic chair", "ERGONOMIC CHAIR")).toBe(0);
  });

  it("calculates single-character insertions correctly", () => {
    expect(levenshteinDistance("wifii", "wifi")).toBe(1);
    expect(levenshteinDistance("outlett", "outlet")).toBe(1);
  });

  it("calculates single-character deletions correctly", () => {
    expect(levenshteinDistance("ergonmic chair", "ergonomic chair")).toBe(1);
    expect(levenshteinDistance("monitr", "monitor")).toBe(1);
  });

  it("calculates substitutions correctly", () => {
    expect(levenshteinDistance("wifo", "wifi")).toBe(1);
  });

  it("calculates adjacent transpositions correctly", () => {
    expect(levenshteinDistance("wiif", "wifi")).toBe(1);
    expect(damerauLevenshteinDistance("stnad", "stand")).toBe(1);
  });

  it("calculates edit distance 2", () => {
    expect(levenshteinDistance("wifiii", "wifi")).toBe(2);
    expect(levenshteinDistance("ergonmc chair", "ergonomic chair")).toBe(2);
  });

  it("returns length when one string is empty", () => {
    expect(levenshteinDistance("", "wifi")).toBe(4);
    expect(levenshteinDistance("outlet", "")).toBe(6);
  });

  it("handles invalid inputs gracefully", () => {
    expect(levenshteinDistance(null as unknown as string, "wifi")).toBe(
      Infinity,
    );
    expect(levenshteinDistance("wifi", undefined as unknown as string)).toBe(
      Infinity,
    );
  });
});

describe("getAmenitySuggestions", () => {
  it('suggests "wifi" for typo "wifii" (edit distance 1)', () => {
    const suggestions = getAmenitySuggestions("wifii");
    expect(suggestions).toContain("wifi");
  });

  it('suggests "ergonomic chair" for typo "ergonmic chair" (edit distance 1)', () => {
    const suggestions = getAmenitySuggestions("ergonmic chair");
    expect(suggestions).toContain("ergonomic chair");
  });

  it('suggests "outlet" for typo "outlett" (edit distance 1)', () => {
    const suggestions = getAmenitySuggestions("outlett");
    expect(suggestions).toContain("outlet");
  });

  it("suggests amenities within edit distance 2", () => {
    const suggestions = getAmenitySuggestions("stnding desk");
    expect(suggestions).toContain("standing desk");
  });

  it("suggests multi-word candidate when query matches misspelled primary token", () => {
    const suggestions = getAmenitySuggestions("ergonmic");
    expect(suggestions).toContain("ergonomic chair");
  });

  it("suggests candidate when multi-word query contains misspelled amenity token", () => {
    const suggestions = getAmenitySuggestions("fast wifii");
    expect(suggestions).toContain("wifi");
  });

  it("returns empty array when query is an exact match", () => {
    expect(getAmenitySuggestions("wifi")).toEqual([]);
    expect(getAmenitySuggestions("outlet")).toEqual([]);
    expect(getAmenitySuggestions("ergonomic chair")).toEqual([]);
  });

  it("returns empty array for very short queries or whitespace", () => {
    expect(getAmenitySuggestions("")).toEqual([]);
    expect(getAmenitySuggestions(" ")).toEqual([]);
    expect(getAmenitySuggestions("w")).toEqual([]);
  });

  it("returns empty array when typo exceeds maximum edit distance", () => {
    expect(getAmenitySuggestions("completelyunrelatedamenity")).toEqual([]);
  });

  it("supports custom candidates list and custom maxDistance", () => {
    const custom = ["swimming pool", "gym", "sauna"];
    expect(getAmenitySuggestions("swiming pool", custom, 1)).toEqual([
      "swimming pool",
    ]);
    expect(getAmenitySuggestions("swimming pool", custom, 1)).toEqual([]);
    expect(getAmenitySuggestions("gimm", custom, 2)).toEqual(["gym"]);
  });

  it("sorts suggestions by closest edit distance first", () => {
    const candidates = ["power outlet", "outlet"];
    const suggestions = getAmenitySuggestions("outlett", candidates);
    expect(suggestions[0]).toBe("outlet");
  });

  it("limits number of returned suggestions to limit parameter", () => {
    const candidates = ["wifi", "wifo", "wife", "wifa"];
    const suggestions = getAmenitySuggestions("wifii", candidates, 2, 2);
    expect(suggestions.length).toBeLessThanOrEqual(2);
  });

  it("exports VENUE_AMENITIES alias matching DEFAULT_VENUE_AMENITIES", () => {
    expect(VENUE_AMENITIES).toBe(DEFAULT_VENUE_AMENITIES);
    expect(VENUE_AMENITIES).toContain("wifi");
    expect(VENUE_AMENITIES).toContain("ergonomic chair");
    expect(VENUE_AMENITIES).toContain("outlet");
  });
});

describe("getFuzzyAmenitySuggestion", () => {
  it("returns top suggestion string or null", () => {
    expect(getFuzzyAmenitySuggestion("wifii")).toBe("wifi");
    expect(getFuzzyAmenitySuggestion("outlett")).toBe("outlet");
    expect(
      getFuzzyAmenitySuggestion("perfectlyexactxyznonexistent"),
    ).toBeNull();
  });
});

describe("sanitizeVenueSearchQuery", () => {
  it("removes control characters and trims query", () => {
    expect(sanitizeVenueSearchQuery("  wifi\0\x1b  ")).toBe("wifi");
  });

  it("truncates queries exceeding 100 characters", () => {
    const long = "a".repeat(150);
    expect(sanitizeVenueSearchQuery(long)).toHaveLength(100);
  });

  it("returns empty string for non-string input", () => {
    expect(sanitizeVenueSearchQuery(null)).toBe("");
    expect(sanitizeVenueSearchQuery(undefined)).toBe("");
  });
});
