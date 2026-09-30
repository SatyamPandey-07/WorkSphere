/**
 * Tests for AI-powered smart cleaning schedule optimization.
 */

interface CleaningNeed {
  zoneId: string;
  currentDirtScore: number;  // 0-100 (100 = very dirty)
  lastCleanedAt: number;
  usageIntensity: number;    // bookings per day
  priority: "low" | "normal" | "high" | "emergency";
}

function urgencyScore(need: CleaningNeed, nowMs: number): number {
  const hoursSinceClean = (nowMs - need.lastCleanedAt) / 3_600_000;
  const base = need.currentDirtScore;
  const timeBonus = Math.min(hoursSinceClean * 2, 40);
  const intensityBonus = need.usageIntensity * 3;
  const priorityBonus = { low: 0, normal: 10, high: 25, emergency: 50 }[need.priority];
  return Math.min(100, Math.round(base * 0.4 + timeBonus + intensityBonus + priorityBonus));
}

function sortByUrgency(needs: CleaningNeed[], nowMs: number): CleaningNeed[] {
  return [...needs].sort((a, b) => urgencyScore(b, nowMs) - urgencyScore(a, nowMs));
}

function scheduledCleaningWindows(
  needs: CleaningNeed[],
  nowMs: number,
  windowHours = 4
): { zoneId: string; scheduledAt: number }[] {
  const sorted = sortByUrgency(needs, nowMs);
  return sorted.map((need, idx) => ({
    zoneId: need.zoneId,
    scheduledAt: nowMs + idx * (windowHours / sorted.length) * 3_600_000,
  }));
}

function needsEmergencyCleaning(need: CleaningNeed, nowMs: number, threshold = 85): boolean {
  return urgencyScore(need, nowMs) >= threshold || need.priority === "emergency";
}

const NOW = 1_700_000_000_000;
const NEEDS: CleaningNeed[] = [
  { zoneId: "z1", currentDirtScore: 40, lastCleanedAt: NOW - 6 * 3600_000, usageIntensity: 5, priority: "normal" },
  { zoneId: "z2", currentDirtScore: 80, lastCleanedAt: NOW - 12 * 3600_000, usageIntensity: 8, priority: "high"   },
  { zoneId: "z3", currentDirtScore: 20, lastCleanedAt: NOW - 2 * 3600_000,  usageIntensity: 2, priority: "low"    },
];

describe("Smart cleaning schedule optimizer", () => {
  it("urgencyScore: high dirt + long time → high score", () => {
    expect(urgencyScore(NEEDS[1], NOW)).toBeGreaterThan(urgencyScore(NEEDS[2], NOW));
  });

  it("sortByUrgency: z2 (high priority + dirty) first", () => {
    const sorted = sortByUrgency(NEEDS, NOW);
    expect(sorted[0].zoneId).toBe("z2");
  });

  it("sortByUrgency: z3 (low + clean) last", () => {
    const sorted = sortByUrgency(NEEDS, NOW);
    expect(sorted[sorted.length - 1].zoneId).toBe("z3");
  });

  it("scheduledCleaningWindows: returns one entry per zone", () => {
    const schedule = scheduledCleaningWindows(NEEDS, NOW);
    expect(schedule).toHaveLength(3);
  });

  it("scheduledCleaningWindows: first starts at nowMs", () => {
    const schedule = scheduledCleaningWindows(NEEDS, NOW);
    expect(schedule[0].scheduledAt).toBe(NOW);
  });

  it("needsEmergencyCleaning: emergency priority → true", () => {
    const emergency = { ...NEEDS[0], priority: "emergency" as const };
    expect(needsEmergencyCleaning(emergency, NOW)).toBe(true);
  });

  it("needsEmergencyCleaning: clean zone → false", () => {
    expect(needsEmergencyCleaning(NEEDS[2], NOW)).toBe(false);
  });
});
