/**
 * Tests for venue waitlist analytics and demand signal.
 */

interface WaitlistSnapshot {
  date: string;
  venueId: string;
  waitlistSize: number;
  avgWaitHours: number;
  conversionRate: number; // % who got off waitlist and booked
}

function avgWaitlistSize(snapshots: WaitlistSnapshot[], venueId: string): number {
  const venue = snapshots.filter((s) => s.venueId === venueId);
  if (venue.length === 0) return 0;
  return Math.round(venue.reduce((s, snap) => s + snap.waitlistSize, 0) / venue.length);
}

function demandPressureScore(snapshot: WaitlistSnapshot): number {
  // higher waitlist + longer wait = more pressure
  const sizeScore = Math.min(snapshot.waitlistSize / 10, 10);
  const waitScore = Math.min(snapshot.avgWaitHours / 24, 10);
  return Math.round((sizeScore + waitScore) * 5);
}

function isPeakDemand(snapshot: WaitlistSnapshot, threshold = 70): boolean {
  return demandPressureScore(snapshot) >= threshold;
}

function waitlistTrend(
  snapshots: WaitlistSnapshot[],
  venueId: string
): "growing" | "stable" | "shrinking" {
  const venue = snapshots.filter((s) => s.venueId === venueId).sort((a, b) => a.date.localeCompare(b.date));
  if (venue.length < 2) return "stable";
  const recent = venue[venue.length - 1].waitlistSize;
  const previous = venue[venue.length - 2].waitlistSize;
  if (recent > previous * 1.1) return "growing";
  if (recent < previous * 0.9) return "shrinking";
  return "stable";
}

const SNAPSHOTS: WaitlistSnapshot[] = [
  { date: "2026-10-01", venueId: "v1", waitlistSize: 20, avgWaitHours: 12, conversionRate: 0.7 },
  { date: "2026-10-02", venueId: "v1", waitlistSize: 25, avgWaitHours: 18, conversionRate: 0.6 },
  { date: "2026-10-03", venueId: "v1", waitlistSize: 30, avgWaitHours: 24, conversionRate: 0.5 },
  { date: "2026-10-01", venueId: "v2", waitlistSize: 5,  avgWaitHours: 2,  conversionRate: 0.9 },
];

describe("Venue waitlist analytics", () => {
  it("avgWaitlistSize: v1 = (20+25+30)/3 = 25", () => {
    expect(avgWaitlistSize(SNAPSHOTS, "v1")).toBe(25);
  });

  it("avgWaitlistSize: unknown venue → 0", () => {
    expect(avgWaitlistSize(SNAPSHOTS, "v99")).toBe(0);
  });

  it("demandPressureScore: large waitlist + long wait = high", () => {
    expect(demandPressureScore(SNAPSHOTS[2])).toBeGreaterThan(60);
  });

  it("demandPressureScore: small waitlist + short wait = low", () => {
    expect(demandPressureScore(SNAPSHOTS[3])).toBeLessThan(20);
  });

  it("isPeakDemand: high pressure → true", () => {
    // snapshot with size 30, 24h wait
    expect(isPeakDemand(SNAPSHOTS[2], 50)).toBe(true);
  });

  it("waitlistTrend: v1 growing (20→25→30)", () => {
    expect(waitlistTrend(SNAPSHOTS, "v1")).toBe("growing");
  });

  it("waitlistTrend: single snapshot → stable", () => {
    expect(waitlistTrend([SNAPSHOTS[3]], "v2")).toBe("stable");
  });
});
