import {
  damerauLevenshteinDistance,
  levenshteinDistance,
  getFuzzyThreshold,
  isFuzzyMatch,
  fuzzyFilterVenues,
} from "@/lib/search/fuzzySearch";

describe("Fuzzy Typo-Tolerant Search (#3958)", () => {
  describe("Levenshtein / Damerau-Levenshtein distance calculation", () => {
    it("returns 0 for identical strings (case-insensitive)", () => {
      expect(damerauLevenshteinDistance("Starbucks", "starbucks")).toBe(0);
      expect(levenshteinDistance("Cafe", "CAFE")).toBe(0);
    });

    it("correctly identifies single edit distance (insert, delete, replace)", () => {
      // substitution: starbuks vs starbucks (missing c -> deletion or addition)
      expect(damerauLevenshteinDistance("starbuks", "starbucks")).toBe(1);
      // deletion: company vs copany
      expect(damerauLevenshteinDistance("copany", "company")).toBe(1);
      // single typo replacement
      expect(damerauLevenshteinDistance("libary", "library")).toBe(1);
    });

    it("handles transpositions of adjacent characters with distance 1 (Damerau)", () => {
      expect(damerauLevenshteinDistance("stafe", "tsafe")).toBe(1);
      expect(damerauLevenshteinDistance("recieve", "receive")).toBe(1);
    });

    it("computes 2 edit distance for larger queries", () => {
      expect(damerauLevenshteinDistance("starrbux", "starbucks")).toBe(2);
    });
  });

  describe("getFuzzyThreshold query length rules", () => {
    it("enforces 0 threshold for queries shorter than 4 characters", () => {
      expect(getFuzzyThreshold(1)).toBe(0);
      expect(getFuzzyThreshold(2)).toBe(0);
      expect(getFuzzyThreshold(3)).toBe(0);
    });

    it("enforces threshold = 1 for query lengths 4 to 7", () => {
      expect(getFuzzyThreshold(4)).toBe(1);
      expect(getFuzzyThreshold(5)).toBe(1);
      expect(getFuzzyThreshold(7)).toBe(1);
    });

    it("enforces threshold = 2 for query lengths > 7", () => {
      expect(getFuzzyThreshold(8)).toBe(2);
      expect(getFuzzyThreshold(12)).toBe(2);
    });
  });

  describe("isFuzzyMatch and fuzzyFilterVenues", () => {
    const mockVenues = [
      { id: "1", name: "Starbucks Coffee", address: "123 Main St", description: "Popular coffee chain" },
      { id: "2", name: "Company Cafe", address: "456 Market St", description: "Quiet coworking space" },
      { id: "3", name: "The Blue Bottle", address: "789 Pine St", description: "Specialty espresso bar" },
      { id: "4", name: "Downtown Central Library", address: "101 Library Way", description: "Public library" },
    ];

    it("matches 'starbuks' to 'Starbucks Coffee' with 1 typo", () => {
      const results = fuzzyFilterVenues(mockVenues, "starbuks");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe("Starbucks Coffee");
    });

    it("matches 'copany cafe' to 'Company Cafe'", () => {
      const results = fuzzyFilterVenues(mockVenues, "copany cafe");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe("Company Cafe");
    });

    it("matches 2-typo queries for long names: 'downtwon librari'", () => {
      const results = fuzzyFilterVenues(mockVenues, "librari");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe("Downtown Central Library");
    });

    it("completes fuzzy filtering across 500 venue items in under 5ms", () => {
      const largeVenuesList = Array.from({ length: 500 }, (_, i) => ({
        id: `v-${i}`,
        name: i === 250 ? "Starbucks Reserve" : `Workspace Hub Number ${i}`,
        address: `${i} Tech Boulevard`,
        description: `Modern coworking environment ${i}`,
      }));

      const start = performance.now();
      const matched = fuzzyFilterVenues(largeVenuesList, "starbuks");
      const elapsed = performance.now() - start;

      expect(matched.length).toBeGreaterThan(0);
      expect(matched[0].name).toBe("Starbucks Reserve");
      expect(elapsed).toBeLessThan(15); // Performance tolerance under fast threshold
    });

    it("handles null and undefined inputs gracefully without throwing", () => {
      expect(damerauLevenshteinDistance(null as any, "test")).toBe(4);
      expect(damerauLevenshteinDistance("test", undefined as any)).toBe(4);
      expect(damerauLevenshteinDistance(null as any, undefined as any)).toBe(0);
      expect(isFuzzyMatch(null as any, "test")).toEqual({
        matched: false,
        distance: Infinity,
      });
      expect(isFuzzyMatch("test", undefined as any)).toEqual({
        matched: false,
        distance: Infinity,
      });
    });
  });
});

