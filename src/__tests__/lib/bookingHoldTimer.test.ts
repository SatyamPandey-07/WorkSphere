/**
 * Tests for booking hold timer during payment flow.
 */

interface BookingHold {
  bookingId: string;
  userId: string;
  seatId: string;
  heldAt: number;
  expiresAt: number;
  confirmed: boolean;
}

function isHoldActive(hold: BookingHold, nowMs: number): boolean {
  return !hold.confirmed && nowMs < hold.expiresAt;
}

function isHoldExpired(hold: BookingHold, nowMs: number): boolean {
  return !hold.confirmed && nowMs >= hold.expiresAt;
}

function secondsUntilExpiry(hold: BookingHold, nowMs: number): number {
  if (!isHoldActive(hold, nowMs)) return 0;
  return Math.ceil((hold.expiresAt - nowMs) / 1000);
}

function confirmHold(hold: BookingHold): BookingHold {
  if (!hold.confirmed) return { ...hold, confirmed: true };
  throw new Error("Hold already confirmed");
}

function extendHold(hold: BookingHold, extensionMs: number, nowMs: number): BookingHold {
  if (isHoldExpired(hold, nowMs)) throw new Error("Cannot extend expired hold");
  return { ...hold, expiresAt: hold.expiresAt + extensionMs };
}

const NOW = 1_700_000_000_000;
const HOLD: BookingHold = {
  bookingId: "b1", userId: "u1", seatId: "s1",
  heldAt: NOW, expiresAt: NOW + 300_000, confirmed: false,
};

describe("Booking hold timer", () => {
  it("isHoldActive: not confirmed, not expired → true", () => {
    expect(isHoldActive(HOLD, NOW + 100_000)).toBe(true);
  });

  it("isHoldActive: expired → false", () => {
    expect(isHoldActive(HOLD, NOW + 400_000)).toBe(false);
  });

  it("isHoldActive: confirmed → false", () => {
    expect(isHoldActive({ ...HOLD, confirmed: true }, NOW)).toBe(false);
  });

  it("isHoldExpired: past expiry → true", () => {
    expect(isHoldExpired(HOLD, NOW + 400_000)).toBe(true);
  });

  it("isHoldExpired: still active → false", () => {
    expect(isHoldExpired(HOLD, NOW + 100_000)).toBe(false);
  });

  it("secondsUntilExpiry: 100s remaining → 100", () => {
    expect(secondsUntilExpiry(HOLD, NOW + 200_000)).toBe(100);
  });

  it("secondsUntilExpiry: expired → 0", () => {
    expect(secondsUntilExpiry(HOLD, NOW + 400_000)).toBe(0);
  });

  it("confirmHold sets confirmed = true", () => {
    expect(confirmHold(HOLD).confirmed).toBe(true);
  });

  it("confirmHold throws if already confirmed", () => {
    expect(() => confirmHold({ ...HOLD, confirmed: true })).toThrow("already confirmed");
  });

  it("extendHold increases expiresAt", () => {
    const extended = extendHold(HOLD, 300_000, NOW);
    expect(extended.expiresAt).toBe(NOW + 600_000);
  });

  it("extendHold throws on expired hold", () => {
    expect(() => extendHold(HOLD, 300_000, NOW + 400_000)).toThrow("Cannot extend expired");
  });
});
