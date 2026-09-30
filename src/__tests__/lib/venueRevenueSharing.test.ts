/**
 * Tests for venue-platform revenue sharing calculation.
 */

interface RevenueShareConfig {
  venueId: string;
  platformFeePercent: number;   // platform takes this %
  processingFeePercent: number; // payment processing fee
  taxPercent: number;           // applicable tax
}

function platformFee(grossCents: number, config: RevenueShareConfig): number {
  return Math.round(grossCents * (config.platformFeePercent / 100));
}

function processingFee(grossCents: number, config: RevenueShareConfig): number {
  return Math.round(grossCents * (config.processingFeePercent / 100));
}

function taxAmount(grossCents: number, config: RevenueShareConfig): number {
  return Math.round(grossCents * (config.taxPercent / 100));
}

function venueNetPayout(grossCents: number, config: RevenueShareConfig): number {
  return Math.max(
    0,
    grossCents -
      platformFee(grossCents, config) -
      processingFee(grossCents, config) -
      taxAmount(grossCents, config)
  );
}

function payoutSummary(grossCents: number, config: RevenueShareConfig) {
  const platform = platformFee(grossCents, config);
  const processing = processingFee(grossCents, config);
  const tax = taxAmount(grossCents, config);
  const net = grossCents - platform - processing - tax;
  return {
    gross: grossCents,
    platformFee: platform,
    processingFee: processing,
    taxAmount: tax,
    venueNet: Math.max(0, net),
    checksum: platform + processing + tax + Math.max(0, net),
  };
}

const CONFIG: RevenueShareConfig = {
  venueId: "v1",
  platformFeePercent: 10,
  processingFeePercent: 2.9,
  taxPercent: 20,
};

describe("Venue revenue sharing", () => {
  it("platformFee: 10% of 10000 = 1000", () => {
    expect(platformFee(10_000, CONFIG)).toBe(1000);
  });

  it("processingFee: 2.9% of 10000 = 290", () => {
    expect(processingFee(10_000, CONFIG)).toBe(290);
  });

  it("taxAmount: 20% of 10000 = 2000", () => {
    expect(taxAmount(10_000, CONFIG)).toBe(2000);
  });

  it("venueNetPayout: 10000 - 1000 - 290 - 2000 = 6710", () => {
    expect(venueNetPayout(10_000, CONFIG)).toBe(6710);
  });

  it("venueNetPayout: clamps to 0 for very high fees", () => {
    const highFees = { ...CONFIG, platformFeePercent: 80, taxPercent: 30 };
    expect(venueNetPayout(10_000, highFees)).toBe(0);
  });

  it("payoutSummary: checksum equals gross", () => {
    const summary = payoutSummary(10_000, CONFIG);
    expect(summary.checksum).toBe(10_000);
  });

  it("payoutSummary: venueNet = gross - fees", () => {
    const summary = payoutSummary(10_000, CONFIG);
    expect(summary.venueNet).toBe(6710);
  });
});
