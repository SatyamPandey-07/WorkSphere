import {
  deduplicateVenueResults,
  deduplicateContext,
  ContextDeduplicator,
  cleanVenueName,
  haversineDistanceKm,
  estimateTokens,
  type VenueLike,
} from "@/lib/context-compression/contextDeduplicator";

// Mock semantic cache embeddings to prevent Cohere network calls in tests
jest.mock("@/lib/cache/semanticCache", () => ({
  generateEmbedding: jest.fn().mockImplementation(async (text: string) => {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }
    const base = Math.abs(hash) % 1000;
    return Array.from({ length: 1024 }, (_, i) => 0.001 * ((i + base) % 50));
  }),
}));

describe("contextDeduplicator — AI Context Deduplication & Venue De-duping (#1724)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("1. Venue Query Results Deduplication (deduplicateVenueResults)", () => {
    it("handles empty or null venue arrays cleanly", () => {
      const result = deduplicateVenueResults([]);
      expect(result.deduplicated).toEqual([]);
      expect(result.removedCount).toBe(0);
      expect(result.savingsTokens).toBe(0);
    });

    it("deduplicates venues sharing the same ID", () => {
      const venues: VenueLike[] = [
        { id: "v1", name: "WeWork Seattle", lat: 47.6062, lng: -122.3321, score: 9 },
        { id: "v1", name: "WeWork Seattle (Duplicate)", lat: 47.6062, lng: -122.3321, score: 9 },
        { id: "v2", name: "Seattle Central Library", lat: 47.6067, lng: -122.3325, score: 8 },
      ];

      const result = deduplicateVenueResults(venues);
      expect(result.deduplicated.length).toBe(2);
      expect(result.removedCount).toBe(1);
      expect(result.duplicateIds).toContain("v1");
      expect(result.savingsTokens).toBeGreaterThan(0);
      expect(result.deduplicated.map((v) => v.id)).toEqual(["v1", "v2"]);
    });

    it("deduplicates venues with matching clean names and close geographical proximity (< 100m)", () => {
      // Coordinates approx 30 meters apart (0.0003 deg lat ~ 33 meters)
      const venues: VenueLike[] = [
        { id: "osm_101", name: "Anchorhead Coffee", lat: 47.6135, lng: -122.3345, address: "1600 7th Ave" },
        { id: "ws_502", name: "The Anchorhead Coffee Cafe", lat: 47.6137, lng: -122.3346, address: "1600 7th Ave" },
        { id: "osm_102", name: "Storyville Coffee Pike Place", lat: 47.6092, lng: -122.3415 },
      ];

      const result = deduplicateVenueResults(venues);
      expect(result.deduplicated.length).toBe(2);
      expect(result.removedCount).toBe(1);
      expect(result.duplicateIds).toContain("ws_502");
      expect(result.deduplicated[0].name).toBe("Anchorhead Coffee");
      expect(result.deduplicated[1].name).toBe("Storyville Coffee Pike Place");
    });

    it("does not deduplicate venues with similar names located far apart (> 100m)", () => {
      // Two Starbucks branches 2 km apart
      const venues: VenueLike[] = [
        { id: "sb_1", name: "Starbucks Downtown", lat: 47.6062, lng: -122.3321 },
        { id: "sb_2", name: "Starbucks Capitol Hill", lat: 47.6200, lng: -122.3200 },
      ];

      const result = deduplicateVenueResults(venues);
      expect(result.deduplicated.length).toBe(2);
      expect(result.removedCount).toBe(0);
    });

    it("deduplicates venues matching address when coordinates are missing", () => {
      const venues: VenueLike[] = [
        { id: "lib_1", name: "Downtown Public Library", address: "1000 4th Ave, Seattle, WA" },
        { id: "lib_2", name: "Central Library Downtown", address: "1000 4th Ave, Seattle, WA" },
      ];

      const result = deduplicateVenueResults(venues);
      expect(result.deduplicated.length).toBe(1);
      expect(result.removedCount).toBe(1);
    });

    it("filters out venues already recommended in past conversation history when option is enabled", () => {
      const existingHistory = [
        { role: "user", content: "Can you recommend a quiet cafe near downtown?" },
        {
          role: "assistant",
          content: "Here are the best places:\n1. **Anchorhead Coffee** — Fast Wi-Fi and quiet atmosphere.\n2. **Uptown Espresso**.",
        },
      ];

      const venues: VenueLike[] = [
        { id: "v1", name: "Anchorhead Coffee", lat: 47.6135, lng: -122.3345 },
        { id: "v2", name: "Monorail Espresso", lat: 47.6105, lng: -122.3355 },
      ];

      const result = deduplicateVenueResults(venues, {
        existingHistory,
        excludeAlreadyRecommended: true,
      });

      expect(result.deduplicated.length).toBe(1);
      expect(result.deduplicated[0].name).toBe("Monorail Espresso");
      expect(result.removedCount).toBe(1);
      expect(result.duplicateIds).toContain("v1");
    });
  });

  describe("2. Context History Deduplication (deduplicateContext)", () => {
    it("removes exact duplicate user and assistant messages", async () => {
      const messages = [
        { role: "user", content: "Find quiet cafes with outlets in Seattle" },
        { role: "assistant", content: "Searching for quiet cafes near downtown Seattle..." },
        { role: "user", content: "Find quiet cafes with outlets in Seattle" }, // exact duplicate
        { role: "user", content: "Also need ergonomic chairs" },
      ];

      const { deduplicated, removedCount, savings } = await deduplicateContext(messages, "user_test_1");
      expect(deduplicated.length).toBe(3);
      expect(removedCount).toBe(1);
      expect(savings).toBeGreaterThan(0);
      expect(deduplicated[2].content).toBe("Also need ergonomic chairs");
    });

    it("removes repetitive prompt templates while preserving actual dialogue", async () => {
      const messages = [
        { role: "system", content: "System: You are an AI workspace assistant helping remote workers." },
        { role: "system", content: "System: You are an AI workspace assistant helping remote workers." }, // duplicate prompt
        { role: "user", content: "Where can I work today?" },
      ];

      const { deduplicated, removedCount } = await deduplicateContext(messages, "user_test_2");
      expect(deduplicated.length).toBe(2);
      expect(removedCount).toBe(1);
      expect(deduplicated[1].content).toBe("Where can I work today?");
    });
  });

  describe("3. ContextDeduplicator class and Context Window", () => {
    it("deduplicates across sliding context windows maintaining recent messages", async () => {
      const deduplicator = new ContextDeduplicator();
      const messages = [
        { role: "user", content: "Initial query about Seattle libraries" },
        { role: "user", content: "Initial query about Seattle libraries" }, // older duplicate
        { role: "user", content: "Recent message 1" },
        { role: "assistant", content: "Recent response 1" },
      ];

      const result = await deduplicator.deduplicateContextWindow(messages, 2);
      expect(result.length).toBe(3);
      expect(result[0].content).toBe("Initial query about Seattle libraries");
      expect(result[1].content).toBe("Recent message 1");
      expect(result[2].content).toBe("Recent response 1");
    });

    it("clears internal state and indexes properly", () => {
      const deduplicator = new ContextDeduplicator();
      deduplicator.clear();
      expect(deduplicator).toBeDefined();
    });
  });

  describe("4. Helper Functions", () => {
    it("cleanVenueName normalizes common prefixes, suffixes and whitespace", () => {
      expect(cleanVenueName("The Seattle Public Library - Central Branch")).toBe("seattle public central");
      expect(cleanVenueName("Anchorhead Coffee Cafe")).toBe("anchorhead");
      expect(cleanVenueName("  WeWork   Coworking Space  ")).toBe("wework");
    });

    it("haversineDistanceKm calculates accurate geographical distances", () => {
      // Distance between Space Needle (47.6205, -122.3493) and Pike Place (47.6097, -122.3422) is ~1.3 km
      const dist = haversineDistanceKm(47.6205, -122.3493, 47.6097, -122.3422);
      expect(dist).toBeGreaterThan(1.1);
      expect(dist).toBeLessThan(1.5);
    });

    it("estimateTokens estimates tokens proportionally to text length", () => {
      expect(estimateTokens("Hello world")).toBe(3);
      expect(estimateTokens("")).toBe(0);
    });
  });
});
