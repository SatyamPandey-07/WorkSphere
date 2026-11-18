import {
  getBatteryLevel,
  getLowBatteryWarning,
  isLowBattery,
  normalizeBatteryPercent,
} from "@/lib/peripherals/battery";

describe("normalizeBatteryPercent", () => {
  it("rounds and clamps to 0-100", () => {
    expect(normalizeBatteryPercent(72.4)).toBe(72);
    expect(normalizeBatteryPercent(72.6)).toBe(73);
    expect(normalizeBatteryPercent(-5)).toBe(0);
    expect(normalizeBatteryPercent(150)).toBe(100);
  });

  it("returns null for missing or invalid values", () => {
    expect(normalizeBatteryPercent(null)).toBeNull();
    expect(normalizeBatteryPercent(undefined)).toBeNull();
    expect(normalizeBatteryPercent(NaN)).toBeNull();
    expect(normalizeBatteryPercent(Infinity)).toBeNull();
  });
});

describe("getBatteryLevel", () => {
  it("is good above 50%", () => {
    expect(getBatteryLevel(51)).toBe("good");
    expect(getBatteryLevel(100)).toBe("good");
  });

  it("is medium from 20% to 50% inclusive", () => {
    expect(getBatteryLevel(50)).toBe("medium");
    expect(getBatteryLevel(35)).toBe("medium");
    expect(getBatteryLevel(20)).toBe("medium");
  });

  it("is low below 20%", () => {
    expect(getBatteryLevel(19)).toBe("low");
    expect(getBatteryLevel(1)).toBe("low");
    expect(getBatteryLevel(0)).toBe("low");
  });

  it("classifies the rounded value shown to the user", () => {
    expect(getBatteryLevel(19.4)).toBe("low");
    expect(getBatteryLevel(19.5)).toBe("medium");
    expect(getBatteryLevel(50.4)).toBe("medium");
    expect(getBatteryLevel(50.5)).toBe("good");
  });

  it("returns null without a valid reading", () => {
    expect(getBatteryLevel(null)).toBeNull();
    expect(getBatteryLevel(undefined)).toBeNull();
    expect(getBatteryLevel(NaN)).toBeNull();
  });
});

describe("isLowBattery", () => {
  it("is true only below 20%", () => {
    expect(isLowBattery(19)).toBe(true);
    expect(isLowBattery(20)).toBe(false);
    expect(isLowBattery(80)).toBe(false);
  });

  it("is false for missing readings", () => {
    expect(isLowBattery(null)).toBe(false);
    expect(isLowBattery(undefined)).toBe(false);
  });
});

describe("getLowBatteryWarning", () => {
  it("names the device and its charge when below 20%", () => {
    const warning = getLowBatteryWarning("Logitech MX Master 3S", 18);
    expect(warning).toContain("Logitech MX Master 3S");
    expect(warning).toContain("18%");
  });

  it("returns null at or above 20% and for missing readings", () => {
    expect(getLowBatteryWarning("Mouse", 20)).toBeNull();
    expect(getLowBatteryWarning("Mouse", 85)).toBeNull();
    expect(getLowBatteryWarning("Mouse", null)).toBeNull();
    expect(getLowBatteryWarning("Mouse", undefined)).toBeNull();
  });
});
