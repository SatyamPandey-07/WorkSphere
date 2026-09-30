/**
 * Tests for personalized venue booking experience configuration.
 */

interface ExperiencePreset {
  presetId: string;
  userId: string;
  name: string;
  defaults: {
    preferredAmenities: string[];
    preferredTimeOfDay: "morning" | "afternoon" | "evening";
    preferredDurationHours: number;
    preferredCategory: string;
    maxBudgetCents: number;
    locationRadius: number;    // km
  };
  lastUsedAt: number;
  useCount: number;
}

function applyPresetToSearch(
  preset: ExperiencePreset,
  overrides?: Partial<ExperiencePreset["defaults"]>
): ExperiencePreset["defaults"] {
  return { ...preset.defaults, ...overrides };
}

function mostUsedPreset(presets: ExperiencePreset[], userId: string): ExperiencePreset | null {
  const userPresets = presets.filter((p) => p.userId === userId);
  if (userPresets.length === 0) return null;
  return userPresets.reduce((max, p) => p.useCount > max.useCount ? p : max);
}

function incrementUseCount(preset: ExperiencePreset, nowMs: number): ExperiencePreset {
  return { ...preset, useCount: preset.useCount + 1, lastUsedAt: nowMs };
}

function presetMatchesSearch(
  preset: ExperiencePreset,
  searchQuery: { category: string; budgetCents: number }
): boolean {
  return (
    preset.defaults.preferredCategory === searchQuery.category &&
    preset.defaults.maxBudgetCents >= searchQuery.budgetCents
  );
}

const NOW = 1_700_000_000_000;
const PRESETS: ExperiencePreset[] = [
  {
    presetId: "pr1", userId: "u1", name: "Morning Focus",
    defaults: { preferredAmenities: ["wifi", "quiet"], preferredTimeOfDay: "morning", preferredDurationHours: 4, preferredCategory: "coworking", maxBudgetCents: 5000, locationRadius: 2 },
    lastUsedAt: NOW - 86_400_000, useCount: 15,
  },
  {
    presetId: "pr2", userId: "u1", name: "Quick Coffee",
    defaults: { preferredAmenities: ["coffee"], preferredTimeOfDay: "afternoon", preferredDurationHours: 1, preferredCategory: "cafe", maxBudgetCents: 2000, locationRadius: 1 },
    lastUsedAt: NOW - 3600_000, useCount: 8,
  },
];

describe("Personalized booking experience", () => {
  it("mostUsedPreset: pr1 has 15 uses > pr2's 8", () => {
    expect(mostUsedPreset(PRESETS, "u1")!.presetId).toBe("pr1");
  });

  it("mostUsedPreset: unknown user → null", () => {
    expect(mostUsedPreset(PRESETS, "u99")).toBeNull();
  });

  it("applyPresetToSearch: defaults unchanged without overrides", () => {
    const applied = applyPresetToSearch(PRESETS[0]);
    expect(applied.preferredCategory).toBe("coworking");
  });

  it("applyPresetToSearch: override category", () => {
    const applied = applyPresetToSearch(PRESETS[0], { preferredCategory: "cafe" });
    expect(applied.preferredCategory).toBe("cafe");
    expect(applied.preferredAmenities).toEqual(["wifi", "quiet"]); // unchanged
  });

  it("incrementUseCount: increments and updates timestamp", () => {
    const updated = incrementUseCount(PRESETS[0], NOW);
    expect(updated.useCount).toBe(16);
    expect(updated.lastUsedAt).toBe(NOW);
  });

  it("presetMatchesSearch: coworking within budget → true", () => {
    expect(presetMatchesSearch(PRESETS[0], { category: "coworking", budgetCents: 4000 })).toBe(true);
  });

  it("presetMatchesSearch: over budget → false", () => {
    expect(presetMatchesSearch(PRESETS[0], { category: "coworking", budgetCents: 6000 })).toBe(false);
  });
});
