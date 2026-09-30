/**
 * Tests for booking time credit system (unused hours rollover).
 */

interface TimeCredit {
  creditId: string;
  userId: string;
  venueId: string;
  hoursRemaining: number;
  expiresAt: string;  // YYYY-MM-DD
  sourceBookingId: string;
  type: "unused_hours" | "cancellation_credit" | "promotional";
}

function totalCreditsForVenue(credits: TimeCredit[], userId: string, venueId: string, todayStr: string): number {
  return credits
    .filter((c) => c.userId === userId && c.venueId === venueId && c.expiresAt >= todayStr)
    .reduce((sum, c) => sum + c.hoursRemaining, 0);
}

function applicableCredits(
  credits: TimeCredit[],
  userId: string,
  venueId: string,
  requiredHours: number,
  todayStr: string
): TimeCredit[] {
  const available = credits
    .filter((c) => c.userId === userId && c.venueId === venueId && c.expiresAt >= todayStr && c.hoursRemaining > 0)
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)); // use expiring first

  let remaining = requiredHours;
  const result: TimeCredit[] = [];
  for (const credit of available) {
    if (remaining <= 0) break;
    result.push(credit);
    remaining -= credit.hoursRemaining;
  }
  return result;
}

function applyTimeCredits(
  credits: TimeCredit[],
  userId: string,
  venueId: string,
  bookingHours: number,
  bookingRateCentsPerHour: number,
  todayStr: string
): { finalCostCents: number; usedCredits: TimeCredit[]; remainingHoursNeeded: number } {
  const applicable = applicableCredits(credits, userId, venueId, bookingHours, todayStr);
  const totalCreditHours = applicable.reduce((s, c) => s + c.hoursRemaining, 0);
  const creditHoursUsed = Math.min(totalCreditHours, bookingHours);
  const paidHours = bookingHours - creditHoursUsed;

  return {
    finalCostCents: paidHours * bookingRateCentsPerHour,
    usedCredits: applicable,
    remainingHoursNeeded: paidHours,
  };
}

const CREDITS: TimeCredit[] = [
  { creditId: "c1", userId: "u1", venueId: "v1", hoursRemaining: 2, expiresAt: "2026-12-31", sourceBookingId: "b1", type: "unused_hours" },
  { creditId: "c2", userId: "u1", venueId: "v1", hoursRemaining: 3, expiresAt: "2027-06-30", sourceBookingId: "b2", type: "cancellation_credit" },
  { creditId: "c3", userId: "u2", venueId: "v1", hoursRemaining: 5, expiresAt: "2026-11-30", sourceBookingId: "b3", type: "promotional" },
];

describe("Venue booking time credits", () => {
  it("totalCreditsForVenue: u1 at v1 = 5h", () => {
    expect(totalCreditsForVenue(CREDITS, "u1", "v1", "2026-10-01")).toBe(5);
  });

  it("totalCreditsForVenue: expired credits excluded", () => {
    expect(totalCreditsForVenue(CREDITS, "u1", "v1", "2027-01-01")).toBe(3); // c1 expired
  });

  it("applicableCredits: uses expiring first", () => {
    const applicable = applicableCredits(CREDITS, "u1", "v1", 2, "2026-10-01");
    expect(applicable[0].creditId).toBe("c1"); // expires sooner
  });

  it("applyTimeCredits: 3h booking, 2h credit → pay for 1h", () => {
    const result = applyTimeCredits(CREDITS, "u1", "v1", 3, 1000, "2026-10-01");
    expect(result.remainingHoursNeeded).toBe(1);
    expect(result.finalCostCents).toBe(1000);
  });

  it("applyTimeCredits: 1h booking with 2h credit → free (1h)", () => {
    const result = applyTimeCredits(CREDITS, "u1", "v1", 1, 1000, "2026-10-01");
    expect(result.finalCostCents).toBe(0);
  });
});
