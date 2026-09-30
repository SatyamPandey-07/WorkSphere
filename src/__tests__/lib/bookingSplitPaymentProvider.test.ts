/**
 * Tests for split payment processing across multiple payment providers.
 */

type PaymentProvider = "stripe" | "paypal" | "square" | "wallet";

interface PaymentSplit {
  providerId: PaymentProvider;
  amountCents: number;
  processingFeePct: number;
}

function processingFee(split: PaymentSplit): number {
  return Math.round(split.amountCents * (split.processingFeePct / 100));
}

function netAmount(split: PaymentSplit): number {
  return split.amountCents - processingFee(split);
}

function validateSplitTotal(splits: PaymentSplit[], expectedTotal: number): boolean {
  const total = splits.reduce((s, sp) => s + sp.amountCents, 0);
  return total === expectedTotal;
}

function cheapestProvider(splits: PaymentSplit[]): PaymentProvider | null {
  if (splits.length === 0) return null;
  return splits.reduce((min, sp) => sp.processingFeePct < min.processingFeePct ? sp : min).providerId;
}

function totalFeeCents(splits: PaymentSplit[]): number {
  return splits.reduce((s, sp) => s + processingFee(sp), 0);
}

const SPLITS: PaymentSplit[] = [
  { providerId: "stripe",  amountCents: 5000, processingFeePct: 2.9 },
  { providerId: "paypal",  amountCents: 3000, processingFeePct: 3.5 },
  { providerId: "wallet",  amountCents: 2000, processingFeePct: 0   },
];

describe("Split payment provider processing", () => {
  it("processingFee: stripe 2.9% of 5000 = 145", () => {
    expect(processingFee(SPLITS[0])).toBe(145);
  });

  it("processingFee: wallet 0% = 0", () => {
    expect(processingFee(SPLITS[2])).toBe(0);
  });

  it("netAmount: stripe 5000 - 145 = 4855", () => {
    expect(netAmount(SPLITS[0])).toBe(4855);
  });

  it("validateSplitTotal: 5000+3000+2000 = 10000", () => {
    expect(validateSplitTotal(SPLITS, 10_000)).toBe(true);
  });

  it("validateSplitTotal: wrong total → false", () => {
    expect(validateSplitTotal(SPLITS, 9_000)).toBe(false);
  });

  it("cheapestProvider: wallet (0% fee)", () => {
    expect(cheapestProvider(SPLITS)).toBe("wallet");
  });

  it("cheapestProvider: empty → null", () => {
    expect(cheapestProvider([])).toBeNull();
  });

  it("totalFeeCents: sum of all fees", () => {
    const total = totalFeeCents(SPLITS);
    expect(total).toBe(processingFee(SPLITS[0]) + processingFee(SPLITS[1]) + 0);
  });
});
