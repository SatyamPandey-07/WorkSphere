import {
  calculateCumulativeElevationGain,
  calculateEcoCalories,
  createElevationBadge,
  createCalorieChip,
  buildEcoRouteRecommendationCard,
  generateMultiModalRouteCards,
  DEFAULT_BODY_WEIGHT_KG,
  WALKING_MET,
  CYCLING_MET,
  METERS_TO_FEET,
  extractElevationValues,
  formatElevation,
  formatCalories,
  normalizeTransportationMode,
} from "@/lib/routing/ecoRoutingEngine";

describe("ecoRoutingEngine", () => {
  describe("Constants & Conversions", () => {
    it("exports standard public health and physiological constants", () => {
      expect(DEFAULT_BODY_WEIGHT_KG).toBe(70);
      expect(WALKING_MET).toBe(3.5);
      expect(CYCLING_MET).toBe(6.8);
      expect(METERS_TO_FEET).toBeCloseTo(3.28084, 4);
    });

    it("formats elevation in metric and imperial units", () => {
      expect(formatElevation(100, "metric")).toBe("100 m");
      expect(formatElevation(100, "imperial")).toBe("328 ft");
      expect(formatElevation(0, "metric")).toBe("0 m");
      expect(formatElevation(null)).toBe("N/A");
      expect(formatElevation(NaN)).toBe("N/A");
    });

    it("formats active calories with ~ and kcal label", () => {
      expect(formatCalories(184)).toBe("~184 kcal");
      expect(formatCalories(0)).toBe("~0 kcal");
      expect(formatCalories(null)).toBe("N/A");
      expect(formatCalories(NaN)).toBe("N/A");
    });

    it("normalizes transportation mode strings reliably", () => {
      expect(normalizeTransportationMode("walking")).toBe("walking");
      expect(normalizeTransportationMode("WALK")).toBe("walking");
      expect(normalizeTransportationMode("foot")).toBe("walking");
      expect(normalizeTransportationMode("cycling")).toBe("cycling");
      expect(normalizeTransportationMode("BIKE")).toBe("cycling");
      expect(normalizeTransportationMode("bicycle")).toBe("cycling");
      expect(normalizeTransportationMode("driving")).toBe("driving");
      expect(normalizeTransportationMode("car")).toBe("driving");
      expect(normalizeTransportationMode(null)).toBe("walking");
    });
  });

  describe("extractElevationValues", () => {
    it("extracts numbers from array of primitive numbers", () => {
      expect(extractElevationValues([100, 150, 200])).toEqual([100, 150, 200]);
    });

    it("extracts elevation from 3D GeoJSON coordinates [lng, lat, elevation]", () => {
      const coords3D: [number, number, number][] = [
        [-122.4, 37.7, 50],
        [-122.41, 37.71, 75],
        [-122.42, 37.72, 60],
      ];
      expect(extractElevationValues(coords3D)).toEqual([50, 75, 60]);
    });

    it("distinguishes 2D GeoJSON coordinates [lng, lat] and extracts no elevation", () => {
      const coords2D = [
        [-122.4, 37.7],
        [-122.41, 37.71],
      ];
      expect(extractElevationValues(coords2D as any)).toEqual([]);
    });

    it("extracts elevation from coordinate objects with elevation, ele, or alt properties", () => {
      const objects = [
        { lat: 37.7, lng: -122.4, elevation: 120 },
        { lat: 37.71, lng: -122.41, ele: 140 },
        { lat: 37.72, lng: -122.42, alt: 160 },
      ];
      expect(extractElevationValues(objects)).toEqual([120, 140, 160]);
    });

    it("filters out non-finite, null, undefined, and NaN values safely", () => {
      expect(
        extractElevationValues([NaN, 100, null, 150, undefined, Infinity, 200]),
      ).toEqual([100, 150, 200]);
    });
  });

  describe("calculateCumulativeElevationGain - Edge Cases: Flat vs Mountainous Profiles", () => {
    it("returns 0 climb for completely flat terrain (edge case)", () => {
      const flatProfile = [100, 100, 100, 100];
      expect(calculateCumulativeElevationGain(flatProfile)).toBe(0);
    });

    it("returns 0 climb for flat terrain with many intermediate sample points", () => {
      const extendedFlat = new Array(20).fill(42);
      expect(calculateCumulativeElevationGain(extendedFlat)).toBe(0);
    });

    it("calculates accurate net climb for mountainous undulating terrain", () => {
      // 100 -> 250 (+150) -> 200 (-50 descent ignored) -> 350 (+150) -> 300 (-50 ignored) -> 500 (+200)
      // Total positive climb = 150 + 150 + 200 = 500
      const mountainProfile = [100, 250, 200, 350, 300, 500];
      expect(calculateCumulativeElevationGain(mountainProfile)).toBe(500);
    });

    it("ignores downhill sections entirely on pure descent mountain profiles", () => {
      // 1200 -> 1000 -> 800 -> 500 -> 200 (all descents, net climb = 0)
      const descentProfile = [1200, 1000, 800, 500, 200];
      expect(calculateCumulativeElevationGain(descentProfile)).toBe(0);
    });

    it("handles negative / below-sea-level elevation coordinates (e.g., Death Valley)", () => {
      // -86m -> -50m (+36) -> -60m (-10 ignored) -> -30m (+30) => total climb = 66m
      const belowSeaLevelProfile = [-86, -50, -60, -30];
      expect(calculateCumulativeElevationGain(belowSeaLevelProfile)).toBe(66);
    });

    it("handles floating-point decimal elevations with accurate rounding", () => {
      // 10.2 -> 15.7 (+5.5) -> 14.1 (-1.6 ignored) -> 20.4 (+6.3) => total climb = 11.8
      const decimalProfile = [10.2, 15.7, 14.1, 20.4];
      expect(calculateCumulativeElevationGain(decimalProfile)).toBe(11.8);
    });

    it("calculates gain from 3D coordinates tuples [lng, lat, elevation]", () => {
      const coords3D: [number, number, number][] = [
        [-122.4, 37.7, 50],
        [-122.41, 37.71, 95],
        [-122.42, 37.72, 80],
        [-122.43, 37.73, 140],
      ];
      // (95 - 50) + (140 - 80) = 45 + 60 = 105
      expect(calculateCumulativeElevationGain(coords3D)).toBe(105);
    });

    it("returns null for 2D coordinates lacking elevation data to avoid fabricating 0m climb", () => {
      const coords2D = [
        [-122.4, 37.7],
        [-122.41, 37.71],
      ];
      expect(calculateCumulativeElevationGain(coords2D as any)).toBeNull();
    });

    it("returns null for empty, single-point, or missing profiles", () => {
      expect(calculateCumulativeElevationGain([])).toBeNull();
      expect(calculateCumulativeElevationGain([150])).toBeNull();
      expect(calculateCumulativeElevationGain(null)).toBeNull();
      expect(calculateCumulativeElevationGain(undefined)).toBeNull();
    });

    it("sanitizes dirty arrays containing NaNs and invalid entries", () => {
      const dirtyProfile = [NaN, 100, null, 150, undefined, 200];
      // Valid points: 100 -> 150 (+50) -> 200 (+50) = 100
      expect(calculateCumulativeElevationGain(dirtyProfile)).toBe(100);
    });

    it("returns null if after filtering invalid values fewer than 2 valid points remain", () => {
      expect(
        calculateCumulativeElevationGain([NaN, null, undefined, 100]),
      ).toBeNull();
    });
  });

  describe("calculateEcoCalories - Walking, Cycling & Micro-Mobility", () => {
    it("calculates walking calories accurately using baseline active MET (3.5 - 1 = 2.5) for default 70kg weight", () => {
      // Formula: (3.5 - 1) * 3.5 * 70 / 200 * 30 min = 2.5 * 3.5 * 70 / 200 * 30 = 91.875 => 92 kcal
      const calories = calculateEcoCalories({
        mode: "walking",
        durationMinutes: 30,
        weightKg: DEFAULT_BODY_WEIGHT_KG,
        includeGradientAdjustment: false,
      });
      expect(calories).toBe(92);
    });

    it("calculates cycling calories accurately using baseline active MET (6.8 - 1 = 5.8) for default 70kg weight", () => {
      // Formula: (6.8 - 1) * 3.5 * 70 / 200 * 30 min = 5.8 * 3.5 * 70 / 200 * 30 = 213.15 => 213 kcal
      const calories = calculateEcoCalories({
        mode: "cycling",
        durationMinutes: 30,
        weightKg: DEFAULT_BODY_WEIGHT_KG,
        includeGradientAdjustment: false,
      });
      expect(calories).toBe(213);
    });

    it("normalizes micro-mobility mode to active cycling energy expenditure", () => {
      const calories = calculateEcoCalories({
        mode: "micro-mobility",
        durationMinutes: 30,
        weightKg: DEFAULT_BODY_WEIGHT_KG,
        includeGradientAdjustment: false,
      });
      expect(calories).toBe(213);
    });

    it("applies ACSM metabolic walking equation when walking speed and incline gradient are valid", () => {
      // 30 min, 2400m distance => Speed = 80 m/min (within ACSM [50, 100] m/min range)
      // Elevation gain = 50m, Weight = 70kg
      // Net VO2 = 0.1 * 2400 + 1.8 * 50 = 240 + 90 = 330
      // Calories = 330 * 70 / 200 = 115.5 => 116 kcal
      const caloriesWithIncline = calculateEcoCalories({
        mode: "walking",
        durationMinutes: 30,
        distanceMeters: 2400,
        elevationGainMeters: 50,
        weightKg: 70,
        includeGradientAdjustment: true,
      });
      expect(caloriesWithIncline).toBe(116);
    });

    it("proves that a mountainous profile burns more calories than a flat profile for the same walking distance", () => {
      const flatCalories = calculateEcoCalories({
        mode: "walking",
        durationMinutes: 30,
        distanceMeters: 2400,
        elevationGainMeters: 0,
        weightKg: 70,
        includeGradientAdjustment: true,
      });
      // Net VO2 = 0.1 * 2400 + 1.8 * 0 = 240 => Calories = 240 * 70 / 200 = 84 kcal
      expect(flatCalories).toBe(84);

      const mountainCalories = calculateEcoCalories({
        mode: "walking",
        durationMinutes: 30,
        distanceMeters: 2400,
        elevationGainMeters: 100, // 100m climb
        weightKg: 70,
        includeGradientAdjustment: true,
      });
      // Net VO2 = 0.1 * 2400 + 1.8 * 100 = 240 + 180 = 420 => Calories = 420 * 70 / 200 = 147 kcal
      expect(mountainCalories).toBe(147);

      expect(mountainCalories!).toBeGreaterThan(flatCalories!);
    });

    it("clamps downhill walking calories to positive metabolic minimum floor and verifies downhill < flat < uphill", () => {
      // 30 min, 2400m walking at 80 m/min, 70kg adult
      const downhillCalories = calculateEcoCalories({
        mode: "walking",
        durationMinutes: 30,
        distanceMeters: 2400,
        elevationGainMeters: -200, // Destination is 200m lower than origin
        weightKg: 70,
        includeGradientAdjustment: true,
      });

      const flatCalories = calculateEcoCalories({
        mode: "walking",
        durationMinutes: 30,
        distanceMeters: 2400,
        elevationGainMeters: 0,
        weightKg: 70,
        includeGradientAdjustment: true,
      });

      const uphillCalories = calculateEcoCalories({
        mode: "walking",
        durationMinutes: 30,
        distanceMeters: 2400,
        elevationGainMeters: 100,
        weightKg: 70,
        includeGradientAdjustment: true,
      });

      // Clamped to positive baseline metabolic equivalent (~3.0 METs gross, ~2.5 kcal/min floor)
      expect(downhillCalories).toBeDefined();
      expect(downhillCalories).toBeGreaterThanOrEqual(74);
      expect(flatCalories).toBe(84);
      expect(uphillCalories).toBe(147);

      // Logical progression: downhill <= flat < uphill, all strictly positive
      expect(downhillCalories!).toBeLessThan(flatCalories!);
      expect(flatCalories!).toBeLessThan(uphillCalories!);
    });

    it("verifies downhill, flat, and uphill calorie metrics for cycling", () => {
      const downhillCycling = calculateEcoCalories({
        mode: "cycling",
        durationMinutes: 30,
        distanceMeters: 8000,
        elevationGainMeters: -200,
        weightKg: 70,
        includeGradientAdjustment: true,
      });

      const flatCycling = calculateEcoCalories({
        mode: "cycling",
        durationMinutes: 30,
        distanceMeters: 8000,
        elevationGainMeters: 0,
        weightKg: 70,
        includeGradientAdjustment: true,
      });

      const uphillCycling = calculateEcoCalories({
        mode: "cycling",
        durationMinutes: 30,
        distanceMeters: 8000,
        elevationGainMeters: 100,
        weightKg: 70,
        includeGradientAdjustment: true,
      });

      expect(downhillCycling).toBeDefined();
      expect(downhillCycling).toBeGreaterThan(0);
      expect(flatCycling).toBe(213);
      expect(uphillCycling).toBeGreaterThan(flatCycling!);
      expect(downhillCycling!).toBeLessThan(flatCycling!);
    });

    it("accurately calculates calories from distance alone for walking when duration is omitted", () => {
      // 2400 meters walking at standard 80 m/min (~4.8 km/h) = 30 minutes duration
      // ACSM formula with 50m climb: 116 kcal
      const caloriesFromDistance = calculateEcoCalories({
        mode: "walking",
        distanceMeters: 2400,
        elevationGainMeters: 50,
        weightKg: 70,
        includeGradientAdjustment: true,
      });
      expect(caloriesFromDistance).toBe(116);
    });

    it("accurately calculates calories from distance alone for cycling when duration is omitted", () => {
      // 5333 meters cycling at 266.67 m/min = 20 minutes
      // Active MET = 5.8 => 5.8 * 3.5 * 70 / 200 * 20 = 142.1 => 142 kcal
      const cyclingDistanceCalories = calculateEcoCalories({
        mode: "cycling",
        distanceMeters: 5333.4,
        weightKg: 70,
      });
      expect(cyclingDistanceCalories).toBe(142);
    });

    it("handles undefined mode gracefully by defaulting to walking or returning null when invalid", () => {
      expect(
        calculateEcoCalories({
          mode: "",
          durationMinutes: 30,
        }),
      ).toBe(92);
    });

    it("accepts durationSeconds as an alternative to durationMinutes", () => {
      const caloriesFromSeconds = calculateEcoCalories({
        mode: "walking",
        durationSeconds: 1800, // 30 minutes
        weightKg: 70,
        includeGradientAdjustment: false,
      });
      expect(caloriesFromSeconds).toBe(92);
    });

    it("scales proportionally with custom body weight profiles", () => {
      // 90kg user burns more than 70kg user:
      // 2.5 * 3.5 * 90 / 200 * 30 = 118.125 => 118 kcal
      const heavierUserCalories = calculateEcoCalories({
        mode: "walking",
        durationMinutes: 30,
        weightKg: 90,
        includeGradientAdjustment: false,
      });
      expect(heavierUserCalories).toBe(118);
    });

    it("returns null for passive transportation modes (transit, driving, car)", () => {
      expect(
        calculateEcoCalories({
          mode: "transit",
          durationMinutes: 45,
        }),
      ).toBeNull();

      expect(
        calculateEcoCalories({
          mode: "driving",
          durationMinutes: 45,
        }),
      ).toBeNull();
    });

    it("returns 0 for zero-duration or zero-distance routes", () => {
      expect(
        calculateEcoCalories({
          mode: "walking",
          durationMinutes: 0,
        }),
      ).toBe(0);
    });

    it("returns null for negative durations or missing distance and duration", () => {
      expect(
        calculateEcoCalories({
          mode: "walking",
          durationMinutes: -15,
        }),
      ).toBeNull();

      expect(
        calculateEcoCalories({
          mode: "walking",
        }),
      ).toBeNull();
    });

    it("handles case-insensitive mode names (WALK, bike, Micro-Mobility, CYCLING)", () => {
      expect(
        calculateEcoCalories({
          mode: "WALK",
          durationMinutes: 30,
          includeGradientAdjustment: false,
        }),
      ).toBe(92);

      expect(
        calculateEcoCalories({
          mode: "BIKE",
          durationMinutes: 30,
          includeGradientAdjustment: false,
        }),
      ).toBe(213);
    });
  });

  describe("createElevationBadge", () => {
    it("creates badge with flat terrain icon and descriptive aria-label for 0m climb (flat terrain)", () => {
      const badge = createElevationBadge(0, "metric");
      expect(badge.netClimbMeters).toBe(0);
      expect(badge.displayValue).toBe("0 m");
      expect(badge.icon).toBe("flat");
      expect(badge.elevationProfileIcon).toBe("flat");
      expect(badge.ariaLabel).toBe("Flat terrain with 0 meters elevation gain");
    });

    it("creates badge with mountain icon and net climb meters for positive elevation gain", () => {
      const badge = createElevationBadge(150, "metric");
      expect(badge.netClimbMeters).toBe(150);
      expect(badge.displayValue).toBe("150 m");
      expect(badge.icon).toBe("mountain");
      expect(badge.elevationProfileIcon).toBe("mountain");
      expect(badge.ariaLabel).toBe(
        "Elevation gain: 150 meters net uphill climb",
      );
    });

    it("converts to feet when imperial units are requested", () => {
      // 150 meters * 3.28084 = 492.126 => 492 ft
      const badge = createElevationBadge(150, "imperial");
      expect(badge.displayValue).toBe("492 ft");
      expect(badge.ariaLabel).toBe("Elevation gain: 492 feet net uphill climb");
    });

    it("handles null elevation gain gracefully with screen-reader fallback", () => {
      const badge = createElevationBadge(null);
      expect(badge.netClimbMeters).toBeNull();
      expect(badge.displayValue).toBe("N/A");
      expect(badge.ariaLabel).toBe("Elevation telemetry unavailable");
    });
  });

  describe("createCalorieChip", () => {
    it("creates active calorie chip with flame icon and screen-reader label", () => {
      const chip = createCalorieChip(184);
      expect(chip.calories).toBe(184);
      expect(chip.displayValue).toBe("~184 kcal");
      expect(chip.icon).toBe("flame");
      expect(chip.ariaLabel).toBe("Estimated 184 active calories burned");
    });

    it("handles null calories with screen-reader fallback for passive modes", () => {
      const chip = createCalorieChip(null);
      expect(chip.calories).toBeNull();
      expect(chip.displayValue).toBe("N/A");
      expect(chip.icon).toBe("flame");
      expect(chip.ariaLabel).toBe(
        "Calorie expenditure not applicable for this transit mode",
      );
    });
  });

  describe("buildEcoRouteRecommendationCard", () => {
    it("assembles complete card from elevation profile with badges and screen-reader labels", () => {
      const card = buildEcoRouteRecommendationCard({
        id: "card-walk",
        mode: "walking",
        title: "Scenic Eco Walk",
        distanceMeters: 2400,
        durationSeconds: 1800, // 30 mins
        elevationProfile: [50, 80, 110], // 60m gain
        weightKg: 70,
        unitPreference: "metric",
      });

      expect(card.id).toBe("card-walk");
      expect(card.mode).toBe("walking");
      expect(card.title).toBe("Scenic Eco Walk");
      expect(card.isEcoFriendly).toBe(true);
      expect(card.elevationBadge.netClimbMeters).toBe(60);
      expect(card.elevationBadge.displayValue).toBe("60 m");
      expect(card.elevationBadge.ariaLabel).toBe(
        "Elevation gain: 60 meters net uphill climb",
      );
      expect(card.calorieChip.calories).toBeGreaterThan(0);
      expect(card.calorieChip.ariaLabel).toContain("active calories burned");
    });

    it("assembles flat terrain card with 0m climb badge and flat icon", () => {
      const card = buildEcoRouteRecommendationCard({
        id: "card-flat",
        mode: "walking",
        title: "Flat Walk",
        distanceMeters: 1200,
        durationSeconds: 900,
        elevationProfile: [100, 100, 100],
      });

      expect(card.elevationBadge.netClimbMeters).toBe(0);
      expect(card.elevationBadge.icon).toBe("flat");
      expect(card.elevationBadge.ariaLabel).toBe(
        "Flat terrain with 0 meters elevation gain",
      );
    });
  });

  describe("generateMultiModalRouteCards", () => {
    it("generates walking card by default and includes micro-mobility when vehicles are present", () => {
      const cards = generateMultiModalRouteCards({
        walkingDistanceMeters: 1200,
        walkingDurationSeconds: 900,
        hasMicroMobility: true,
        microMobilityDistanceMeters: 1500,
        microMobilityDurationSeconds: 360,
        microMobilityCost: 2.1,
        elevationProfile: [100, 130, 150], // 50m climb
      });

      expect(cards.length).toBe(2);

      // 1. Eco Walk Card
      const walkCard = cards[0];
      expect(walkCard.id).toBe("card-eco-walk");
      expect(walkCard.mode).toBe("walking");
      expect(walkCard.isEcoFriendly).toBe(true);
      expect(walkCard.elevationBadge.netClimbMeters).toBe(50);
      expect(walkCard.elevationBadge.displayValue).toBe("50 m");
      expect(walkCard.calorieChip.calories).toBeGreaterThan(0);

      // 2. Micro-Mobility Card
      const microCard = cards[1];
      expect(microCard.id).toBe("card-micro-mobility");
      expect(microCard.mode).toBe("micro-mobility");
      expect(microCard.isEcoFriendly).toBe(true);
      expect(microCard.elevationBadge.netClimbMeters).toBe(50);
      expect(microCard.cost).toBe(2.1);
      expect(microCard.calorieChip.calories).toBeGreaterThan(0);
    });

    it("generates only walking card when no micro-mobility options exist in radius", () => {
      const cards = generateMultiModalRouteCards({
        hasMicroMobility: false,
      });

      expect(cards.length).toBe(1);
      expect(cards[0].id).toBe("card-eco-walk");
      expect(cards[0].mode).toBe("walking");
    });

    it("generates default walking card when called with no arguments", () => {
      const cards = generateMultiModalRouteCards();
      expect(cards.length).toBe(1);
      expect(cards[0].id).toBe("card-eco-walk");
      expect(cards[0].mode).toBe("walking");
      expect(cards[0].distanceMeters).toBe(1200);
      expect(cards[0].durationSeconds).toBe(900);
    });

    it("propagates imperial unit preference to badges on both cards", () => {
      const cards = generateMultiModalRouteCards({
        hasMicroMobility: true,
        elevationGainMeters: 100, // 100m = 328ft
        unitPreference: "imperial",
      });

      expect(cards[0].elevationBadge.displayValue).toBe("328 ft");
      expect(cards[0].elevationBadge.ariaLabel).toContain("328 feet");
      expect(cards[1].elevationBadge.displayValue).toBe("328 ft");
    });
  });
});
