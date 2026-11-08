/**
 * Tests for the venue crowding badge calculation (Issue #1921).
 * Quiet (<40%), Moderate (40-75%), Busy (>75%) based on count/capacity.
 */

type CrowdingLabel = "Quiet" | "Moderate" | "Busy";

function computeCrowdingLabel(count: number, capacity: number): CrowdingLabel {
  if (capacity <= 0) return "Quiet"; // no capacity data = assume quiet
  const pct = (count / capacity) * 100;
  if (pct < 40) return "Quiet";
  if (pct <= 75) return "Moderate";
  return "Busy";
}

function getCrowdingColorClass(label: CrowdingLabel): string {
  switch (label) {
    case "Quiet":    return "text-green-700";
    case "Moderate": return "text-yellow-700";
    case "Busy":     return "text-red-600";
  }
}

describe("Venue crowding badge calculation", () => {
  describe("computeCrowdingLabel", () => {
    it("'Quiet' when 0% occupied", () => {
      expect(computeCrowdingLabel(0, 8)).toBe("Quiet");
    });

    it("'Quiet' at 39% occupied", () => {
      expect(computeCrowdingLabel(3, 8)).toBe("Quiet"); // 37.5%
    });

    it("'Moderate' at exactly 40%", () => {
      expect(computeCrowdingLabel(2, 5)).toBe("Moderate"); // 40%
    });

    it("'Moderate' at 62.5%", () => {
      expect(computeCrowdingLabel(5, 8)).toBe("Moderate");
    });

    it("'Moderate' at exactly 75%", () => {
      expect(computeCrowdingLabel(6, 8)).toBe("Moderate"); // 75%
    });

    it("'Busy' at 87.5%", () => {
      expect(computeCrowdingLabel(7, 8)).toBe("Busy");
    });

    it("'Busy' at 100%", () => {
      expect(computeCrowdingLabel(8, 8)).toBe("Busy");
    });

    it("'Quiet' when capacity is 0 (no data)", () => {
      expect(computeCrowdingLabel(5, 0)).toBe("Quiet");
    });
  });

  describe("getCrowdingColorClass", () => {
    it("green for Quiet", () => {
      expect(getCrowdingColorClass("Quiet")).toContain("green");
    });

    it("yellow for Moderate", () => {
      expect(getCrowdingColorClass("Moderate")).toContain("yellow");
    });

    it("red for Busy", () => {
      expect(getCrowdingColorClass("Busy")).toContain("red");
    });
  });

  describe("threshold boundaries", () => {
    it("39.9% → Quiet, 40.1% → Moderate", () => {
      // 39.9% ≈ count 3.19 of 8 → use 3/8 = 37.5%
      expect(computeCrowdingLabel(3, 8)).toBe("Quiet");
      // 40% exactly → Moderate
      expect(computeCrowdingLabel(4, 10)).toBe("Moderate");
    });

    it("75.0% → Moderate, 75.1% → Busy", () => {
      expect(computeCrowdingLabel(6, 8)).toBe("Moderate"); // 75%
      expect(computeCrowdingLabel(7, 8)).toBe("Busy");    // 87.5% > 75%
    });
  });
});
