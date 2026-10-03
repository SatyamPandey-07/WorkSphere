import {
  compressContext,
  extractIntentParameters,
  retrieveRelevantContext,
  estimateTokens,
} from "@/lib/context-compression/contextCompressor";
import { deduplicateContext, deduplicateVenueResults } from "@/lib/context-compression/contextDeduplicator";

// Mock semantic cache embeddings to return deterministic vectors based on input
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

describe("AI Context Compression & Intent Parameter Preservation (#1724)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("1. extractIntentParameters", () => {
    it("extracts workType, categories, amenities, location and radius from user messages", () => {
      const messages = [
        {
          role: "user",
          content: "I need a quiet cafe or coworking space in Downtown Seattle within 3 km for zoom calls with fast wifi, power outlets, and ergonomic chairs. Budget is under $25.",
        },
      ];

      const params = extractIntentParameters(messages);
      expect(params.workType).toBe("calls");
      expect(params.category).toContain("cafe");
      expect(params.category).toContain("coworking");
      expect(params.amenities).toContain("wifi");
      expect(params.amenities).toContain("outlets");
      expect(params.amenities).toContain("quiet");
      expect(params.amenities).toContain("ergonomic");
      expect(params.location).toBe("Downtown Seattle");
      expect(params.radius).toBe(3000);
      expect(params.constraints?.length).toBeGreaterThan(0);
    });

    it("extracts focus workType and library category for deep study sessions", () => {
      const messages = [
        {
          role: "user",
          content: "Looking for a public library for deep work and focus study with silent rooms and 24/7 access.",
        },
      ];

      const params = extractIntentParameters(messages);
      expect(params.workType).toBe("focus");
      expect(params.category).toContain("library");
      expect(params.amenities).toContain("quiet");
      expect(params.amenities).toContain("24/7");
    });

    it("extracts confirmed user decisions and bookings", () => {
      const messages = [
        { role: "user", content: "I booked a workstation at WeWork downtown for tomorrow." },
      ];

      const params = extractIntentParameters(messages);
      expect(params.decisions).toBeDefined();
      expect(params.decisions?.some((d) => d.includes("booked"))).toBe(true);
    });
  });

  describe("2. compressContext", () => {
    it("preserves short conversations without unnecessary compression overhead", async () => {
      const messages = [
        { role: "user", content: "Hi there!" },
        { role: "assistant", content: "Hello! How can I help you find a workspace today?" },
      ];

      const result = await compressContext(messages, "user_short_conv");
      expect(result.compressed).toEqual(messages);
      expect(result.savedTokens).toBe(0);
      expect(result.reductionPercentage).toBe(0);
    });

    it("summarizes older turns while preserving recent turns verbatim and key intent parameters", async () => {
      const olderMessages = [
        {
          role: "user",
          content: "I need a workspace in Capitol Hill Seattle within 2 km for team collaboration. We require reliable wifi, phone booth for calls, and plenty of power outlets.",
        },
        {
          role: "assistant",
          content: "I recommend Pioneer Collective and Ada's Technical Books. Pioneer Collective has dedicated meeting pods and 500 Mbps fiber internet.",
        },
        {
          role: "user",
          content: "Ada's looks great. Can you check if they have ergonomic chairs and coffee?",
        },
        {
          role: "assistant",
          content: "Yes, Ada's has full specialty cafe service and ergonomic seating in their coworking loft.",
        },
      ];

      const recentMessages = [
        { role: "user", content: "Great, what are their opening hours today?" },
        { role: "assistant", content: "Ada's is open until 7:00 PM today." },
        { role: "user", content: "Can I book a seat there for 2 hours?" },
      ];

      const allMessages = [...olderMessages, ...recentMessages];
      const result = await compressContext(allMessages, "user_long_conv", {
        recentTurnsToKeep: 3,
        thresholdTokens: 100,
      });

      // Recent messages must be preserved verbatim at the end
      expect(result.compressed.length).toBe(1 + recentMessages.length);
      const trailing = result.compressed.slice(1);
      expect(trailing).toEqual(recentMessages);

      // System summary chunk must be present
      const summaryMsg = result.compressed[0];
      expect(summaryMsg.role).toBe("system");
      expect(summaryMsg.content).toContain("PRIOR CONTEXT & PARAMETERS");

      // Key parameters must be preserved in summary
      expect(result.extractedParameters.category?.length).toBeGreaterThan(0);
      expect(result.extractedParameters.amenities).toContain("wifi");
      expect(result.extractedParameters.amenities).toContain("outlets");
      expect(result.extractedParameters.location).toContain("Seattle");

      // Verify token reduction >= 50% on older turns
      const olderTokens = olderMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
      const summaryTokens = estimateTokens(summaryMsg.content);
      expect(summaryTokens).toBeLessThan(olderTokens * 0.5);

      // Verify overall prompt token savings
      expect(result.savedTokens).toBeGreaterThan(0);
      expect(result.reductionPercentage).toBeGreaterThanOrEqual(30);
    });

    it("indexes compressed context in HNSW for future semantic retrieval", async () => {
      const userId = `hnsw_user_${Date.now()}`;
      const messages = Array.from({ length: 8 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i}: Inquiring about ergonomic workstations and quiet phone booths in downtown Seattle with high speed fiber internet.`,
      }));

      await compressContext(messages, userId, {
        recentTurnsToKeep: 2,
        thresholdTokens: 50,
      });

      const retrieved = await retrieveRelevantContext(userId, "phone booths fiber internet", 3);
      expect(retrieved.length).toBeGreaterThan(0);
      expect(retrieved[0].userId).toBe(userId);
    });
  });

  describe("3. End-to-End LLM Prompt Token Reduction Benchmark (Deliverable 4)", () => {
    it("achieves 50%+ reduction on average LLM prompt token counts for 15-turn conversation", async () => {
      const turns = [
        { role: "user", content: "Hi, I am looking for a quiet workspace or cafe to work from in downtown Seattle within 3 km." },
        { role: "assistant", content: "Here are the top places near downtown Seattle for remote work:\n1. **Anchorhead Coffee** — Cafe, 9.1/10 (1600 7th Ave). Fast fiber Wi-Fi, plenty of power outlets along the bar, craft espresso.\n2. **Pioneer Collective** — Coworking, 8.9/10 (100 S King St). Ergonomic Herman Miller seating, phone booths, ultra-quiet focus zones.\n3. **Seattle Central Library** — Library, 8.5/10 (1000 4th Ave). Floors 7-10 offer silent study desks with panoramic views and power." },
        { role: "user", content: "Tell me more about Anchorhead Coffee. Does it get too loud for audio calls around 2 PM?" },
        { role: "assistant", content: "Anchorhead Coffee has moderate ambient noise with background music playing. While fine for short casual calls with noise-canceling headphones, it does not have private booths for confidential client meetings or video presentations." },
        { role: "user", content: "Understood. Pioneer Collective sounds great. What are their rates for a day pass, and do they have private phone booths?" },
        { role: "assistant", content: "Pioneer Collective offers day passes for $30/day. This includes access to soundproof private phone booths on a first-come basis, high-speed fiber internet, and complimentary local coffee and tea." },
        { role: "user", content: "Can I reserve a dedicated phone booth in advance at Pioneer Collective, or is it strictly walk-in?" },
        { role: "assistant", content: "Single-person phone booths are walk-in (fair use up to 60 minutes), while multi-person conference rooms can be booked in advance through their member portal or front desk." },
        { role: "user", content: "That works. Are there free alternatives nearby if I just need silent focus and laptop power for 3 hours?" },
        { role: "assistant", content: "The Seattle Central Library is free to the public, features dedicated quiet study carrels on Level 9, open charging sockets at every desk, and is only a 10-minute walk from Pioneer Square." },
        { role: "user", content: "What are the library hours today, and do they allow bringing a covered coffee mug inside?" },
        { role: "assistant", content: "Seattle Central Library is open today from 10:00 AM to 6:00 PM. Covered beverages like travel mugs are permitted throughout the study areas, but food is restricted to the ground floor atrium." },
        { role: "user", content: "Perfect. What are the parking options or nearest transit station?" },
        { role: "assistant", content: "University Street Station is just one block away on 3rd Ave. Pioneer Square light rail station is 3 blocks away. There is also an underground parking garage at 1000 4th Ave with entrance on Spring St." },
        { role: "user", content: "Awesome. Can you summarize the best plan for my afternoon: phone call at 2pm followed by quiet laptop work?" },
      ];

      const rawTokens = turns.reduce((sum, m) => sum + estimateTokens(m.content), 0);

      // Step 1: Deduplicate history
      const { deduplicated } = await deduplicateContext(turns, "benchmark_user");

      // Step 2: Compress older turns
      const result = await compressContext(deduplicated, "benchmark_user", {
        recentTurnsToKeep: 4,
        thresholdTokens: 200,
      });

      const compressedTokens = result.compressedTokens;
      const totalReduction = ((rawTokens - compressedTokens) / rawTokens) * 100;

      // Deliverable 4: Reduce average LLM prompt token counts by 50%+
      expect(totalReduction).toBeGreaterThanOrEqual(50);
      expect(result.compressed.length).toBeLessThan(turns.length);
    });

    it("deduplicates repetitive venue query results before LLM invocation, saving significant token overhead", () => {
      const repetitiveVenues = [
        { id: "v1", name: "WeWork Seattle", score: 9.2, lat: 47.606, lng: -122.332, address: "1000 2nd Ave" },
        { id: "v1", name: "WeWork Seattle", score: 9.2, lat: 47.606, lng: -122.332, address: "1000 2nd Ave" }, // exact dupe
        { id: "osm_1", name: "WeWork", score: 8.9, lat: 47.6061, lng: -122.3321, address: "1000 2nd Ave" }, // geographic dupe
        { id: "v2", name: "Central Library", score: 8.5, lat: 47.607, lng: -122.333, address: "1000 4th Ave" },
        { id: "v2", name: "Central Library", score: 8.5, lat: 47.607, lng: -122.333, address: "1000 4th Ave" }, // exact dupe
        { id: "v3", name: "Anchorhead Coffee", score: 8.1, lat: 47.613, lng: -122.334, address: "1600 7th Ave" },
      ];

      const dedupResult = deduplicateVenueResults(repetitiveVenues);
      expect(dedupResult.deduplicated.length).toBe(3);
      expect(dedupResult.removedCount).toBe(3);
      expect(dedupResult.savingsTokens).toBeGreaterThanOrEqual(150);
    });
  });
});
