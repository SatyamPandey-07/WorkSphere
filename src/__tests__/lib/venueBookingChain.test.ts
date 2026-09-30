/**
 * Tests for back-to-back booking chain management.
 */

interface BookingChain {
  chainId: string;
  userId: string;
  bookings: { bookingId: string; startMs: number; endMs: number; venueId: string }[];
  totalCents: number;
  chainDiscountPct: number;
}

function chainDurationHours(chain: BookingChain): number {
  if (chain.bookings.length === 0) return 0;
  const first = chain.bookings.reduce((min, b) => b.startMs < min.startMs ? b : min);
  const last = chain.bookings.reduce((max, b) => b.endMs > max.endMs ? b : max);
  return (last.endMs - first.startMs) / 3_600_000;
}

function isBackToBack(chain: BookingChain, maxGapMs = 30 * 60_000): boolean {
  if (chain.bookings.length < 2) return true;
  const sorted = [...chain.bookings].sort((a, b) => a.startMs - b.startMs);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1].startMs - sorted[i].endMs > maxGapMs) return false;
  }
  return true;
}

function applyChainDiscount(chain: BookingChain): number {
  return Math.round(chain.totalCents * (1 - chain.chainDiscountPct / 100));
}

function spansMultipleVenues(chain: BookingChain): boolean {
  const venues = new Set(chain.bookings.map((b) => b.venueId));
  return venues.size > 1;
}

function addBookingToChain(
  chain: BookingChain,
  booking: { bookingId: string; startMs: number; endMs: number; venueId: string },
  priceCents: number
): BookingChain {
  return {
    ...chain,
    bookings: [...chain.bookings, booking],
    totalCents: chain.totalCents + priceCents,
  };
}

const NOW = 1_700_000_000_000;
const CHAIN: BookingChain = {
  chainId: "ch1", userId: "u1",
  bookings: [
    { bookingId: "b1", startMs: NOW,             endMs: NOW + 2_000_000, venueId: "v1" },
    { bookingId: "b2", startMs: NOW + 2_100_000, endMs: NOW + 4_000_000, venueId: "v1" }, // 100s gap
    { bookingId: "b3", startMs: NOW + 4_100_000, endMs: NOW + 7_200_000, venueId: "v2" }, // different venue
  ],
  totalCents: 15_000,
  chainDiscountPct: 10,
};

describe("Venue booking chain management", () => {
  it("chainDurationHours: first to last booking span", () => {
    const hours = chainDurationHours(CHAIN);
    expect(hours).toBeCloseTo(7_200_000 / 3_600_000, 1);
  });

  it("isBackToBack: all gaps < 30 min → true", () => {
    expect(isBackToBack(CHAIN)).toBe(true);
  });

  it("isBackToBack: large gap → false", () => {
    const largeGap = {
      ...CHAIN,
      bookings: [
        { bookingId: "b1", startMs: NOW, endMs: NOW + 3_600_000, venueId: "v1" },
        { bookingId: "b2", startMs: NOW + 7_200_000, endMs: NOW + 9_000_000, venueId: "v1" }, // 1h gap
      ],
    };
    expect(isBackToBack(largeGap)).toBe(false);
  });

  it("applyChainDiscount: 10% off 15000 = 13500", () => {
    expect(applyChainDiscount(CHAIN)).toBe(13_500);
  });

  it("spansMultipleVenues: v1 and v2 → true", () => {
    expect(spansMultipleVenues(CHAIN)).toBe(true);
  });

  it("spansMultipleVenues: single venue → false", () => {
    const singleVenue = { ...CHAIN, bookings: CHAIN.bookings.slice(0, 2) };
    expect(spansMultipleVenues(singleVenue)).toBe(false);
  });

  it("addBookingToChain: increases count and total", () => {
    const updated = addBookingToChain(CHAIN, { bookingId: "b4", startMs: NOW + 8_000_000, endMs: NOW + 10_000_000, venueId: "v1" }, 3_000);
    expect(updated.bookings).toHaveLength(4);
    expect(updated.totalCents).toBe(18_000);
  });
});
