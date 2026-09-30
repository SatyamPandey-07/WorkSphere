/**
 * Tests for venue-level feature flag configuration.
 */

type FeatureFlag =
  | "real_time_availability"
  | "dynamic_pricing"
  | "collaborative_spaces"
  | "floor_plan_3d"
  | "ai_recommendations";

interface VenueFeatureConfig {
  venueId: string;
  enabledFlags: FeatureFlag[];
  overrides?: Partial<Record<FeatureFlag, boolean>>;
}

function isFeatureEnabled(config: VenueFeatureConfig, flag: FeatureFlag): boolean {
  if (config.overrides && flag in config.overrides) {
    return config.overrides[flag] === true;
  }
  return config.enabledFlags.includes(flag);
}

function enabledFeatureCount(config: VenueFeatureConfig): number {
  const flags: FeatureFlag[] = [
    "real_time_availability", "dynamic_pricing", "collaborative_spaces",
    "floor_plan_3d", "ai_recommendations",
  ];
  return flags.filter((f) => isFeatureEnabled(config, f)).length;
}

function addFlag(config: VenueFeatureConfig, flag: FeatureFlag): VenueFeatureConfig {
  if (config.enabledFlags.includes(flag)) return config;
  return { ...config, enabledFlags: [...config.enabledFlags, flag] };
}

function removeFlag(config: VenueFeatureConfig, flag: FeatureFlag): VenueFeatureConfig {
  return { ...config, enabledFlags: config.enabledFlags.filter((f) => f !== flag) };
}

const CONFIG: VenueFeatureConfig = {
  venueId: "v1",
  enabledFlags: ["real_time_availability", "dynamic_pricing"],
};

describe("Venue feature flag configuration", () => {
  it("enabled flag → true", () => {
    expect(isFeatureEnabled(CONFIG, "real_time_availability")).toBe(true);
  });

  it("disabled flag → false", () => {
    expect(isFeatureEnabled(CONFIG, "floor_plan_3d")).toBe(false);
  });

  it("override enables flag not in enabledFlags", () => {
    const cfg = { ...CONFIG, overrides: { floor_plan_3d: true } as VenueFeatureConfig["overrides"] };
    expect(isFeatureEnabled(cfg, "floor_plan_3d")).toBe(true);
  });

  it("override disables flag in enabledFlags", () => {
    const cfg = { ...CONFIG, overrides: { dynamic_pricing: false } as VenueFeatureConfig["overrides"] };
    expect(isFeatureEnabled(cfg, "dynamic_pricing")).toBe(false);
  });

  it("enabledFeatureCount counts correctly", () => {
    expect(enabledFeatureCount(CONFIG)).toBe(2);
  });

  it("addFlag adds new flag", () => {
    const updated = addFlag(CONFIG, "floor_plan_3d");
    expect(updated.enabledFlags).toContain("floor_plan_3d");
  });

  it("addFlag: no duplicate if already present", () => {
    const updated = addFlag(CONFIG, "dynamic_pricing");
    expect(updated.enabledFlags.filter((f) => f === "dynamic_pricing")).toHaveLength(1);
  });

  it("removeFlag removes flag", () => {
    const updated = removeFlag(CONFIG, "dynamic_pricing");
    expect(updated.enabledFlags).not.toContain("dynamic_pricing");
  });
});
