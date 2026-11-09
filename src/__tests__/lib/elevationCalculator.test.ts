import {
  calculateElevationGain,
  calculateActiveCalories,
  convertElevation,
  formatElevation,
  formatCalories,
  calculateGradient,
  normalizeTransportationMode,
  extractElevationValues,
  DEFAULT_BODY_WEIGHT_KG,
  WALKING_MET,
  CYCLING_MET,
} from "@/lib/routing/elevationCalculator";

describe("elevationCalculator", () => {
  describe("extractElevationValues", () => {
    it("handles an array of numbers", () => {
      expect(extractElevationValues([100, 110, 105])).toEqual([100, 110, 105]);
    });

    it("handles 3D coordinate tuples [lng, lat, elevation]", () => {
      const coords: [number, number, number][] = [
        [-122.4, 37.7, 50],
        [-122.41, 37.71, 75],
        [-122.42, 37.72, 60],
      ];
      expect(extractElevationValues(coords)).toEqual([50, 75, 60]);
    });

    it("distinguishes 2D GeoJSON coordinates [lng, lat] and extracts no elevation", () => {
      const coords2D: [number, number][] = [
        [-122.4, 37.7],
        [-122.41, 37.71],
      ];
      expect(extractElevationValues(coords2D as any)).toEqual([]);
    });

    it("handles coordinate objects with elevation properties", () => {
      const objects = [
        { lat: 37.7, lng: -122.4, elevation: 12 },
        { lat: 37.71, lng: -122.41, ele: 24 },
        { lat: 37.72, lng: -122.42, alt: 18 },
      ];
      expect(extractElevationValues(objects)).toEqual([12, 24, 18]);
    });

    it("filters out invalid, NaN, Infinity, and null/undefined values", () => {
      const mixed = [100, NaN, null, undefined, Infinity, "100" as any, 150];
      expect(extractElevationValues(mixed)).toEqual([100, 150]);
    });

    it("returns an empty array for undefined, null, or empty input", () => {
      expect(extractElevationValues(undefined)).toEqual([]);
      expect(extractElevationValues(null)).toEqual([]);
      expect(extractElevationValues([])).toEqual([]);
    });
  });

  describe("calculateElevationGain", () => {
    it("calculates positive elevation gain correctly", () => {
      // 100 -> 120 (+20), 120 -> 150 (+30) => total gain = 50
      expect(calculateElevationGain([100, 120, 150])).toBe(50);
    });

    it("ignores negative elevation changes (descents)", () => {
      // 150 -> 120 (-30, ignored), 120 -> 100 (-20, ignored) => gain = 0
      expect(calculateElevationGain([150, 120, 100])).toBe(0);
    });

    it("calculates cumulative gain on mixed undulating elevation profiles", () => {
      // 100 -> 120 (+20) -> 110 (-10) -> 130 (+20) -> 125 (-5) -> 140 (+15)
      // Gain = 20 + 20 + 15 = 55
      expect(calculateElevationGain([100, 120, 110, 130, 125, 140])).toBe(55);
    });

    it("returns 0 for a flat elevation profile with multiple samples", () => {
      expect(calculateElevationGain([100, 100, 100])).toBe(0);
    });

    it("returns null for empty elevation profile to avoid fabricated data", () => {
      expect(calculateElevationGain([])).toBeNull();
    });

    it("returns null for single-point elevation profiles", () => {
      expect(calculateElevationGain([100])).toBeNull();
    });

    it("returns null for missing, null, or undefined profiles", () => {
      expect(calculateElevationGain(null)).toBeNull();
      expect(calculateElevationGain(undefined)).toBeNull();
    });

    it("handles invalid or non-numeric elements safely without returning NaN", () => {
      // Valid points: [100, 120, 110, 130] -> gain = (120-100) + (130-110) = 40
      expect(calculateElevationGain([NaN, 100, null, 120, undefined, 110, 130])).toBe(40);
    });

    it("returns null if after filtering invalid values fewer than 2 points remain", () => {
      expect(calculateElevationGain([NaN, null, undefined, 100])).toBeNull();
    });
  });

  describe("convertElevation and formatElevation", () => {
    it("converts meters to feet when imperial unit is requested", () => {
      // 100 meters * 3.28084 = 328.084 -> 328 ft
      expect(convertElevation(100, "imperial")).toBe(328);
    });

    it("preserves meters when metric unit is requested", () => {
      expect(convertElevation(100, "metric")).toBe(100);
    });

    it("returns null for invalid or null meter inputs", () => {
      expect(convertElevation(null)).toBeNull();
      expect(convertElevation(NaN)).toBeNull();
    });

    it("formats elevation in meters for metric", () => {
      expect(formatElevation(75, "metric")).toBe("75 m");
    });

    it("formats elevation in feet for imperial", () => {
      expect(formatElevation(75, "imperial")).toBe("246 ft");
    });

    it("formats null or invalid elevation as N/A", () => {
      expect(formatElevation(null)).toBe("N/A");
      expect(formatElevation(NaN)).toBe("N/A");
    });
  });

  describe("calculateGradient", () => {
    it("calculates slope correctly", () => {
      // 50m gain over 1000m distance = 0.05 (5% gradient)
      expect(calculateGradient(50, 1000)).toBeCloseTo(0.05);
    });

    it("returns 0 for zero or negative elevation gain", () => {
      expect(calculateGradient(0, 1000)).toBe(0);
      expect(calculateGradient(-10, 1000)).toBe(0);
    });

    it("returns 0 for zero or negative distance", () => {
      expect(calculateGradient(50, 0)).toBe(0);
      expect(calculateGradient(50, -500)).toBe(0);
    });

    it("returns 0 for null or non-numeric inputs", () => {
      expect(calculateGradient(null, 1000)).toBe(0);
      expect(calculateGradient(50, null)).toBe(0);
    });
  });

  describe("calculateActiveCalories", () => {
    // Formula: Active Calories = (MET - 1) * 3.5 * weightKg / 200 * durationMinutes
    it("calculates walking active calories accurately using (MET - 1) for default 70kg weight", () => {
      // 60 minutes walking, base MET = 3.5:
      // Active MET = 3.5 - 1 = 2.5
      // Active Calories = 2.5 * 3.5 * 70 / 200 * 60 = 183.75 => 184 kcal
      const calories = calculateActiveCalories({
        mode: "walking",
        durationMinutes: 60,
        weightKg: 70,
        includeGradientAdjustment: false,
      });
      expect(calories).toBe(184);
    });

    it("calculates cycling active calories accurately using (MET - 1) for default 70kg weight", () => {
      // 60 minutes cycling, base MET = 6.8:
      // Active MET = 6.8 - 1 = 5.8
      // Active Calories = 5.8 * 3.5 * 70 / 200 * 60 = 426.3 => 426 kcal
      const calories = calculateActiveCalories({
        mode: "cycling",
        durationMinutes: 60,
        weightKg: 70,
        includeGradientAdjustment: false,
      });
      expect(calories).toBe(426);
    });

    it("accepts durationSeconds as an alternative to durationMinutes", () => {
      // 3600 seconds = 60 minutes
      const calories = calculateActiveCalories({
        mode: "walking",
        durationSeconds: 3600,
        weightKg: 70,
        includeGradientAdjustment: false,
      });
      expect(calories).toBe(184);
    });

    it("returns null for driving mode", () => {
      expect(
        calculateActiveCalories({
          mode: "driving",
          durationMinutes: 45,
          weightKg: 70,
        }),
      ).toBeNull();

      expect(
        calculateActiveCalories({
          mode: "DRIVE",
          durationMinutes: 45,
        }),
      ).toBeNull();
    });

    it("uses DEFAULT_BODY_WEIGHT_KG (70kg) when weight is unconfigured or invalid", () => {
      const defaultWeightResult = calculateActiveCalories({
        mode: "walking",
        durationMinutes: 60,
        includeGradientAdjustment: false,
      });
      expect(defaultWeightResult).toBe(184);

      const invalidWeightResult = calculateActiveCalories({
        mode: "walking",
        durationMinutes: 60,
        weightKg: -5,
        includeGradientAdjustment: false,
      });
      expect(invalidWeightResult).toBe(184);
    });

    it("applies documented ACSM walking equation when speed and elevation gain are valid", () => {
      // 30 minutes, 2400 meters distance (Speed S = 80 m/min, within 50-100 m/min ACSM range)
      // Elevation gain = 50m, 70kg weight
      // Net VO2 * minutes = 0.1 * 2400 + 1.8 * 50 = 240 + 90 = 330
      // Calories = 330 * 70 / 200 = 115.5 => 116 kcal
      const caloriesWithIncline = calculateActiveCalories({
        mode: "walking",
        durationMinutes: 30,
        weightKg: 70,
        distanceMeters: 2400,
        elevationGainMeters: 50,
        includeGradientAdjustment: true,
      });
      expect(caloriesWithIncline).toBe(116);
    });

    it("falls back to base active MET when walking speed is outside ACSM validated range", () => {
      // 60 minutes, 100 meters (speed = 1.67 m/min < 50 m/min)
      // Falls back to base active MET = 2.5
      // Active Calories = 2.5 * 3.5 * 70 / 200 * 60 = 183.75 => 184 kcal
      const caloriesSlow = calculateActiveCalories({
        mode: "walking",
        durationMinutes: 60,
        weightKg: 70,
        distanceMeters: 100,
        elevationGainMeters: 20,
        includeGradientAdjustment: true,
      });
      expect(caloriesSlow).toBe(184);
    });

    it("handles missing elevation data gracefully by using base active MET", () => {
      const result = calculateActiveCalories({
        mode: "walking",
        durationMinutes: 30,
        elevationGainMeters: null,
      });
      expect(result).not.toBeNull();
      expect(Number.isFinite(result)).toBe(true);
      // 2.5 * 3.5 * 70 / 200 * 30 = 91.875 => 92 kcal
      expect(result).toBe(92);
    });

    it("returns 0 for zero-duration routes", () => {
      expect(
        calculateActiveCalories({
          mode: "walking",
          durationMinutes: 0,
        }),
      ).toBe(0);
    });

    it("returns null for invalid, negative, or missing duration", () => {
      expect(
        calculateActiveCalories({
          mode: "walking",
          durationMinutes: -10,
        }),
      ).toBeNull();

      expect(
        calculateActiveCalories({
          mode: "walking",
          durationMinutes: NaN,
        }),
      ).toBeNull();

      expect(
        calculateActiveCalories({
          mode: "walking",
        }),
      ).toBeNull();
    });

    it("handles case-insensitive mode names (WALK, BIKE, bike, Foot)", () => {
      expect(
        calculateActiveCalories({
          mode: "WALK",
          durationMinutes: 60,
          includeGradientAdjustment: false,
        }),
      ).toBe(184);

      expect(
        calculateActiveCalories({
          mode: "BIKE",
          durationMinutes: 60,
          includeGradientAdjustment: false,
        }),
      ).toBe(426);
    });
  });

  describe("formatCalories", () => {
    it("formats valid calories with ~ and kcal badge", () => {
      expect(formatCalories(350)).toBe("~350 kcal");
    });

    it("formats null or non-finite calories as N/A", () => {
      expect(formatCalories(null)).toBe("N/A");
      expect(formatCalories(NaN)).toBe("N/A");
    });
  });

  describe("normalizeTransportationMode", () => {
    it("maps walking variations", () => {
      expect(normalizeTransportationMode("walking")).toBe("walking");
      expect(normalizeTransportationMode("WALK")).toBe("walking");
      expect(normalizeTransportationMode("foot")).toBe("walking");
    });

    it("maps cycling variations", () => {
      expect(normalizeTransportationMode("cycling")).toBe("cycling");
      expect(normalizeTransportationMode("BIKE")).toBe("cycling");
      expect(normalizeTransportationMode("bicycle")).toBe("cycling");
    });

    it("maps driving variations", () => {
      expect(normalizeTransportationMode("driving")).toBe("driving");
      expect(normalizeTransportationMode("DRIVE")).toBe("driving");
      expect(normalizeTransportationMode("car")).toBe("driving");
    });

    it("defaults to walking on undefined/null", () => {
      expect(normalizeTransportationMode(null)).toBe("walking");
      expect(normalizeTransportationMode(undefined)).toBe("walking");
    });
  });
});
