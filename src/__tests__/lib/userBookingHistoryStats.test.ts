/**
 * Tests for user booking history statistics calculation.
 */

interface BookingRecord {
  userId: string;
  venueId: string;
  durationHours: number;
  totalCents: number;
  status: "completed" | "cancelled" | "no_show";
  bookedAt: number;
}

function totalCompletedHours(records: BookingRecord[], userId: string): number {
  return records
    .filter((r) => r.userId === userId && r.status === "completed")
    .reduce((sum, r) => sum + r.durationHours, 0);
}

function totalSpentCents(records: BookingRecord[], userId: string): number {
  return records
    .filter((r) => r.userId === userId && r.status === "completed")
    .reduce((sum, r) => sum + r.totalCents, 0);
}

function cancellationRate(records: BookingRecord[], userId: string): number {
  const userRecords = records.filter((r) => r.userId === userId);
  if (userRecords.length === 0) return 0;
  const cancelled = userRecords.filter((r) => r.status === "cancelled").length;
  return Math.round((cancelled / userRecords.length) * 100);
}

function avgBookingDuration(records: BookingRecord[], userId: string): number {
  const completed = records.filter((r) => r.userId === userId && r.status === "completed");
  if (completed.length === 0) return 0;
  return completed.reduce((sum, r) => sum + r.durationHours, 0) / completed.length;
}

function uniqueVenuesBooked(records: BookingRecord[], userId: string): number {
  return new Set(
    records
      .filter((r) => r.userId === userId && r.status === "completed")
      .map((r) => r.venueId)
  ).size;
}

const NOW = 1_700_000_000_000;
const RECORDS: BookingRecord[] = [
  { userId: "u1", venueId: "v1", durationHours: 3, totalCents: 3000, status: "completed", bookedAt: NOW - 7200_000 },
  { userId: "u1", venueId: "v2", durationHours: 2, totalCents: 2000, status: "completed", bookedAt: NOW - 3600_000 },
  { userId: "u1", venueId: "v1", durationHours: 1, totalCents: 1000, status: "cancelled", bookedAt: NOW - 1800_000 },
  { userId: "u2", venueId: "v3", durationHours: 4, totalCents: 4000, status: "completed", bookedAt: NOW - 900_000  },
];

describe("User booking history stats", () => {
  it("totalCompletedHours: u1 = 3+2 = 5", () => {
    expect(totalCompletedHours(RECORDS, "u1")).toBe(5);
  });

  it("totalSpentCents: u1 completed = 5000", () => {
    expect(totalSpentCents(RECORDS, "u1")).toBe(5000);
  });

  it("cancellationRate: u1 has 1/3 = 33%", () => {
    expect(cancellationRate(RECORDS, "u1")).toBe(33);
  });

  it("cancellationRate: unknown user → 0", () => {
    expect(cancellationRate(RECORDS, "u99")).toBe(0);
  });

  it("avgBookingDuration: u1 completed = (3+2)/2 = 2.5", () => {
    expect(avgBookingDuration(RECORDS, "u1")).toBe(2.5);
  });

  it("avgBookingDuration: no completed → 0", () => {
    const onlyCancelled = [RECORDS[2]];
    expect(avgBookingDuration(onlyCancelled, "u1")).toBe(0);
  });

  it("uniqueVenuesBooked: u1 completed at v1, v2 = 2", () => {
    expect(uniqueVenuesBooked(RECORDS, "u1")).toBe(2);
  });

  it("uniqueVenuesBooked: u2 = 1", () => {
    expect(uniqueVenuesBooked(RECORDS, "u2")).toBe(1);
  });
});
