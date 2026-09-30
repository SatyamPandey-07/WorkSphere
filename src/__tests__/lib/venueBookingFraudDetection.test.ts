/**
 * Tests for venue booking fraud detection signals.
 */

interface FraudSignals {
  userId: string;
  recentBookings: number;       // in last 24h
  cancelledInLastWeek: number;
  uniquePaymentMethods: number;
  newAccount: boolean;           // < 7 days old
  ipCountryMismatch: boolean;
  chargebackHistory: boolean;
  unusuallyHighValue: boolean;
}

function fraudScore(signals: FraudSignals): number {
  let score = 0;
  if (signals.newAccount) score += 20;
  if (signals.ipCountryMismatch) score += 25;
  if (signals.chargebackHistory) score += 40;
  if (signals.unusuallyHighValue) score += 15;
  if (signals.recentBookings > 5) score += (signals.recentBookings - 5) * 5;
  if (signals.cancelledInLastWeek > 3) score += (signals.cancelledInLastWeek - 3) * 8;
  if (signals.uniquePaymentMethods > 3) score += (signals.uniquePaymentMethods - 3) * 10;
  return Math.min(score, 100);
}

function fraudRisk(signals: FraudSignals): "low" | "medium" | "high" | "critical" {
  const score = fraudScore(signals);
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function requiresManualReview(signals: FraudSignals): boolean {
  return fraudScore(signals) >= 50 || signals.chargebackHistory;
}

function blockTransaction(signals: FraudSignals): boolean {
  return fraudScore(signals) >= 75;
}

const CLEAN_SIGNALS: FraudSignals = {
  userId: "u1", recentBookings: 1, cancelledInLastWeek: 0,
  uniquePaymentMethods: 1, newAccount: false, ipCountryMismatch: false,
  chargebackHistory: false, unusuallyHighValue: false,
};

const SUSPICIOUS_SIGNALS: FraudSignals = {
  userId: "u2", recentBookings: 8, cancelledInLastWeek: 5,
  uniquePaymentMethods: 5, newAccount: true, ipCountryMismatch: true,
  chargebackHistory: false, unusuallyHighValue: true,
};

describe("Venue booking fraud detection", () => {
  it("fraudScore: clean signals = 0", () => {
    expect(fraudScore(CLEAN_SIGNALS)).toBe(0);
  });

  it("fraudScore: suspicious signals → high score", () => {
    expect(fraudScore(SUSPICIOUS_SIGNALS)).toBeGreaterThan(50);
  });

  it("fraudRisk: low for clean signals", () => {
    expect(fraudRisk(CLEAN_SIGNALS)).toBe("low");
  });

  it("fraudRisk: critical for chargeback + mismatch", () => {
    const critical = { ...SUSPICIOUS_SIGNALS, chargebackHistory: true };
    expect(fraudRisk(critical)).toBe("critical");
  });

  it("requiresManualReview: clean signals → false", () => {
    expect(requiresManualReview(CLEAN_SIGNALS)).toBe(false);
  });

  it("requiresManualReview: chargeback history → true", () => {
    expect(requiresManualReview({ ...CLEAN_SIGNALS, chargebackHistory: true })).toBe(true);
  });

  it("blockTransaction: suspicious → may block", () => {
    const highRisk = { ...SUSPICIOUS_SIGNALS, chargebackHistory: true };
    expect(blockTransaction(highRisk)).toBe(true);
  });

  it("blockTransaction: medium risk → don't block", () => {
    const medium = { ...CLEAN_SIGNALS, newAccount: true, ipCountryMismatch: true };
    expect(blockTransaction(medium)).toBe(false); // 20+25=45 < 75
  });
});
