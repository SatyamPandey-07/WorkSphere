import {
  rssiToSignalBars,
  getSignalTier,
  getSignalQualityLabel,
  getSignalBarColors,
  calculateRssiDistance,
  SIGNAL_TIER_THRESHOLDS,
} from "@/lib/spatial/signalStrength";

describe("signalStrength mapping & RSSI tier validation (#5766)", () => {
  describe("rssiToSignalBars - 5-bar cellular tier mapping", () => {
    it("maps -50 dBm cleanly to 5 bars (full strength anchor)", () => {
      expect(rssiToSignalBars(-50)).toBe(5);
    });

    it("maps -100 dBm cleanly to 1 bar (minimum active signal anchor)", () => {
      expect(rssiToSignalBars(-100)).toBe(1);
    });

    it("maps Tier 5 (>= -60 dBm) to 5 bars", () => {
      expect(rssiToSignalBars(-60)).toBe(5);
      expect(rssiToSignalBars(-55)).toBe(5);
      expect(rssiToSignalBars(-50)).toBe(5);
      expect(rssiToSignalBars(-40)).toBe(5);
      expect(rssiToSignalBars(-30)).toBe(5);
      expect(rssiToSignalBars(0)).toBe(5);
      expect(rssiToSignalBars(10)).toBe(5);
    });

    it("maps Tier 4 (-70 dBm to -61 dBm) to 4 bars", () => {
      expect(rssiToSignalBars(-61)).toBe(4);
      expect(rssiToSignalBars(-65)).toBe(4);
      expect(rssiToSignalBars(-68)).toBe(4);
      expect(rssiToSignalBars(-70)).toBe(4);
    });

    it("maps Tier 3 (-80 dBm to -71 dBm) to 3 bars", () => {
      expect(rssiToSignalBars(-71)).toBe(3);
      expect(rssiToSignalBars(-75)).toBe(3);
      expect(rssiToSignalBars(-78)).toBe(3);
      expect(rssiToSignalBars(-80)).toBe(3);
    });

    it("maps Tier 2 (-90 dBm to -81 dBm) to 2 bars", () => {
      expect(rssiToSignalBars(-81)).toBe(2);
      expect(rssiToSignalBars(-85)).toBe(2);
      expect(rssiToSignalBars(-88)).toBe(2);
      expect(rssiToSignalBars(-90)).toBe(2);
    });

    it("maps Tier 1 (-100 dBm to -91 dBm) to 1 bar", () => {
      expect(rssiToSignalBars(-91)).toBe(1);
      expect(rssiToSignalBars(-95)).toBe(1);
      expect(rssiToSignalBars(-99)).toBe(1);
      expect(rssiToSignalBars(-100)).toBe(1);
    });

    it("maps sub-threshold readings (< -100 dBm) to 0 bars by default", () => {
      expect(rssiToSignalBars(-101)).toBe(0);
      expect(rssiToSignalBars(-105)).toBe(0);
      expect(rssiToSignalBars(-120)).toBe(0);
      expect(rssiToSignalBars(-150)).toBe(0);
    });

    it("clamps sub-threshold readings to 1 bar when clampToMinBar is true", () => {
      expect(rssiToSignalBars(-105, true)).toBe(1);
      expect(rssiToSignalBars(-120, true)).toBe(1);
    });

    it("safely handles null, undefined, NaN, and non-finite numbers with 0 bars", () => {
      expect(rssiToSignalBars(null)).toBe(0);
      expect(rssiToSignalBars(undefined)).toBe(0);
      expect(rssiToSignalBars(NaN)).toBe(0);
      expect(rssiToSignalBars(Infinity)).toBe(0);
      expect(rssiToSignalBars(-Infinity)).toBe(0);
    });
  });

  describe("getSignalTier & getSignalQualityLabel", () => {
    it("classifies qualitative tiers accurately", () => {
      expect(getSignalTier(-50)).toBe("excellent");
      expect(getSignalTier(-65)).toBe("good");
      expect(getSignalTier(-75)).toBe("fair");
      expect(getSignalTier(-85)).toBe("poor");
      expect(getSignalTier(-95)).toBe("weak");
      expect(getSignalTier(-110)).toBe("none");
      expect(getSignalTier(null)).toBe("none");
    });

    it("returns descriptive human-readable labels", () => {
      expect(getSignalQualityLabel(-50)).toBe("Excellent");
      expect(getSignalQualityLabel(-65)).toBe("Good");
      expect(getSignalQualityLabel(-75)).toBe("Fair");
      expect(getSignalQualityLabel(-85)).toBe("Poor");
      expect(getSignalQualityLabel(-95)).toBe("Weak");
      expect(getSignalQualityLabel(-110)).toBe("No Signal");
      expect(getSignalQualityLabel(null)).toBe("No Signal");
    });
  });

  describe("getSignalBarColors", () => {
    it("returns correct color classes for each bar count", () => {
      const fiveBars = getSignalBarColors(5);
      expect(fiveBars.barActive).toContain("emerald");

      const fourBars = getSignalBarColors(4);
      expect(fourBars.barActive).toContain("green");

      const threeBars = getSignalBarColors(3);
      expect(threeBars.barActive).toContain("amber");

      const twoBars = getSignalBarColors(2);
      expect(twoBars.barActive).toContain("orange");

      const oneBar = getSignalBarColors(1);
      expect(oneBar.barActive).toContain("rose");

      const zeroBars = getSignalBarColors(0);
      expect(zeroBars.barActive).toContain("zinc");
    });
  });

  describe("calculateRssiDistance (Log-Distance Path Loss Model)", () => {
    it("calculates metric distance at reference txPower (-59 dBm)", () => {
      // At RSSI = -59 and txPower = -59, d = 10^(0) = 1.0 meter
      const d = calculateRssiDistance(-59, -59, 2.5);
      expect(d).toBe(1);
    });

    it("calculates distance increase as RSSI attenuates", () => {
      const dClose = calculateRssiDistance(-65, -59, 2.5);
      const dFar = calculateRssiDistance(-85, -59, 2.5);
      expect(dClose).not.toBeNull();
      expect(dFar).not.toBeNull();
      expect(dFar!).toBeGreaterThan(dClose!);
    });

    it("returns null for invalid inputs", () => {
      expect(calculateRssiDistance(null)).toBeNull();
      expect(calculateRssiDistance(undefined)).toBeNull();
      expect(calculateRssiDistance(NaN)).toBeNull();
    });
  });
});
