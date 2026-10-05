import {
  formatDistance,
  formatWalkingBadgeWithUnit,
  detectDefaultDistanceUnit,
  KM_TO_MILES,
  MILES_TO_KM,
} from "@/lib/geo/formatDistance";

describe("formatDistance & distance unit conversion (#3775)", () => {
  describe("Metric formatting", () => {
    it("formats short distances (< 1km) in meters", () => {
      expect(formatDistance(0.045, "METRIC")).toBe("45 m");
      expect(formatDistance(0.5, "METRIC")).toBe("500 m");
      expect(formatDistance(0.999, "METRIC")).toBe("999 m");
    });

    it("formats distances >= 1km in kilometers with rounding", () => {
      expect(formatDistance(1.23, "METRIC")).toBe("1.2 km");
      expect(formatDistance(14.86, "METRIC")).toBe("14.9 km");
      expect(formatDistance(1.0, "METRIC")).toBe("1.0 km");
    });
  });

  describe("Imperial formatting", () => {
    it("formats distances in miles with 1 decimal place", () => {
      // 1.2 km * 0.621371 = 0.7456... mi -> 0.7 mi
      expect(formatDistance(1.2, "IMPERIAL")).toBe("0.7 mi");
      // 1.609344 km -> 1.0 mi
      expect(formatDistance(1.609344, "IMPERIAL")).toBe("1.0 mi");
      // 5.0 km * 0.621371 = 3.106... mi -> 3.1 mi
      expect(formatDistance(5.0, "IMPERIAL")).toBe("3.1 mi");
    });

    it("formats very short imperial distances in feet when useSubUnits is true", () => {
      // 0.05 km = 50 m -> 50 * 3.28084 = 164 ft
      expect(formatDistance(0.05, "IMPERIAL")).toBe("164 ft");
    });

    it("can disable sub-units and format directly in miles", () => {
      expect(formatDistance(0.05, "IMPERIAL", { useSubUnits: false })).toBe("0.0 mi");
    });
  });

  describe("Edge cases & invalid inputs", () => {
    it("returns -- for negative numbers, NaN, or non-finite numbers", () => {
      expect(formatDistance(-1, "METRIC")).toBe("--");
      expect(formatDistance(NaN, "METRIC")).toBe("--");
      expect(formatDistance(Infinity, "IMPERIAL")).toBe("--");
    });
  });

  describe("Locale auto-detection (detectDefaultDistanceUnit)", () => {
    it("detects IMPERIAL for US and UK locales", () => {
      expect(detectDefaultDistanceUnit("en-US")).toBe("IMPERIAL");
      expect(detectDefaultDistanceUnit("en_US")).toBe("IMPERIAL");
      expect(detectDefaultDistanceUnit("en-GB")).toBe("IMPERIAL");
      expect(detectDefaultDistanceUnit("US")).toBe("IMPERIAL");
      expect(detectDefaultDistanceUnit("GB")).toBe("IMPERIAL");
    });

    it("detects METRIC for other worldwide locales", () => {
      expect(detectDefaultDistanceUnit("fr-FR")).toBe("METRIC");
      expect(detectDefaultDistanceUnit("de-DE")).toBe("METRIC");
      expect(detectDefaultDistanceUnit("es-ES")).toBe("METRIC");
      expect(detectDefaultDistanceUnit("ja-JP")).toBe("METRIC");
      expect(detectDefaultDistanceUnit("hi-IN")).toBe("METRIC");
      expect(detectDefaultDistanceUnit("en-CA")).toBe("METRIC");
      expect(detectDefaultDistanceUnit("en-AU")).toBe("METRIC");
    });

    it("defaults to METRIC if locale is undefined or empty", () => {
      expect(detectDefaultDistanceUnit("")).toBe("METRIC");
      expect(detectDefaultDistanceUnit(undefined)).toBe("METRIC");
    });
  });

  describe("formatWalkingBadgeWithUnit", () => {
    it("formats walking minutes and distance respecting unit", () => {
      expect(formatWalkingBadgeWithUnit(1.2, "METRIC")).toBe("15 min walk · 1.2 km");
      expect(formatWalkingBadgeWithUnit(1.2, "IMPERIAL")).toBe("15 min walk · 0.7 mi");
    });

    it("handles zero distance gracefully", () => {
      expect(formatWalkingBadgeWithUnit(0, "METRIC")).toBe("0 min walk · 0 m");
    });

    it("returns -- for invalid distance", () => {
      expect(formatWalkingBadgeWithUnit(-5, "METRIC")).toBe("--");
      expect(formatWalkingBadgeWithUnit(NaN, "METRIC")).toBe("--");
    });
  });

  describe("Unit conversion constants", () => {
    it("verifies accurate conversion factors", () => {
      expect(KM_TO_MILES * MILES_TO_KM).toBeCloseTo(1.0, 5);
    });
  });
});
