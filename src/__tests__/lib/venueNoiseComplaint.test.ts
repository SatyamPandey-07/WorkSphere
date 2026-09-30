/**
 * Tests for venue noise complaint aggregation.
 */

interface NoiseComplaint {
  venueId: string;
  reportedBy: string;
  decibels?: number;
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
  resolvedAt?: number;
}

function openComplaints(complaints: NoiseComplaint[]): NoiseComplaint[] {
  return complaints.filter((c) => !c.resolvedAt);
}

function complaintsByTimeOfDay(
  complaints: NoiseComplaint[],
  timeOfDay: NoiseComplaint["timeOfDay"]
): NoiseComplaint[] {
  return complaints.filter((c) => c.timeOfDay === timeOfDay);
}

function averageDecibels(complaints: NoiseComplaint[]): number {
  const withDb = complaints.filter((c) => c.decibels !== undefined);
  if (withDb.length === 0) return 0;
  return withDb.reduce((sum, c) => sum + (c.decibels ?? 0), 0) / withDb.length;
}

function resolveComplaint(
  complaint: NoiseComplaint,
  nowMs: number
): NoiseComplaint {
  return { ...complaint, resolvedAt: nowMs };
}

const NOW = 1_700_000_000_000;
const COMPLAINTS: NoiseComplaint[] = [
  { venueId: "v1", reportedBy: "u1", decibels: 80, timeOfDay: "evening" },
  { venueId: "v1", reportedBy: "u2", decibels: 90, timeOfDay: "night",   resolvedAt: NOW - 3600 },
  { venueId: "v1", reportedBy: "u3",               timeOfDay: "evening" },
];

describe("Venue noise complaints", () => {
  it("openComplaints returns unresolved only", () => {
    expect(openComplaints(COMPLAINTS)).toHaveLength(2);
  });

  it("complaintsByTimeOfDay: evening", () => {
    expect(complaintsByTimeOfDay(COMPLAINTS, "evening")).toHaveLength(2);
  });

  it("complaintsByTimeOfDay: morning → 0", () => {
    expect(complaintsByTimeOfDay(COMPLAINTS, "morning")).toHaveLength(0);
  });

  it("averageDecibels ignores undefined", () => {
    expect(averageDecibels(COMPLAINTS)).toBe(85); // (80+90)/2
  });

  it("averageDecibels empty → 0", () => {
    expect(averageDecibels([])).toBe(0);
  });

  it("averageDecibels all undefined → 0", () => {
    expect(averageDecibels([COMPLAINTS[2]])).toBe(0);
  });

  it("resolveComplaint sets resolvedAt", () => {
    const resolved = resolveComplaint(COMPLAINTS[0], NOW);
    expect(resolved.resolvedAt).toBe(NOW);
  });

  it("resolveComplaint is immutable", () => {
    resolveComplaint(COMPLAINTS[0], NOW);
    expect(COMPLAINTS[0].resolvedAt).toBeUndefined();
  });
});
