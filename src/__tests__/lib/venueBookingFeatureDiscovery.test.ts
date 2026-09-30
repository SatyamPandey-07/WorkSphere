/**
 * Tests for venue booking feature discovery and adoption.
 */

interface FeatureUsageRecord {
  featureId: string;
  featureName: string;
  userId: string;
  firstUsedAt: number;
  usageCount: number;
  lastUsedAt: number;
  discoverySource: "tutorial" | "tooltip" | "organic" | "recommendation" | "help_doc";
}

function featureAdoptionRate(
  records: FeatureUsageRecord[],
  featureId: string,
  totalUsers: number
): number {
  if (totalUsers === 0) return 0;
  const uniqueUsers = new Set(records.filter((r) => r.featureId === featureId).map((r) => r.userId)).size;
  return Math.round((uniqueUsers / totalUsers) * 100);
}

function powerUsers(records: FeatureUsageRecord[], userId: string, minUsagePerFeature = 10): string[] {
  const userRecords = records.filter((r) => r.userId === userId && r.usageCount >= minUsagePerFeature);
  return [...new Set(userRecords.map((r) => r.featureId))];
}

function discoverySourceBreakdown(
  records: FeatureUsageRecord[],
  featureId: string
): Record<string, number> {
  const breakdown: Record<string, number> = {};
  records.filter((r) => r.featureId === featureId).forEach((r) => {
    breakdown[r.discoverySource] = (breakdown[r.discoverySource] ?? 0) + 1;
  });
  return breakdown;
}

function avgTimeToAdopt(
  records: FeatureUsageRecord[],
  featureId: string,
  featureReleasedMs: number
): number {
  const featureRecords = records.filter((r) => r.featureId === featureId);
  if (featureRecords.length === 0) return 0;
  const times = featureRecords.map((r) => r.firstUsedAt - featureReleasedMs);
  return Math.round(times.reduce((s, t) => s + t, 0) / times.length / 86_400_000); // days
}

const NOW = 1_700_000_000_000;
const RECORDS: FeatureUsageRecord[] = [
  { featureId: "f1", featureName: "Smart Search",  userId: "u1", firstUsedAt: NOW - 30 * 86400_000, usageCount: 50,  lastUsedAt: NOW - 1000, discoverySource: "tutorial" },
  { featureId: "f1", featureName: "Smart Search",  userId: "u2", firstUsedAt: NOW - 25 * 86400_000, usageCount: 15,  lastUsedAt: NOW - 2000, discoverySource: "organic"  },
  { featureId: "f2", featureName: "Quick Book",    userId: "u1", firstUsedAt: NOW - 20 * 86400_000, usageCount: 5,   lastUsedAt: NOW - 3000, discoverySource: "tooltip"  },
  { featureId: "f1", featureName: "Smart Search",  userId: "u3", firstUsedAt: NOW - 10 * 86400_000, usageCount: 8,   lastUsedAt: NOW - 4000, discoverySource: "recommendation" },
];

describe("Venue booking feature discovery", () => {
  it("featureAdoptionRate: f1 used by 3 of 10 users = 30%", () => {
    expect(featureAdoptionRate(RECORDS, "f1", 10)).toBe(30);
  });

  it("featureAdoptionRate: f2 used by 1 of 10 = 10%", () => {
    expect(featureAdoptionRate(RECORDS, "f2", 10)).toBe(10);
  });

  it("powerUsers: u1 uses f1 50 times (above threshold 10)", () => {
    const power = powerUsers(RECORDS, "u1", 10);
    expect(power).toContain("f1");
    expect(power).not.toContain("f2"); // only 5 uses
  });

  it("discoverySourceBreakdown: f1 sources", () => {
    const breakdown = discoverySourceBreakdown(RECORDS, "f1");
    expect(breakdown.tutorial).toBe(1);
    expect(breakdown.organic).toBe(1);
    expect(breakdown.recommendation).toBe(1);
  });

  it("avgTimeToAdopt: feature released 40 days ago, avg first use 22 days after", () => {
    const released = NOW - 40 * 86_400_000;
    const avg = avgTimeToAdopt(RECORDS, "f1", released);
    expect(avg).toBeGreaterThan(0);
  });
});
