/**
 * Tests for workspace resource usage tracking (printing, parking, etc.).
 */

type ResourceType = "printing" | "parking" | "phone_booth" | "conference_room";

interface ResourceUsage {
  id: string;
  userId: string;
  venueId: string;
  resourceType: ResourceType;
  startMs: number;
  endMs: number | null;
  unitCostCents: number; // per minute
}

function isActive(usage: ResourceUsage, nowMs: number): boolean {
  return usage.endMs === null || nowMs < usage.endMs;
}

function usageDurationMinutes(usage: ResourceUsage, nowMs: number): number {
  const end = usage.endMs ?? nowMs;
  return Math.ceil((end - usage.startMs) / 60_000);
}

function usageCost(usage: ResourceUsage, nowMs: number): number {
  return usageDurationMinutes(usage, nowMs) * usage.unitCostCents;
}

function totalCostForUser(
  usages: ResourceUsage[],
  userId: string,
  nowMs: number
): number {
  return usages
    .filter((u) => u.userId === userId)
    .reduce((sum, u) => sum + usageCost(u, nowMs), 0);
}

const NOW = 1_700_000_000_000;
const USAGES: ResourceUsage[] = [
  { id: "u1", userId: "alice", venueId: "v1", resourceType: "printing",   startMs: NOW - 120_000, endMs: NOW - 60_000,  unitCostCents: 5  },
  { id: "u2", userId: "alice", venueId: "v1", resourceType: "phone_booth",startMs: NOW - 300_000, endMs: null,          unitCostCents: 10 },
  { id: "u3", userId: "bob",   venueId: "v1", resourceType: "parking",    startMs: NOW - 60_000,  endMs: NOW,           unitCostCents: 20 },
];

describe("Resource usage tracking", () => {
  it("isActive: ongoing usage (null endMs)", () => {
    expect(isActive(USAGES[1], NOW)).toBe(true);
  });

  it("isActive: completed usage", () => {
    expect(isActive(USAGES[0], NOW)).toBe(false);
  });

  it("usageDurationMinutes: 60s = 1 minute", () => {
    expect(usageDurationMinutes(USAGES[0], NOW)).toBe(1);
  });

  it("usageDurationMinutes: ongoing uses nowMs", () => {
    expect(usageDurationMinutes(USAGES[1], NOW)).toBe(5);
  });

  it("usageCost: printing 1min × 5 cents = 5", () => {
    expect(usageCost(USAGES[0], NOW)).toBe(5);
  });

  it("usageCost: phone_booth 5min × 10 cents = 50", () => {
    expect(usageCost(USAGES[1], NOW)).toBe(50);
  });

  it("totalCostForUser: alice = 5 + 50 = 55", () => {
    expect(totalCostForUser(USAGES, "alice", NOW)).toBe(55);
  });

  it("totalCostForUser: unknown user → 0", () => {
    expect(totalCostForUser(USAGES, "unknown", NOW)).toBe(0);
  });
});
