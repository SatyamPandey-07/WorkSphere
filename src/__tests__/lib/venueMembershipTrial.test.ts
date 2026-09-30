/**
 * Tests for venue free trial membership management.
 */

interface MembershipTrial {
  trialId: string;
  userId: string;
  venueId: string;
  startedAt: number;
  expiresAt: number;
  daysRemaining: number;
  usedBookings: number;
  maxTrialBookings: number;
  convertedAt: number | null;
}

function isTrialActive(trial: MembershipTrial, nowMs: number): boolean {
  if (trial.convertedAt !== null) return false; // already converted to paid
  if (nowMs >= trial.expiresAt) return false;
  if (trial.usedBookings >= trial.maxTrialBookings) return false;
  return true;
}

function trialDaysRemaining(trial: MembershipTrial, nowMs: number): number {
  if (!isTrialActive(trial, nowMs)) return 0;
  return Math.max(0, Math.ceil((trial.expiresAt - nowMs) / 86_400_000));
}

function canUseTrialBooking(trial: MembershipTrial, nowMs: number): boolean {
  return isTrialActive(trial, nowMs) && trial.usedBookings < trial.maxTrialBookings;
}

function useTrialBooking(trial: MembershipTrial): MembershipTrial {
  if (trial.usedBookings >= trial.maxTrialBookings) throw new Error("Trial bookings exhausted");
  return { ...trial, usedBookings: trial.usedBookings + 1 };
}

function convertTrial(trial: MembershipTrial, nowMs: number): MembershipTrial {
  return { ...trial, convertedAt: nowMs };
}

const NOW = 1_700_000_000_000;
const TRIAL: MembershipTrial = {
  trialId: "t1", userId: "u1", venueId: "v1",
  startedAt: NOW - 7 * 86_400_000, expiresAt: NOW + 7 * 86_400_000,
  daysRemaining: 7, usedBookings: 1, maxTrialBookings: 3,
  convertedAt: null,
};

describe("Venue membership trial", () => {
  it("isTrialActive: active trial → true", () => {
    expect(isTrialActive(TRIAL, NOW)).toBe(true);
  });

  it("isTrialActive: expired → false", () => {
    expect(isTrialActive(TRIAL, NOW + 10 * 86_400_000)).toBe(false);
  });

  it("isTrialActive: bookings exhausted → false", () => {
    expect(isTrialActive({ ...TRIAL, usedBookings: 3 }, NOW)).toBe(false);
  });

  it("isTrialActive: converted → false", () => {
    expect(isTrialActive({ ...TRIAL, convertedAt: NOW - 1000 }, NOW)).toBe(false);
  });

  it("trialDaysRemaining: ~7 days left", () => {
    expect(trialDaysRemaining(TRIAL, NOW)).toBe(7);
  });

  it("trialDaysRemaining: inactive trial → 0", () => {
    expect(trialDaysRemaining(TRIAL, NOW + 10 * 86_400_000)).toBe(0);
  });

  it("canUseTrialBooking: active with remaining bookings → true", () => {
    expect(canUseTrialBooking(TRIAL, NOW)).toBe(true);
  });

  it("useTrialBooking: increments used count", () => {
    const updated = useTrialBooking(TRIAL);
    expect(updated.usedBookings).toBe(2);
  });

  it("useTrialBooking: throws when exhausted", () => {
    expect(() => useTrialBooking({ ...TRIAL, usedBookings: 3 })).toThrow("exhausted");
  });

  it("convertTrial: sets convertedAt", () => {
    expect(convertTrial(TRIAL, NOW).convertedAt).toBe(NOW);
  });
});
