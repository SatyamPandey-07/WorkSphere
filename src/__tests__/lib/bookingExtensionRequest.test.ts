/**
 * Tests for booking time extension request handling.
 */

interface Booking {
  id: string;
  venueId: string;
  userId: string;
  startMs: number;
  endMs: number;
  maxExtensionMs: number;
}

interface ExtensionRequest {
  bookingId: string;
  requestedExtensionMs: number;
  requestedAt: number;
}

function canExtend(
  booking: Booking,
  extensionMs: number,
  existingExtensionMs = 0
): boolean {
  return existingExtensionMs + extensionMs <= booking.maxExtensionMs;
}

function extendBooking(booking: Booking, extensionMs: number): Booking {
  return { ...booking, endMs: booking.endMs + extensionMs };
}

function remainingExtensionMs(
  booking: Booking,
  usedExtensionMs: number
): number {
  return Math.max(0, booking.maxExtensionMs - usedExtensionMs);
}

function isExtensionExpired(request: ExtensionRequest, nowMs: number, ttlMs = 300_000): boolean {
  return nowMs - request.requestedAt > ttlMs;
}

const NOW = 1_700_000_000_000;
const BOOKING: Booking = {
  id: "b1", venueId: "v1", userId: "u1",
  startMs: NOW, endMs: NOW + 3_600_000, maxExtensionMs: 3_600_000,
};

describe("Booking extension request", () => {
  it("canExtend: extension within limit → true", () => {
    expect(canExtend(BOOKING, 1_800_000)).toBe(true);
  });

  it("canExtend: exactly at limit → true", () => {
    expect(canExtend(BOOKING, 3_600_000)).toBe(true);
  });

  it("canExtend: exceeds limit → false", () => {
    expect(canExtend(BOOKING, 3_600_001)).toBe(false);
  });

  it("canExtend: existing + new exceeds limit → false", () => {
    expect(canExtend(BOOKING, 2_000_000, 2_000_000)).toBe(false);
  });

  it("extendBooking adds to endMs", () => {
    const extended = extendBooking(BOOKING, 1_800_000);
    expect(extended.endMs).toBe(NOW + 5_400_000);
  });

  it("extendBooking is immutable", () => {
    extendBooking(BOOKING, 1_000_000);
    expect(BOOKING.endMs).toBe(NOW + 3_600_000);
  });

  it("remainingExtensionMs: 0 used → max", () => {
    expect(remainingExtensionMs(BOOKING, 0)).toBe(3_600_000);
  });

  it("remainingExtensionMs: all used → 0", () => {
    expect(remainingExtensionMs(BOOKING, 3_600_000)).toBe(0);
  });

  it("isExtensionExpired: within TTL → false", () => {
    const req: ExtensionRequest = { bookingId: "b1", requestedExtensionMs: 1_800_000, requestedAt: NOW - 100_000 };
    expect(isExtensionExpired(req, NOW)).toBe(false);
  });

  it("isExtensionExpired: beyond TTL → true", () => {
    const req: ExtensionRequest = { bookingId: "b1", requestedExtensionMs: 1_800_000, requestedAt: NOW - 400_000 };
    expect(isExtensionExpired(req, NOW)).toBe(true);
  });
});
