/**
 * Tests for venue desk assignment algorithm for permanent residents.
 */

interface Desk {
  deskId: string;
  zone: string;
  floor: number;
  hasMonitor: boolean;
  hasStanding: boolean;
  isWindow: boolean;
}

interface DeskPreference {
  preferZone?: string;
  preferFloor?: number;
  needsMonitor: boolean;
  needsStanding: boolean;
  prefersWindow: boolean;
}

function preferenceScore(desk: Desk, prefs: DeskPreference): number {
  let score = 0;
  if (prefs.preferZone && desk.zone === prefs.preferZone) score += 3;
  if (prefs.preferFloor !== undefined && desk.floor === prefs.preferFloor) score += 2;
  if (prefs.needsMonitor && desk.hasMonitor) score += 4;
  if (prefs.needsMonitor && !desk.hasMonitor) score -= 5; // penalty
  if (prefs.needsStanding && desk.hasStanding) score += 3;
  if (prefs.needsStanding && !desk.hasStanding) score -= 3;
  if (prefs.prefersWindow && desk.isWindow) score += 2;
  return score;
}

function bestDeskMatch(desks: Desk[], prefs: DeskPreference): Desk | null {
  if (desks.length === 0) return null;
  return desks.reduce((best, d) =>
    preferenceScore(d, prefs) > preferenceScore(best, prefs) ? d : best
  );
}

function filterEligibleDesks(desks: Desk[], prefs: DeskPreference): Desk[] {
  return desks.filter((d) => {
    if (prefs.needsMonitor && !d.hasMonitor) return false;
    if (prefs.needsStanding && !d.hasStanding) return false;
    return true;
  });
}

const DESKS: Desk[] = [
  { deskId: "d1", zone: "quiet",  floor: 1, hasMonitor: true,  hasStanding: false, isWindow: true  },
  { deskId: "d2", zone: "quiet",  floor: 2, hasMonitor: true,  hasStanding: true,  isWindow: false },
  { deskId: "d3", zone: "social", floor: 1, hasMonitor: false, hasStanding: false, isWindow: true  },
];

const PREFS: DeskPreference = {
  preferZone: "quiet", preferFloor: 2,
  needsMonitor: true, needsStanding: true, prefersWindow: false,
};

describe("Venue desk assignment algorithm", () => {
  it("filterEligibleDesks: needsMonitor filters out d3", () => {
    const eligible = filterEligibleDesks(DESKS, PREFS);
    expect(eligible.map((d) => d.deskId)).not.toContain("d3");
  });

  it("filterEligibleDesks: needsStanding filters out d1", () => {
    const eligible = filterEligibleDesks(DESKS, PREFS);
    expect(eligible.map((d) => d.deskId)).not.toContain("d1");
  });

  it("preferenceScore: d2 scores higher than d1 for PREFS", () => {
    expect(preferenceScore(DESKS[1], PREFS)).toBeGreaterThan(preferenceScore(DESKS[0], PREFS));
  });

  it("bestDeskMatch: picks d2 for PREFS", () => {
    const eligible = filterEligibleDesks(DESKS, PREFS);
    expect(bestDeskMatch(eligible, PREFS)!.deskId).toBe("d2");
  });

  it("bestDeskMatch: empty desks → null", () => {
    expect(bestDeskMatch([], PREFS)).toBeNull();
  });

  it("preferenceScore: penalty for missing monitor", () => {
    const needsMonitor: DeskPreference = { needsMonitor: true, needsStanding: false, prefersWindow: false };
    expect(preferenceScore(DESKS[2], needsMonitor)).toBeLessThan(0);
  });
});
