/**
 * Tests for split payment among multiple payers for a booking.
 */

interface PaymentSplitRequest {
  bookingId: string;
  totalCents: number;
  payers: { userId: string; sharePct: number }[];
}

interface PayerAmount {
  userId: string;
  amountCents: number;
}

function validateSplit(request: PaymentSplitRequest): boolean {
  const total = request.payers.reduce((sum, p) => sum + p.sharePct, 0);
  return Math.abs(total - 100) < 0.01;
}

function calculatePayerAmounts(request: PaymentSplitRequest): PayerAmount[] {
  if (!validateSplit(request)) throw new Error("Split percentages must sum to 100");
  const amounts = request.payers.map((p, i) => ({
    userId: p.userId,
    amountCents: Math.floor(request.totalCents * (p.sharePct / 100)),
  }));
  // Add remainder to first payer to handle rounding
  const sumSoFar = amounts.reduce((s, a) => s + a.amountCents, 0);
  const remainder = request.totalCents - sumSoFar;
  if (remainder > 0) amounts[0].amountCents += remainder;
  return amounts;
}

function totalFromPayerAmounts(amounts: PayerAmount[]): number {
  return amounts.reduce((sum, a) => sum + a.amountCents, 0);
}

describe("Booking payment split", () => {
  const EQUAL_SPLIT: PaymentSplitRequest = {
    bookingId: "b1",
    totalCents: 3000,
    payers: [
      { userId: "u1", sharePct: 50 },
      { userId: "u2", sharePct: 50 },
    ],
  };

  const UNEQUAL_SPLIT: PaymentSplitRequest = {
    bookingId: "b2",
    totalCents: 3001,
    payers: [
      { userId: "u1", sharePct: 33.33 },
      { userId: "u2", sharePct: 33.33 },
      { userId: "u3", sharePct: 33.34 },
    ],
  };

  it("validateSplit: equal 50/50 → valid", () => {
    expect(validateSplit(EQUAL_SPLIT)).toBe(true);
  });

  it("validateSplit: 60/30 (not 100) → invalid", () => {
    const bad: PaymentSplitRequest = {
      ...EQUAL_SPLIT,
      payers: [{ userId: "u1", sharePct: 60 }, { userId: "u2", sharePct: 30 }],
    };
    expect(validateSplit(bad)).toBe(false);
  });

  it("calculatePayerAmounts: equal split = 1500 each", () => {
    const amounts = calculatePayerAmounts(EQUAL_SPLIT);
    expect(amounts[0].amountCents).toBe(1500);
    expect(amounts[1].amountCents).toBe(1500);
  });

  it("calculatePayerAmounts: total equals booking total", () => {
    const amounts = calculatePayerAmounts(UNEQUAL_SPLIT);
    expect(totalFromPayerAmounts(amounts)).toBe(3001);
  });

  it("calculatePayerAmounts: remainder goes to first payer", () => {
    const amounts = calculatePayerAmounts(UNEQUAL_SPLIT);
    expect(amounts[0].amountCents).toBeGreaterThan(amounts[1].amountCents);
  });

  it("calculatePayerAmounts: throws on invalid split", () => {
    const bad: PaymentSplitRequest = {
      ...EQUAL_SPLIT,
      payers: [{ userId: "u1", sharePct: 60 }, { userId: "u2", sharePct: 30 }],
    };
    expect(() => calculatePayerAmounts(bad)).toThrow();
  });

  it("totalFromPayerAmounts: sums amounts", () => {
    const amounts: PayerAmount[] = [{ userId: "u1", amountCents: 1500 }, { userId: "u2", amountCents: 1500 }];
    expect(totalFromPayerAmounts(amounts)).toBe(3000);
  });
});
