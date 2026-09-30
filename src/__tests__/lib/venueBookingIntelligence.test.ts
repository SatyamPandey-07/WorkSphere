/**
 * Tests for venue booking intelligence and churn prediction.
 */

interface CustomerEngagement {
  userId: string;
  venueId: string;
  lastBookingMs: number;
  totalBookings: number;
  avgDaysBetweenBookings: number;
  cancelledBookings: number;
  reviewsWritten: number;
  npsScore: number | null;
}

function churnRisk(engagement: CustomerEngagement, nowMs: number): "low" | "medium" | "high" {
  const daysSinceLastBooking = (nowMs - engagement.lastBookingMs) / 86_400_000;
  const expectedInterval = engagement.avgDaysBetweenBookings;
  const overdueFactor = daysSinceLastBooking / expectedInterval;

  if (overdueFactor >= 2.0) return "high";
  if (overdueFactor >= 1.3) return "medium";
  return "low";
}

function customerLifetimeValue(engagement: CustomerEngagement, avgBookingCents: number): number {
  return Math.round(engagement.totalBookings * avgBookingCents * (1 - engagement.cancelledBookings / Math.max(1, engagement.totalBookings + engagement.cancelledBookings)));
}

function engagementScore(engagement: CustomerEngagement): number {
  let score = 0;
  score += Math.min(engagement.totalBookings * 5, 50);
  score += engagement.reviewsWritten * 10;
  if (engagement.npsScore !== null) score += engagement.npsScore * 2;
  score -= engagement.cancelledBookings * 5;
  return Math.max(0, Math.min(score, 100));
}

function shouldSendWinbackCampaign(
  engagement: CustomerEngagement,
  nowMs: number
): boolean {
  return churnRisk(engagement, nowMs) === "high" && engagement.totalBookings >= 3;
}

const NOW = 1_700_000_000_000;
const ENGAGEMENT: CustomerEngagement = {
  userId: "u1", venueId: "v1",
  lastBookingMs: NOW - 30 * 86_400_000, // 30 days ago
  totalBookings: 10,
  avgDaysBetweenBookings: 7,
  cancelledBookings: 1,
  reviewsWritten: 3,
  npsScore: 8,
};

describe("Venue booking intelligence", () => {
  it("churnRisk: 30 days since booking with 7-day avg = high (>2x overdue)", () => {
    expect(churnRisk(ENGAGEMENT, NOW)).toBe("high");
  });

  it("churnRisk: on track → low", () => {
    const onTrack = { ...ENGAGEMENT, lastBookingMs: NOW - 6 * 86_400_000 };
    expect(churnRisk(onTrack, NOW)).toBe("low");
  });

  it("churnRisk: slightly overdue → medium", () => {
    const slight = { ...ENGAGEMENT, lastBookingMs: NOW - 10 * 86_400_000 }; // ~1.4x overdue
    expect(churnRisk(slight, NOW)).toBe("medium");
  });

  it("customerLifetimeValue: 10 bookings × 5000 × (10/11 non-cancel) ≈ 45455", () => {
    const clv = customerLifetimeValue(ENGAGEMENT, 5000);
    expect(clv).toBeGreaterThan(40_000);
  });

  it("engagementScore: positive factors increase score", () => {
    expect(engagementScore(ENGAGEMENT)).toBeGreaterThan(50);
  });

  it("shouldSendWinbackCampaign: high churn + 10 bookings → true", () => {
    expect(shouldSendWinbackCampaign(ENGAGEMENT, NOW)).toBe(true);
  });

  it("shouldSendWinbackCampaign: high churn but new customer (2 bookings) → false", () => {
    const newUser = { ...ENGAGEMENT, totalBookings: 2 };
    expect(shouldSendWinbackCampaign(newUser, NOW)).toBe(false);
  });
});
