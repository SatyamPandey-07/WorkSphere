/**
 * Tests for venue booking customer churn prediction utilities.
 */

interface CustomerActivity {
  userId: string;
  lastBookingAt: number;
  bookingsLast90Days: number;
  bookingsLast30Days: number;
  avgDaysBetweenBookings: number;
  totalLifetimeBookings: number;
  lastLoginAt: number;
  supportTicketsOpen: number;
}

function daysSinceLastBooking(activity: CustomerActivity, nowMs: number): number {
  return Math.floor((nowMs - activity.lastBookingAt) / 86_400_000);
}

function churnRiskScore(activity: CustomerActivity, nowMs: number): number {
  let score = 0;
  const daysSince = daysSinceLastBooking(activity, nowMs);

  // Recency factors
  if (daysSince > 90)  score += 40;
  else if (daysSince > 60) score += 25;
  else if (daysSince > 30) score += 10;

  // Frequency factors
  if (activity.bookingsLast90Days === 0) score += 20;
  else if (activity.bookingsLast90Days < 2) score += 10;

  // Engagement factors
  if (activity.supportTicketsOpen > 2) score += 15;
  if (activity.bookingsLast30Days === 0 && activity.bookingsLast90Days > 0) score += 10;

  return Math.min(score, 100);
}

function churnCategory(score: number): "high" | "medium" | "low" {
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

function atRiskCustomers(activities: CustomerActivity[], nowMs: number, threshold = 60): CustomerActivity[] {
  return activities.filter((a) => churnRiskScore(a, nowMs) >= threshold);
}

function avgBookingFrequency(activity: CustomerActivity): number {
  if (activity.totalLifetimeBookings <= 1) return 0;
  return activity.avgDaysBetweenBookings;
}

const NOW = 1_700_000_000_000;
const ACTIVITIES: CustomerActivity[] = [
  { userId: "u1", lastBookingAt: NOW - 100 * 86_400_000, bookingsLast90Days: 0, bookingsLast30Days: 0, avgDaysBetweenBookings: 30, totalLifetimeBookings: 5,  lastLoginAt: NOW - 60 * 86_400_000, supportTicketsOpen: 0 },
  { userId: "u2", lastBookingAt: NOW - 10  * 86_400_000, bookingsLast90Days: 4, bookingsLast30Days: 2, avgDaysBetweenBookings: 15, totalLifetimeBookings: 20, lastLoginAt: NOW - 5  * 86_400_000,  supportTicketsOpen: 0 },
  { userId: "u3", lastBookingAt: NOW - 45  * 86_400_000, bookingsLast90Days: 1, bookingsLast30Days: 0, avgDaysBetweenBookings: 45, totalLifetimeBookings: 8,  lastLoginAt: NOW - 20 * 86_400_000, supportTicketsOpen: 3 },
];

describe("Churn prediction utilities", () => {
  it("daysSinceLastBooking: u1 = 100 days", () => {
    expect(daysSinceLastBooking(ACTIVITIES[0], NOW)).toBe(100);
  });

  it("churnRiskScore: u1 has high churn risk", () => {
    expect(churnRiskScore(ACTIVITIES[0], NOW)).toBeGreaterThanOrEqual(60);
  });

  it("churnRiskScore: u2 has low risk", () => {
    expect(churnRiskScore(ACTIVITIES[1], NOW)).toBeLessThan(30);
  });

  it("churnCategory: score 65 → high", () => {
    expect(churnCategory(65)).toBe("high");
  });

  it("atRiskCustomers: u1 is at risk", () => {
    const atRisk = atRiskCustomers(ACTIVITIES, NOW);
    expect(atRisk.map((a) => a.userId)).toContain("u1");
  });

  it("avgBookingFrequency: single booking → 0", () => {
    expect(avgBookingFrequency({ ...ACTIVITIES[0], totalLifetimeBookings: 1 })).toBe(0);
  });
});
