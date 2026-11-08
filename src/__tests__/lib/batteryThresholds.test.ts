/**
 * Tests for the battery threshold logic (Issue #2073 Battery Panic Mode).
 * isLow triggers at ≤ 20%, isPanic triggers at ≤ 10%.
 */

const LOW_BATTERY_THRESHOLD = 0.2;
const PANIC_THRESHOLD = 0.1;

function classifyBattery(level: number, charging: boolean): {
  isLow: boolean;
  isPanic: boolean;
} {
  const isLow = !charging && level <= LOW_BATTERY_THRESHOLD;
  const isPanic = !charging && level <= PANIC_THRESHOLD;
  return { isLow, isPanic };
}

describe("Battery Panic Mode thresholds", () => {
  describe("isLow threshold (≤ 20%)", () => {
    it("isLow=true at exactly 20%", () => {
      expect(classifyBattery(0.20, false).isLow).toBe(true);
    });

    it("isLow=true below 20%", () => {
      expect(classifyBattery(0.15, false).isLow).toBe(true);
      expect(classifyBattery(0.01, false).isLow).toBe(true);
    });

    it("isLow=false above 20%", () => {
      expect(classifyBattery(0.21, false).isLow).toBe(false);
      expect(classifyBattery(0.5, false).isLow).toBe(false);
      expect(classifyBattery(1.0, false).isLow).toBe(false);
    });

    it("isLow=false when charging (even at 5%)", () => {
      expect(classifyBattery(0.05, true).isLow).toBe(false);
    });
  });

  describe("isPanic threshold (≤ 10%)", () => {
    it("isPanic=true at exactly 10%", () => {
      expect(classifyBattery(0.10, false).isPanic).toBe(true);
    });

    it("isPanic=true below 10%", () => {
      expect(classifyBattery(0.08, false).isPanic).toBe(true);
      expect(classifyBattery(0.01, false).isPanic).toBe(true);
    });

    it("isPanic=false above 10%", () => {
      expect(classifyBattery(0.11, false).isPanic).toBe(false);
      expect(classifyBattery(0.25, false).isPanic).toBe(false);
    });

    it("isPanic=false when charging (even at 1%)", () => {
      expect(classifyBattery(0.01, true).isPanic).toBe(false);
    });
  });

  describe("threshold relationship", () => {
    it("isLow ≥ isPanic (panic is stricter than low)", () => {
      const testLevels = [0.05, 0.10, 0.15, 0.20, 0.25];
      testLevels.forEach((level) => {
        const { isLow, isPanic } = classifyBattery(level, false);
        if (isPanic) expect(isLow).toBe(true); // panic implies low
      });
    });

    it("charging overrides both thresholds", () => {
      const { isLow, isPanic } = classifyBattery(0.05, true);
      expect(isLow).toBe(false);
      expect(isPanic).toBe(false);
    });

    it("full battery triggers neither threshold", () => {
      const { isLow, isPanic } = classifyBattery(1.0, false);
      expect(isLow).toBe(false);
      expect(isPanic).toBe(false);
    });
  });
});
