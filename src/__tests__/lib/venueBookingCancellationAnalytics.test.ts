/**
 * Tests for venue booking cancellation pattern analytics.
 */

interface CancellationRecord {
  bookingId: string;
  venueId: string;
  userId: string;
  bookingDate: string;
  cancelledAt: number;
  bookingStartMs: number;
  reason: "change_of_plans" | "found_alternative" | "price" | "no_reason" | "technical_issue";
  hoursBeforeStart: number;
  totalCents: number;
}

function cancellationReasonBreakdown(
  records: CancellationRecord[],
  venueId: string
): Record<string, number> {
  const breakdown: Record<string, number> = {};
  records.filter((r) => r.venueId === venueId).forEach((r) => {
    breakdown[r.reason] = (breakdown[r.reason] ?? 0) + 1;
  });
  return breakdown;
}

function avgCancellationNoticeHours(records: CancellationRecord[], venueId: string): number {
  const venue = records.filter((r) => r.venueId === venueId);
  if (venue.length === 0) return 0;
  return Math.round(venue.reduce((s, r) => s + r.hoursBeforeStart, 0) / venue.length);
}

function lateCancellationRate(records: CancellationRecord[], venueId: string, thresholdHours = 24): number {
  const venue = records.filter((r) => r.venueId === venueId);
  if (venue.length === 0) return 0;
  const late = venue.filter((r) => r.hoursBeforeStart < thresholdHours).length;
  return Math.round((late / venue.length) * 100);
}

function revenueAtRisk(records: CancellationRecord[], venueId: string, thresholdHours = 12): number {
  return records
    .filter((r) => r.venueId === venueId && r.hoursBeforeStart < thresholdHours)
    .reduce((sum, r) => sum + r.totalCents, 0);
}

const RECORDS: CancellationRecord[] = [
  { bookingId: "b1", venueId: "v1", userId: "u1", bookingDate: "2026-10-01", cancelledAt: 1700000000, bookingStartMs: 1700000000 + 48 * 3600_000, reason: "change_of_plans", hoursBeforeStart: 48, totalCents: 2000 },
  { bookingId: "b2", venueId: "v1", userId: "u2", bookingDate: "2026-10-02", cancelledAt: 1700000000, bookingStartMs: 1700000000 + 8 * 3600_000,  reason: "price",          hoursBeforeStart: 8,  totalCents: 3000 },
  { bookingId: "b3", venueId: "v1", userId: "u3", bookingDate: "2026-10-03", cancelledAt: 1700000000, bookingStartMs: 1700000000 + 2 * 3600_000,  reason: "found_alternative",hoursBeforeStart: 2,  totalCents: 1500 },
];

describe("Venue booking cancellation analytics", () => {
  it("cancellationReasonBreakdown: counts per reason", () => {
    const breakdown = cancellationReasonBreakdown(RECORDS, "v1");
    expect(breakdown.change_of_plans).toBe(1);
    expect(breakdown.price).toBe(1);
  });

  it("avgCancellationNoticeHours: (48+8+2)/3 ≈ 19h", () => {
    expect(avgCancellationNoticeHours(RECORDS, "v1")).toBeCloseTo(19, 0);
  });

  it("lateCancellationRate: 2 of 3 cancelled < 24h = 67%", () => {
    expect(lateCancellationRate(RECORDS, "v1")).toBe(67);
  });

  it("lateCancellationRate: unknown venue → 0", () => {
    expect(lateCancellationRate(RECORDS, "v99")).toBe(0);
  });

  it("revenueAtRisk: cancelled < 12h = b3 (2h) = 1500 cents", () => {
    expect(revenueAtRisk(RECORDS, "v1", 12)).toBe(1500);
  });

  it("revenueAtRisk: with 48h threshold → all 3 = 6500", () => {
    expect(revenueAtRisk(RECORDS, "v1", 48)).toBe(6500);
  });
});
