/**
 * Tests for venue booking split payment management.
 */

interface PaymentSplit {
  participantId: string;
  share: number;        // 0-1 (fraction of total)
  amountDue: number;
  amountPaid: number;
  status: "pending" | "paid" | "overdue" | "waived";
}

interface SplitBooking {
  bookingId: string;
  totalAmount: number;
  splits: PaymentSplit[];
  currency: string;
}

function totalSplitShares(booking: SplitBooking): number {
  return Math.round(booking.splits.reduce((s, p) => s + p.share, 0) * 100) / 100;
}

function isSplitBalanced(booking: SplitBooking): boolean {
  return Math.abs(totalSplitShares(booking) - 1) < 0.001;
}

function totalCollected(booking: SplitBooking): number {
  return Math.round(booking.splits.reduce((s, p) => s + p.amountPaid, 0) * 100) / 100;
}

function outstandingAmount(booking: SplitBooking): number {
  return Math.round((booking.totalAmount - totalCollected(booking)) * 100) / 100;
}

function overdueSplits(booking: SplitBooking): PaymentSplit[] {
  return booking.splits.filter((p) => p.status === "overdue");
}

function splitStatus(booking: SplitBooking): "fully_paid" | "partial" | "unpaid" {
  const collected = totalCollected(booking);
  if (collected >= booking.totalAmount) return "fully_paid";
  if (collected > 0) return "partial";
  return "unpaid";
}

function perPersonAmount(booking: SplitBooking, equalSplit = true): number {
  if (equalSplit && booking.splits.length > 0) {
    return Math.round((booking.totalAmount / booking.splits.length) * 100) / 100;
  }
  return 0;
}

const BOOKING: SplitBooking = {
  bookingId: "b1", totalAmount: 900, currency: "USD",
  splits: [
    { participantId: "p1", share: 0.5,  amountDue: 450, amountPaid: 450, status: "paid" },
    { participantId: "p2", share: 0.33, amountDue: 297, amountPaid: 150, status: "overdue" },
    { participantId: "p3", share: 0.17, amountDue: 153, amountPaid: 0,   status: "pending" },
  ],
};

describe("Split payment management", () => {
  it("totalSplitShares: 0.5+0.33+0.17 ≈ 1.0", () => {
    expect(totalSplitShares(BOOKING)).toBe(1);
  });

  it("isSplitBalanced: shares sum to 1 → true", () => {
    expect(isSplitBalanced(BOOKING)).toBe(true);
  });

  it("totalCollected: $450 + $150 = $600", () => {
    expect(totalCollected(BOOKING)).toBe(600);
  });

  it("outstandingAmount: $900 - $600 = $300", () => {
    expect(outstandingAmount(BOOKING)).toBe(300);
  });

  it("overdueSplits: p2 is overdue", () => {
    expect(overdueSplits(BOOKING).map((p) => p.participantId)).toContain("p2");
  });

  it("splitStatus: partial payment", () => {
    expect(splitStatus(BOOKING)).toBe("partial");
  });

  it("perPersonAmount: $900 / 3 = $300", () => {
    expect(perPersonAmount(BOOKING)).toBe(300);
  });
});
