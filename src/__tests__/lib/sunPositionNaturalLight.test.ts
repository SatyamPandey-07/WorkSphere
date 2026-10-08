import {
  calculateSunPosition,
  computeRelativeSunAngle,
  recommendNaturalLightDesks,
  BEST_NATURAL_LIGHT_BADGE,
} from "@/lib/sunPosition";

describe("Sun Position & Natural Light Seating Recommendation (#5064)", () => {
  describe("computeRelativeSunAngle", () => {
    test("calculates 0 deg when sun azimuth is directly aligned with venue orientation", () => {
      expect(computeRelativeSunAngle(180, 180)).toBe(0);
      expect(computeRelativeSunAngle(90, 90)).toBe(0);
      expect(computeRelativeSunAngle(0, 0)).toBe(0);
    });

    test("calculates 90 deg when sun azimuth is perpendicular to venue orientation", () => {
      expect(computeRelativeSunAngle(90, 180)).toBe(90);
      expect(computeRelativeSunAngle(270, 180)).toBe(90);
    });

    test("calculates 180 deg when sun is directly opposite venue orientation", () => {
      expect(computeRelativeSunAngle(0, 180)).toBe(180);
      expect(computeRelativeSunAngle(180, 0)).toBe(180);
    });

    test("handles wrap-around angular normalization correctly", () => {
      expect(computeRelativeSunAngle(10, 350)).toBe(20);
      expect(computeRelativeSunAngle(350, 10)).toBe(20);
    });
  });

  describe("recommendNaturalLightDesks", () => {
    const sampleDesks = [
      { id: "desk-window-glare", label: "A1", windowDistance: 1.0, row: 0 },
      { id: "desk-optimal-light", label: "A3", windowDistance: 3.0, row: 1 },
      { id: "desk-interior-shaded", label: "A8", windowDistance: 12.0, row: 5 },
    ];

    test("returns night status when sun is below horizon", () => {
      // Midnight in NYC
      const nightDate = new Date("2026-06-21T04:00:00Z"); // Midnight EDT
      const recs = recommendNaturalLightDesks(sampleDesks, {
        latitude: 40.7128,
        longitude: -74.006,
        venueCompassOrientation: 180,
        date: nightDate,
      });

      expect(recs).toHaveLength(3);
      recs.forEach((rec) => {
        expect(rec.isOptimalNaturalLight).toBe(false);
        expect(rec.badgeLabel).toBeUndefined();
        expect(rec.daylightQuality).toBe("night");
      });
    });

    test("marks optimal daylight desks with 'Best Natural Light' badge", () => {
      // Midday in NYC with sun high and South-facing windows
      const middayDate = new Date("2026-06-21T16:30:00Z"); // ~12:30 PM EDT
      const recs = recommendNaturalLightDesks(sampleDesks, {
        latitude: 40.7128,
        longitude: -74.006,
        venueCompassOrientation: 180,
        date: middayDate,
      });

      const optimalDesk = recs.find((r) => r.deskId === "desk-optimal-light");
      expect(optimalDesk).toBeDefined();
      expect(optimalDesk!.isOptimalNaturalLight).toBe(true);
      expect(optimalDesk!.badgeLabel).toBe(BEST_NATURAL_LIGHT_BADGE);
      expect(optimalDesk!.daylightQuality).toBe("optimal");
      expect(optimalDesk!.score).toBeGreaterThan(0.7);
    });

    test("identifies direct solar glare and avoids recommending desks exposed to harsh glare", () => {
      // Low winter sun shining directly South into window (acute angle < 25°, low altitude)
      const lowSunDate = new Date("2026-12-21T17:00:00Z"); // ~12:00 PM EST, low winter altitude ~26°
      const recs = recommendNaturalLightDesks(sampleDesks, {
        latitude: 40.7128,
        longitude: -74.006,
        venueCompassOrientation: 180, // Facing directly South
        date: lowSunDate,
        glareAngleThresholdDeg: 25,
      });

      const windowDesk = recs.find((r) => r.deskId === "desk-window-glare");
      expect(windowDesk).toBeDefined();
      // Window desk with low sun right in line of sight should be marked as glare
      expect(windowDesk!.daylightQuality).toBe("glare");
      expect(windowDesk!.isOptimalNaturalLight).toBe(false);
      expect(windowDesk!.badgeLabel).toBeUndefined();
    });

    test("recommends soft indirect light from shaded facades without direct glare", () => {
      // Afternoon sun on West (azimuth ~260°), North-facing facade (orientation = 0°)
      const afternoonDate = new Date("2026-06-21T20:00:00Z");
      const recs = recommendNaturalLightDesks(
        [
          { id: "desk-near-window", windowDistance: 2.0 },
          { id: "desk-far-interior", windowDistance: 15.0 },
        ],
        {
          latitude: 40.7128,
          longitude: -74.006,
          venueCompassOrientation: 0, // North facade (shaded from direct South/West sun)
          date: afternoonDate,
        },
      );

      const nearDesk = recs.find((r) => r.deskId === "desk-near-window");
      expect(nearDesk).toBeDefined();
      expect(nearDesk!.isOptimalNaturalLight).toBe(true);
      expect(nearDesk!.badgeLabel).toBe(BEST_NATURAL_LIGHT_BADGE);
      expect(nearDesk!.reason).toContain("indirect natural light");

      const farDesk = recs.find((r) => r.deskId === "desk-far-interior");
      expect(farDesk!.isOptimalNaturalLight).toBe(false);
    });
  });
});
