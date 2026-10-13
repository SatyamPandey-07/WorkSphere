import {
  computeHybridScores,
  serializeVenuesToScoresBuffer,
  VenueScoringRecord,
} from "@/workers/hybridSearch.worker";

describe("hybridSearch.worker Scoring Engine", () => {
  const sampleVenues: VenueScoringRecord[] = [
    {
      id: "venue-1",
      semanticScore: 0.9,
      proximityScore: 0.1,
      ratingScore: 0.2,
      fullTextScore: 0.3,
    },
    {
      id: "venue-2",
      semanticScore: 0.2,
      proximityScore: 0.95,
      ratingScore: 0.4,
      fullTextScore: 0.2,
    },
    {
      id: "venue-3",
      semanticScore: 0.3,
      proximityScore: 0.3,
      ratingScore: 0.98,
      fullTextScore: 0.4,
    },
    {
      id: "venue-4",
      semanticScore: 0.5,
      proximityScore: 0.5,
      ratingScore: 0.5,
      fullTextScore: 0.95,
    },
  ];

  it("serializes venue records into transferable Float32Array ArrayBuffer with stride 4", () => {
    const { venueIds, scoresBuffer, stride } =
      serializeVenuesToScoresBuffer(sampleVenues);

    expect(venueIds).toEqual(["venue-1", "venue-2", "venue-3", "venue-4"]);
    expect(stride).toBe(4);
    expect(scoresBuffer).toBeInstanceOf(ArrayBuffer);

    const scores = new Float32Array(scoresBuffer);
    expect(scores.length).toBe(16); // 4 venues * 4 features

    // venue-1: [0.9, 0.1, 0.2, 0.3]
    expect(scores[0]).toBeCloseTo(0.9);
    expect(scores[1]).toBeCloseTo(0.1);
    expect(scores[2]).toBeCloseTo(0.2);
    expect(scores[3]).toBeCloseTo(0.3);

    // venue-2: [0.2, 0.95, 0.4, 0.2]
    expect(scores[4]).toBeCloseTo(0.2);
    expect(scores[5]).toBeCloseTo(0.95);
  });

  it("serializes raw venue fields (distanceKm, rating, similarity) into normalized scores", () => {
    const rawVenues = [
      {
        id: "raw-1",
        similarity: 0.85,
        distanceKm: 2.5,
        rating: 4.8,
        score: 0.7,
      },
      {
        id: "raw-2",
        similarity: 0.2,
        distanceKm: 25.0,
        rating: 2.0,
        score: 0.3,
      },
    ];

    const { scoresBuffer } = serializeVenuesToScoresBuffer(rawVenues);
    const scores = new Float32Array(scoresBuffer);

    // raw-1: semantic = 0.85, prox = 1 / (1 + 2.5/5) = 1/1.5 = 0.6667, rating = 4.8/5 = 0.96, text = 0.7
    expect(scores[0]).toBeCloseTo(0.85);
    expect(scores[1]).toBeCloseTo(1 / 1.5);
    expect(scores[2]).toBeCloseTo(0.96);
    expect(scores[3]).toBeCloseTo(0.7);
  });

  it("ranks venues by semantic match when semanticWeight dominates", () => {
    const { venueIds, scoresBuffer, stride } =
      serializeVenuesToScoresBuffer(sampleVenues);
    const scoresArray = new Float32Array(scoresBuffer);

    const result = computeHybridScores(
      venueIds,
      scoresArray,
      {
        semanticWeight: 1.0,
        proximityWeight: 0.0,
        ratingWeight: 0.0,
        fullTextWeight: 0.0,
      },
      stride,
    );

    // venue-1 has highest semanticScore (0.9)
    expect(result.sortedIds[0]).toBe("venue-1");
    expect(result.count).toBe(4);
    expect(result.sortedIndicesBuffer).toBeInstanceOf(ArrayBuffer);
    expect(result.sortedScoresBuffer).toBeInstanceOf(ArrayBuffer);

    const scores = new Float32Array(result.sortedScoresBuffer);
    expect(scores[0]).toBeGreaterThan(scores[1]);
  });

  it("ranks venues by proximity when proximityWeight dominates", () => {
    const { venueIds, scoresBuffer, stride } =
      serializeVenuesToScoresBuffer(sampleVenues);
    const scoresArray = new Float32Array(scoresBuffer);

    const result = computeHybridScores(
      venueIds,
      scoresArray,
      {
        semanticWeight: 0.0,
        proximityWeight: 1.0,
        ratingWeight: 0.0,
        fullTextWeight: 0.0,
      },
      stride,
    );

    // venue-2 has highest proximityScore (0.95)
    expect(result.sortedIds[0]).toBe("venue-2");
  });

  it("ranks venues by rating when ratingWeight dominates", () => {
    const { venueIds, scoresBuffer, stride } =
      serializeVenuesToScoresBuffer(sampleVenues);
    const scoresArray = new Float32Array(scoresBuffer);

    const result = computeHybridScores(
      venueIds,
      scoresArray,
      {
        semanticWeight: 0.0,
        proximityWeight: 0.0,
        ratingWeight: 1.0,
        fullTextWeight: 0.0,
      },
      stride,
    );

    // venue-3 has highest ratingScore (0.98)
    expect(result.sortedIds[0]).toBe("venue-3");
  });

  it("ranks venues by full-text keyword match when fullTextWeight dominates", () => {
    const { venueIds, scoresBuffer, stride } =
      serializeVenuesToScoresBuffer(sampleVenues);
    const scoresArray = new Float32Array(scoresBuffer);

    const result = computeHybridScores(
      venueIds,
      scoresArray,
      {
        semanticWeight: 0.0,
        proximityWeight: 0.0,
        ratingWeight: 0.0,
        fullTextWeight: 1.0,
      },
      stride,
    );

    // venue-4 has highest fullTextScore (0.95)
    expect(result.sortedIds[0]).toBe("venue-4");
  });

  it("applies limit parameter and handles empty venue lists gracefully", () => {
    const { venueIds, scoresBuffer, stride } =
      serializeVenuesToScoresBuffer(sampleVenues);
    const scoresArray = new Float32Array(scoresBuffer);

    const limited = computeHybridScores(
      venueIds,
      scoresArray,
      { semanticWeight: 0.5, proximityWeight: 0.5 },
      stride,
      2,
    );

    expect(limited.sortedIds.length).toBe(2);
    expect(limited.count).toBe(2);

    const empty = computeHybridScores(
      [],
      new Float32Array(0),
      { semanticWeight: 0.5 },
      stride,
    );
    expect(empty.sortedIds).toEqual([]);
    expect(empty.count).toBe(0);
  });
});
