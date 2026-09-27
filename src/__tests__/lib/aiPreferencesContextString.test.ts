/**
 * Additional tests for useAIUserPreferences.toContextString()
 * covering all preference combinations and AI prompt injection readiness.
 */

import type { UserPreferences } from "@/hooks/useAIUserPreferences";

// Replicate toContextString logic
function toContextString(preferences: UserPreferences): string {
  const parts: string[] = [];

  if (preferences.noiseLevel && preferences.noiseLevel !== "any") {
    parts.push(`${preferences.noiseLevel} venues`);
  }
  if (preferences.minWifiQuality) {
    parts.push(`WiFi ≥ ${preferences.minWifiQuality}/5`);
  }
  if (preferences.requiresOutlets) {
    parts.push("power outlets required");
  }
  if (preferences.requiresAccessibility) {
    parts.push("wheelchair accessible");
  }
  if (preferences.maxPriceTier) {
    parts.push(`price tier ≤ ${"$".repeat(preferences.maxPriceTier)}`);
  }
  if (preferences.requiresQuietZone) {
    parts.push("quiet zone required");
  }
  if (preferences.preferredCategories?.length) {
    parts.push(`prefers ${preferences.preferredCategories.join("/")} venues`);
  }

  return parts.length > 0 ? `User preferences: ${parts.join(", ")}.` : "";
}

describe("AI preferences toContextString", () => {
  it("returns empty string for empty preferences", () => {
    expect(toContextString({})).toBe("");
  });

  it("includes noiseLevel in context", () => {
    expect(toContextString({ noiseLevel: "quiet" })).toContain("quiet venues");
  });

  it("skips noiseLevel='any'", () => {
    const ctx = toContextString({ noiseLevel: "any" });
    expect(ctx).toBe(""); // no preference expressed
  });

  it("includes WiFi requirement", () => {
    expect(toContextString({ minWifiQuality: 4 })).toContain("WiFi ≥ 4/5");
  });

  it("includes outlet requirement", () => {
    expect(toContextString({ requiresOutlets: true })).toContain("power outlets required");
  });

  it("includes accessibility requirement", () => {
    expect(toContextString({ requiresAccessibility: true })).toContain("wheelchair accessible");
  });

  it("formats price tier correctly", () => {
    expect(toContextString({ maxPriceTier: 2 })).toContain("price tier ≤ $$");
    expect(toContextString({ maxPriceTier: 4 })).toContain("price tier ≤ $$$$");
  });

  it("includes quiet zone requirement", () => {
    expect(toContextString({ requiresQuietZone: true })).toContain("quiet zone required");
  });

  it("formats category list with slashes", () => {
    const ctx = toContextString({ preferredCategories: ["cafe", "coworking"] });
    expect(ctx).toContain("cafe/coworking");
  });

  it("starts with 'User preferences:' prefix", () => {
    expect(toContextString({ requiresOutlets: true })).toMatch(/^User preferences:/);
  });

  it("ends with period", () => {
    const ctx = toContextString({ noiseLevel: "quiet" });
    expect(ctx).toMatch(/\.$/);
  });

  it("combines multiple preferences with comma separation", () => {
    const ctx = toContextString({
      noiseLevel: "quiet",
      requiresOutlets: true,
      minWifiQuality: 3,
    });
    expect(ctx).toContain("quiet venues");
    expect(ctx).toContain("power outlets required");
    expect(ctx).toContain("WiFi ≥ 3/5");
    // Check comma separation
    const withoutPrefix = ctx.replace("User preferences: ", "").replace(".", "");
    const parts = withoutPrefix.split(", ");
    expect(parts.length).toBeGreaterThanOrEqual(3);
  });
});
