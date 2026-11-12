import { renderHook, act } from "@testing-library/react";
import {
  levenshteinDistance,
  levenshteinSimilarity,
  generateTrigrams,
  trigramSimilarity,
  scoreVenue,
  searchVenues,
  SearchableVenue,
} from "@/workers/searchWorker";
import { useSearchWorker } from "@/hooks/useSearchWorker";

const sampleVenues: SearchableVenue[] = [
  { id: "1", name: "Blue Bottle Coffee", category: "Cafe", city: "San Francisco", tags: ["quiet", "wifi"] },
  { id: "2", name: "Sightglass Coffee Roasters", category: "Cafe", city: "San Francisco", tags: ["outlets"] },
  { id: "3", name: "WeWork Financial District", category: "Coworking", city: "San Francisco", tags: ["booths"] },
  { id: "4", name: "Artisan Lounge", category: "Lounge", city: "Oakland", tags: ["cocktails", "patio"] },
];

describe("searchWorker Fuzzy Search Engine", () => {
  describe("Levenshtein Distance Calculations", () => {
    it("returns 0 for identical strings", () => {
      expect(levenshteinDistance("coffee", "coffee")).toBe(0);
      expect(levenshteinSimilarity("coffee", "coffee")).toBe(1.0);
    });

    it("calculates edit distance accurately for typos", () => {
      // 1 deletion: "coffe" vs "coffee"
      expect(levenshteinDistance("coffe", "coffee")).toBe(1);
      // 1 substitution: "coffee" vs "coffea"
      expect(levenshteinDistance("coffee", "coffea")).toBe(1);
    });

    it("handles empty strings", () => {
      expect(levenshteinDistance("", "test")).toBe(4);
      expect(levenshteinDistance("test", "")).toBe(4);
      expect(levenshteinSimilarity("", "")).toBe(1.0);
    });
  });

  describe("Trigram Matching", () => {
    it("extracts 3-character n-grams from text", () => {
      const trigrams = generateTrigrams("cafe");
      expect(trigrams.size).toBeGreaterThan(0);
      expect(trigrams.has("  c")).toBe(true);
      expect(trigrams.has("caf")).toBe(true);
    });

    it("computes high trigram similarity for closely matching terms", () => {
      const sim = trigramSimilarity("roasters", "roaster");
      expect(sim).toBeGreaterThan(0.7);

      const diffSim = trigramSimilarity("coffee", "library");
      expect(diffSim).toBeLessThan(0.2);
    });
  });

  describe("searchVenues & Scoring", () => {
    it("ranks exact and prefix matches highest", () => {
      const results = searchVenues(sampleVenues, "Blue Bottle");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe("1");
      expect(results[0].score).toBe(1.0);
      expect(results[0].matchType).toBe("exact");
    });

    it("matches venues with typos using fuzzy Levenshtein & Trigrams", () => {
      // Typo query: "Sightglas Coffe"
      const results = searchVenues(sampleVenues, "Sightglas Coffe");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe("2");
      expect(results[0].score).toBeGreaterThan(0.4);
    });

    it("filters and matches by category or tags", () => {
      const results = searchVenues(sampleVenues, "Coworking");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toContain("WeWork");
    });
  });

  describe("useSearchWorker Hook", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    it("debounces rapid search input updates", () => {
      const { result } = renderHook(() =>
        useSearchWorker({
          venues: sampleVenues,
          debounceMs: 150,
        })
      );

      act(() => {
        result.current.setQuery("B");
      });
      act(() => {
        result.current.setQuery("Bl");
      });
      act(() => {
        result.current.setQuery("Blue");
      });

      // Before timer finishes
      expect(result.current.query).toBe("Blue");

      // Advance past debounce delay
      act(() => {
        jest.advanceTimersByTime(150);
      });

      expect(result.current.results.length).toBeGreaterThan(0);
      expect(result.current.results[0].name).toContain("Blue Bottle");
    });

    it("supports searchNow for immediate non-debounced execution", () => {
      const { result } = renderHook(() =>
        useSearchWorker({
          venues: sampleVenues,
          debounceMs: 500,
        })
      );

      act(() => {
        result.current.searchNow("WeWork");
      });

      expect(result.current.results.length).toBeGreaterThan(0);
      expect(result.current.results[0].name).toContain("WeWork");
    });

    it("terminates worker cleanly on terminate call or unmount", () => {
      const { result, unmount } = renderHook(() =>
        useSearchWorker({
          venues: sampleVenues,
        })
      );

      expect(() => {
        act(() => {
          result.current.terminate();
        });
      }).not.toThrow();

      expect(() => unmount()).not.toThrow();
    });
  });
});
