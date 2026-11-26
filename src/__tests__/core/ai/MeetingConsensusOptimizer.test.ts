import { MeetingOptimizer } from "@/core/ai/MeetingOptimizer";

describe("MeetingOptimizer.optimizeMeetingConsensus (#7172)", () => {
  const optimizer = new MeetingOptimizer("test-groq-key");

  it("combines distance, noise, and outlet perspectives into a Pareto-ranked result", () => {
    const result = optimizer.optimizeMeetingConsensus(
      [
        {
          id: "near-quiet",
          name: "Quiet Cafe",
          distanceByParticipantMeters: { alice: 900, bob: 1200 },
          noiseDecibels: 38,
          powerOutletAvailability: 0.8,
          wifiMbps: 150,
        },
        {
          id: "far-loud",
          name: "Busy Hub",
          distanceByParticipantMeters: { alice: 7000, bob: 6500 },
          noiseDecibels: 72,
          powerOutletAvailability: 1,
          wifiMbps: 300,
        },
      ],
      [{ participantId: "alice" }, { participantId: "bob" }],
    );

    expect(result.selectedVenue?.venue.id).toBe("near-quiet");
    expect(result.recommendations[0].paretoRank).toBe(1);
    expect(result.selectedVenue?.perspectiveScores.distance).toBeGreaterThan(
      result.recommendations[1].perspectiveScores.distance,
    );
    expect(result.reasoningBreakdown).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Distance perspective"),
        expect.stringContaining("Quietness perspective"),
        expect.stringContaining("Power-access perspective"),
      ]),
    );
    expect(result.elapsedMs).toBeLessThan(800);
  });

  it("relaxes optional outdoor and bike-parking requirements before hard constraints", () => {
    const result = optimizer.optimizeMeetingConsensus(
      [
        {
          id: "indoor",
          name: "Indoor Cafe",
          distanceByParticipantMeters: { alice: 500 },
          noiseDecibels: 35,
          powerOutletAvailability: 0.9,
          wifiMbps: 120,
          hasOutdoorSeating: false,
          hasBikeParking: false,
        },
      ],
      [
        {
          participantId: "alice",
          requiresOutdoorSeating: true,
          requiresBikeParking: true,
        },
      ],
    );

    expect(result.selectedVenue?.venue.id).toBe("indoor");
    expect(result.relaxationSteps).toContain(
      "Relaxed optional outdoor-seating and bike-parking requirements.",
    );
  });

  it("applies staged noise, Wi-Fi, distance, and power relaxation when no strict match exists", () => {
    const result = optimizer.optimizeMeetingConsensus(
      [
        {
          id: "compromise",
          name: "Compromise Space",
          distanceByParticipantMeters: { alice: 1400 },
          noiseDecibels: 48,
          powerOutletAvailability: 0.2,
          wifiMbps: 60,
          hasOutdoorSeating: false,
          hasBikeParking: false,
        },
      ],
      [
        {
          participantId: "alice",
          maxDistanceMeters: 1000,
          maxNoiseDecibels: 40,
          minWifiMbps: 80,
          requiresPowerOutlet: true,
          requiresOutdoorSeating: true,
          requiresBikeParking: true,
        },
      ],
    );

    expect(result.selectedVenue?.venue.id).toBe("compromise");
    expect(result.relaxationSteps).toHaveLength(4);
    expect(result.reasoningBreakdown).toEqual(
      expect.arrayContaining([
        expect.stringContaining("normalized weights"),
      ]),
    );
  });

  it("returns an empty result for no candidate venues", () => {
    const result = optimizer.optimizeMeetingConsensus([], []);

    expect(result.selectedVenue).toBeNull();
    expect(result.recommendations).toHaveLength(0);
    expect(result.reasoningBreakdown[0]).toContain("No candidate venues");
  });

  it("rejects invalid consensus weights", () => {
    expect(() =>
      optimizer.optimizeMeetingConsensus(
        [
          {
            id: "venue",
            name: "Venue",
            distanceByParticipantMeters: { alice: 100 },
            noiseDecibels: 40,
            powerOutletAvailability: 1,
          },
        ],
        [{ participantId: "alice" }],
        { weights: { distance: 0, noise: 0, power: 0 } },
      ),
    ).toThrow("Consensus weights");
  });
});
