/**
 * Tests for booking loyalty cashback calculation.
 */

interface CashbackProgram {
  programId: string;
  cashbackPct: number;        // % of booking returned as credits
  minBookingCents: number;
  maxCashbackCents: number;   // cap per booking
  eligibleCategories: string[];
  requiresVerifiedAccount: boolean;
}

function calculateCashback(
  bookingCents: number,
  category: string,
  isVerified: boolean,
  program: CashbackProgram
): number {
  if (bookingCents < program.minBookingCents) return 0;
  if (!program.eligibleCategories.includes(category)) return 0;
  if (program.requiresVerifiedAccount && !isVerified) return 0;
  const raw = Math.round(bookingCents * (program.cashbackPct / 100));
  return Math.min(raw, program.maxCashbackCents);
}

function totalCashbackEarned(
  bookings: { amountCents: number; category: string; isVerified: boolean }[],
  program: CashbackProgram
): number {
  return bookings.reduce(
    (sum, b) => sum + calculateCashback(b.amountCents, b.category, b.isVerified, program),
    0
  );
}

function cashbackBreakdown(
  amountCents: number,
  program: CashbackProgram
): { gross: number; capped: boolean; net: number } {
  const gross = Math.round(amountCents * (program.cashbackPct / 100));
  const net = Math.min(gross, program.maxCashbackCents);
  return { gross, capped: net < gross, net };
}

const PROGRAM: CashbackProgram = {
  programId: "cb1", cashbackPct: 5, minBookingCents: 1000,
  maxCashbackCents: 500, eligibleCategories: ["cafe", "coworking"],
  requiresVerifiedAccount: true,
};

describe("Booking loyalty cashback", () => {
  it("calculateCashback: 5% of 5000 = 250", () => {
    expect(calculateCashback(5000, "cafe", true, PROGRAM)).toBe(250);
  });

  it("calculateCashback: below minimum → 0", () => {
    expect(calculateCashback(500, "cafe", true, PROGRAM)).toBe(0);
  });

  it("calculateCashback: wrong category → 0", () => {
    expect(calculateCashback(5000, "library", true, PROGRAM)).toBe(0);
  });

  it("calculateCashback: unverified account → 0", () => {
    expect(calculateCashback(5000, "cafe", false, PROGRAM)).toBe(0);
  });

  it("calculateCashback: capped at maxCashbackCents", () => {
    expect(calculateCashback(20_000, "cafe", true, PROGRAM)).toBe(500);
  });

  it("totalCashbackEarned: sum of eligible bookings", () => {
    const bookings = [
      { amountCents: 5000, category: "cafe", isVerified: true  },
      { amountCents: 3000, category: "library", isVerified: true }, // wrong category
      { amountCents: 8000, category: "coworking", isVerified: true },
    ];
    expect(totalCashbackEarned(bookings, PROGRAM)).toBe(250 + 0 + 400);
  });

  it("cashbackBreakdown: not capped", () => {
    const b = cashbackBreakdown(5000, PROGRAM);
    expect(b.capped).toBe(false);
    expect(b.net).toBe(250);
  });

  it("cashbackBreakdown: capped", () => {
    const b = cashbackBreakdown(20_000, PROGRAM);
    expect(b.capped).toBe(true);
    expect(b.net).toBe(500);
  });
});
