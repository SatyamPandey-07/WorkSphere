/**
 * Tests for venue availability calendar date blocking logic.
 */

type DateStr = string; // YYYY-MM-DD

interface BlockedPeriod {
  venueId: string;
  startDate: DateStr;
  endDate: DateStr; // inclusive
  reason: "maintenance" | "private_event" | "holiday" | "owner_block";
}

function isDateBlocked(
  date: DateStr,
  venueId: string,
  blockedPeriods: BlockedPeriod[]
): boolean {
  return blockedPeriods
    .filter((p) => p.venueId === venueId)
    .some((p) => date >= p.startDate && date <= p.endDate);
}

function blockingReason(
  date: DateStr,
  venueId: string,
  blockedPeriods: BlockedPeriod[]
): BlockedPeriod["reason"] | null {
  const match = blockedPeriods
    .filter((p) => p.venueId === venueId)
    .find((p) => date >= p.startDate && date <= p.endDate);
  return match ? match.reason : null;
}

function availableDates(
  dates: DateStr[],
  venueId: string,
  blockedPeriods: BlockedPeriod[]
): DateStr[] {
  return dates.filter((d) => !isDateBlocked(d, venueId, blockedPeriods));
}

const PERIODS: BlockedPeriod[] = [
  { venueId: "v1", startDate: "2026-10-01", endDate: "2026-10-05", reason: "maintenance"   },
  { venueId: "v1", startDate: "2026-10-15", endDate: "2026-10-15", reason: "holiday"       },
  { venueId: "v2", startDate: "2026-10-01", endDate: "2026-10-31", reason: "private_event" },
];

describe("Venue availability calendar", () => {
  it("date within blocked period → blocked", () => {
    expect(isDateBlocked("2026-10-03", "v1", PERIODS)).toBe(true);
  });

  it("date outside blocked period → not blocked", () => {
    expect(isDateBlocked("2026-10-10", "v1", PERIODS)).toBe(false);
  });

  it("boundary: first day of block → blocked", () => {
    expect(isDateBlocked("2026-10-01", "v1", PERIODS)).toBe(true);
  });

  it("boundary: last day of block → blocked", () => {
    expect(isDateBlocked("2026-10-05", "v1", PERIODS)).toBe(true);
  });

  it("different venue → not blocked", () => {
    expect(isDateBlocked("2026-10-03", "v3", PERIODS)).toBe(false);
  });

  it("blockingReason returns correct reason", () => {
    expect(blockingReason("2026-10-03", "v1", PERIODS)).toBe("maintenance");
  });

  it("blockingReason returns null for unblocked date", () => {
    expect(blockingReason("2026-10-10", "v1", PERIODS)).toBeNull();
  });

  it("availableDates filters out blocked dates", () => {
    const dates = ["2026-10-01", "2026-10-06", "2026-10-10", "2026-10-15"];
    const available = availableDates(dates, "v1", PERIODS);
    expect(available).toEqual(["2026-10-06", "2026-10-10"]);
  });
});
