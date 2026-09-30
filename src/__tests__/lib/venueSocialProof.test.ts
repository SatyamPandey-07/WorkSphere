/**
 * Tests for venue social proof signal aggregation.
 */

interface SocialProofSignals {
  recentBookings24h: number;
  currentViewers: number;
  savedCount: number;
  avgRating: number;
  reviewCount: number;
  lastBookedMinutesAgo: number | null;
}

type UrgencyLevel = "none" | "low" | "medium" | "high";

function urgencyLevel(signals: SocialProofSignals): UrgencyLevel {
  if (signals.currentViewers >= 10 && signals.recentBookings24h >= 5) return "high";
  if (signals.currentViewers >= 5 || signals.recentBookings24h >= 3)  return "medium";
  if (signals.currentViewers >= 2 || signals.recentBookings24h >= 1)  return "low";
  return "none";
}

function socialProofMessage(signals: SocialProofSignals): string | null {
  if (signals.lastBookedMinutesAgo !== null && signals.lastBookedMinutesAgo <= 60) {
    return `Booked ${signals.lastBookedMinutesAgo} min ago`;
  }
  if (signals.recentBookings24h >= 3) {
    return `${signals.recentBookings24h} bookings today`;
  }
  if (signals.currentViewers >= 3) {
    return `${signals.currentViewers} people viewing now`;
  }
  return null;
}

function popularityScore(signals: SocialProofSignals): number {
  return (
    signals.recentBookings24h * 5 +
    signals.currentViewers * 2 +
    signals.savedCount * 0.5 +
    signals.avgRating * 10 +
    Math.min(signals.reviewCount * 0.1, 10)
  );
}

describe("Venue social proof", () => {
  const HIGH: SocialProofSignals = { recentBookings24h: 10, currentViewers: 15, savedCount: 50, avgRating: 4.8, reviewCount: 100, lastBookedMinutesAgo: 5 };
  const LOW:  SocialProofSignals = { recentBookings24h: 0,  currentViewers: 1,  savedCount: 5,  avgRating: 3.5, reviewCount: 10,  lastBookedMinutesAgo: null };

  it("urgencyLevel: high viewers + bookings → high", () => {
    expect(urgencyLevel(HIGH)).toBe("high");
  });

  it("urgencyLevel: 0 viewers, 0 bookings → none", () => {
    expect(urgencyLevel({ ...LOW, currentViewers: 0 })).toBe("none");
  });

  it("urgencyLevel: 3+ bookings → medium", () => {
    expect(urgencyLevel({ ...LOW, recentBookings24h: 3 })).toBe("medium");
  });

  it("socialProofMessage: recent booking → 'Booked X min ago'", () => {
    expect(socialProofMessage(HIGH)).toMatch(/Booked \d+ min ago/);
  });

  it("socialProofMessage: no recent booking → bookings today", () => {
    const noRecent = { ...HIGH, lastBookedMinutesAgo: null };
    expect(socialProofMessage(noRecent)).toContain("bookings today");
  });

  it("socialProofMessage: low signals → null", () => {
    expect(socialProofMessage(LOW)).toBeNull();
  });

  it("popularityScore: higher for better signals", () => {
    expect(popularityScore(HIGH)).toBeGreaterThan(popularityScore(LOW));
  });
});
