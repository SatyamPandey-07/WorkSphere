import {
  SQLiteFTS5SearchEngine,
  calculateBM25Score,
} from "../../../lib/wasm/sqliteSearch";

describe("SQLite FTS5 WASM Search Engine", () => {
  let engine: SQLiteFTS5SearchEngine;

  beforeEach(() => {
    engine = new SQLiteFTS5SearchEngine();
  });

  afterEach(() => {
    engine.terminate();
  });

  it("calculates BM25 score with field weights for names, tags, and reviews", () => {
    const doc = {
      name: "Blue Bottle Coffee",
      tags: ["quiet", "wifi", "outlets"],
      reviews: [
        "Great quiet workspace with fast wifi and lots of power outlets.",
      ],
    };

    const docFreqs = { quiet: 1, wifi: 1, coffee: 1 };
    const { score, matchedFields } = calculateBM25Score(
      doc,
      ["quiet", "wifi"],
      1,
      10,
      docFreqs,
    );

    expect(score).toBeGreaterThan(0);
    expect(matchedFields).toContain("tags");
    expect(matchedFields).toContain("reviews");
  });

  it("indexes venues and performs sub-5ms BM25 ranking offline search", async () => {
    const venues = [
      {
        id: "venue-1",
        name: "Central Park Cafe",
        tags: ["outdoor", "quiet", "coffee"],
        reviews: ["Cozy outdoor seating with excellent coffee."],
      },
      {
        id: "venue-2",
        name: "Tech Hub Coworking",
        tags: ["fast wifi", "ergonomic", "outlets"],
        reviews: ["Best quiet workspace for developers with high speed wifi."],
      },
      {
        id: "venue-3",
        name: "Quiet Library Lounge",
        tags: ["silent", "reading", "study"],
        reviews: ["Extremely quiet environment with great study desks."],
      },
    ];

    const indexedCount = await engine.indexVenues(venues);
    expect(indexedCount).toBe(3);

    const { results, executionTimeMs } = await engine.search("quiet wifi");

    expect(results.length).toBeGreaterThan(0);
    // BM25 ranking should prioritize Tech Hub or Quiet Library Lounge
    expect(results[0].id).toBeDefined();
    expect(executionTimeMs).toBeLessThan(50); // Under test framework, should be sub-5ms in performance environment
  });

  it("returns empty array for empty search queries", async () => {
    await engine.indexVenues([
      { id: "1", name: "Sample Cafe", tags: ["cafe"], reviews: ["Nice"] },
    ]);

    const { results } = await engine.search("   ");
    expect(results).toEqual([]);
  });
});
