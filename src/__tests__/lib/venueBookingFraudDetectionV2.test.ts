/**
 * Tests for venue booking fraud detection v2 with behavioral signals.
 */

interface BehavioralSignal {
  type: "rapid_bookings" | "multiple_cards" | "vpn_detected" | "unusual_location" | "high_value" | "first_time" | "chargeback_history";
  score: number;    // 0-1, higher = more suspicious
  detected: boolean;
}

interface FraudProfile {
  userId: string;
  bookingId: string;
  bookingAmount: number;
  signals: BehavioralSignal[];
  previousChargebacks: number;
  accountAgeDays: number;
}

const SIGNAL_WEIGHTS: Record<BehavioralSignal["type"], number> = {
  rapid_bookings:     0.20,
  multiple_cards:     0.15,
  vpn_detected:       0.10,
  unusual_location:   0.15,
  high_value:         0.10,
  first_time:         0.10,
  chargeback_history: 0.20,
};

function fraudScore(profile: FraudProfile): number {
  let score = profile.signals
    .filter((s) => s.detected)
    .reduce((s, sig) => s + sig.score * (SIGNAL_WEIGHTS[sig.type] ?? 0), 0);

  // Extra weight for chargebacks
  score += Math.min(profile.previousChargebacks * 0.1, 0.3);

  // New accounts are riskier
  if (profile.accountAgeDays < 7) score += 0.15;

  return Math.min(Math.round(score * 100) / 100, 1);
}

function fraudRiskLevel(score: number): "low" | "medium" | "high" | "block" {
  if (score >= 0.8) return "block";
  if (score >= 0.6) return "high";
  if (score >= 0.3) return "medium";
  return "low";
}

function shouldBlock(profile: FraudProfile): boolean {
  return fraudRiskLevel(fraudScore(profile)) === "block";
}

function flaggedSignals(profile: FraudProfile): BehavioralSignal["type"][] {
  return profile.signals.filter((s) => s.detected && s.score > 0.7).map((s) => s.type);
}

const CLEAN_PROFILE: FraudProfile = {
  userId: "u1", bookingId: "b1", bookingAmount: 500,
  signals: [
    { type: "first_time",   score: 0.3, detected: true },
    { type: "high_value",   score: 0.4, detected: false },
    { type: "vpn_detected", score: 0.0, detected: false },
  ],
  previousChargebacks: 0, accountAgeDays: 365,
};
const RISKY_PROFILE: FraudProfile = {
  userId: "u2", bookingId: "b2", bookingAmount: 5000,
  signals: [
    { type: "rapid_bookings",     score: 0.9, detected: true },
    { type: "chargeback_history", score: 0.95,detected: true },
    { type: "vpn_detected",       score: 0.8, detected: true },
    { type: "first_time",         score: 0.5, detected: true },
  ],
  previousChargebacks: 3, accountAgeDays: 2,
};

describe("Fraud detection v2 behavioral signals", () => {
  it("fraudScore: clean profile → low score", () => {
    expect(fraudScore(CLEAN_PROFILE)).toBeLessThan(0.3);
  });

  it("fraudScore: risky profile → high score", () => {
    expect(fraudScore(RISKY_PROFILE)).toBeGreaterThan(0.6);
  });

  it("fraudRiskLevel: score 0.85 → block", () => {
    expect(fraudRiskLevel(0.85)).toBe("block");
  });

  it("shouldBlock: clean profile → false", () => {
    expect(shouldBlock(CLEAN_PROFILE)).toBe(false);
  });

  it("shouldBlock: risky profile → true", () => {
    expect(shouldBlock(RISKY_PROFILE)).toBe(true);
  });

  it("flaggedSignals: risky profile has high-score signals", () => {
    const flags = flaggedSignals(RISKY_PROFILE);
    expect(flags).toContain("chargeback_history");
    expect(flags).toContain("rapid_bookings");
  });
});
