/**
 * Tests for venue booking API versioning and deprecation utilities.
 */

type ApiVersion = "v1" | "v2" | "v3" | "v4";

interface ApiVersionConfig {
  version: ApiVersion;
  releaseDate: number;
  deprecationDate: number | null;
  sunsetDate: number | null;
  breakingChanges: string[];
  isLatest: boolean;
}

const API_VERSIONS: ApiVersionConfig[] = [
  { version: "v1", releaseDate: 1_640_000_000_000, deprecationDate: 1_680_000_000_000, sunsetDate: 1_700_000_000_000, breakingChanges: [],                                     isLatest: false },
  { version: "v2", releaseDate: 1_680_000_000_000, deprecationDate: 1_720_000_000_000, sunsetDate: 1_750_000_000_000, breakingChanges: ["Removed legacy auth"],                isLatest: false },
  { version: "v3", releaseDate: 1_720_000_000_000, deprecationDate: null,             sunsetDate: null,               breakingChanges: ["Changed booking response format"],    isLatest: false },
  { version: "v4", releaseDate: 1_740_000_000_000, deprecationDate: null,             sunsetDate: null,               breakingChanges: ["New pagination model", "UTC-only dates"], isLatest: true },
];

function isDeprecated(config: ApiVersionConfig, nowMs: number): boolean {
  return config.deprecationDate !== null && nowMs >= config.deprecationDate;
}

function isSunset(config: ApiVersionConfig, nowMs: number): boolean {
  return config.sunsetDate !== null && nowMs >= config.sunsetDate;
}

function latestVersion(): ApiVersionConfig | null {
  return API_VERSIONS.find((v) => v.isLatest) ?? null;
}

function daysUntilSunset(config: ApiVersionConfig, nowMs: number): number | null {
  if (!config.sunsetDate) return null;
  const diff = config.sunsetDate - nowMs;
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

function versionsBetween(from: ApiVersion, to: ApiVersion): ApiVersionConfig[] {
  const fromIdx = API_VERSIONS.findIndex((v) => v.version === from);
  const toIdx   = API_VERSIONS.findIndex((v) => v.version === to);
  if (fromIdx < 0 || toIdx < 0 || fromIdx >= toIdx) return [];
  return API_VERSIONS.slice(fromIdx + 1, toIdx + 1);
}

function migrationBreakingChanges(from: ApiVersion, to: ApiVersion): string[] {
  return versionsBetween(from, to).flatMap((v) => v.breakingChanges);
}

const NOW = 1_700_000_000_000;

describe("API versioning and deprecation", () => {
  it("isDeprecated: v1 past deprecation date → true", () => {
    expect(isDeprecated(API_VERSIONS[0], NOW)).toBe(true);
  });

  it("isDeprecated: v4 no deprecation → false", () => {
    expect(isDeprecated(API_VERSIONS[3], NOW)).toBe(false);
  });

  it("isSunset: v1 past sunset → true", () => {
    expect(isSunset(API_VERSIONS[0], NOW)).toBe(true);
  });

  it("latestVersion: returns v4", () => {
    expect(latestVersion()?.version).toBe("v4");
  });

  it("migrationBreakingChanges: v1→v4 lists all breaking changes", () => {
    const changes = migrationBreakingChanges("v1", "v4");
    expect(changes).toContain("Removed legacy auth");
    expect(changes).toContain("New pagination model");
  });

  it("versionsBetween: v2→v4 returns v3 and v4", () => {
    const versions = versionsBetween("v2", "v4");
    expect(versions.map((v) => v.version)).toContain("v3");
    expect(versions.map((v) => v.version)).toContain("v4");
  });
});
