/**
 * Tests for venue subscription plan usage tracking.
 */

interface SubscriptionUsage {
  planId: string;
  userId: string;
  venueId: string;
  periodStart: string;
  periodEnd: string;
  deskHoursUsed: number;
  deskHoursAllowed: number;
  meetingRoomsUsed: number;
  meetingRoomsAllowed: number;
  guestPassesUsed: number;
  guestPassesAllowed: number;
}

function deskHoursRemaining(usage: SubscriptionUsage): number {
  return Math.max(0, usage.deskHoursAllowed - usage.deskHoursUsed);
}

function meetingRoomsRemaining(usage: SubscriptionUsage): number {
  return Math.max(0, usage.meetingRoomsAllowed - usage.meetingRoomsUsed);
}

function overallUsagePercent(usage: SubscriptionUsage): number {
  const totalAllowed = usage.deskHoursAllowed + usage.meetingRoomsAllowed + usage.guestPassesAllowed;
  const totalUsed = usage.deskHoursUsed + usage.meetingRoomsUsed + usage.guestPassesUsed;
  if (totalAllowed === 0) return 0;
  return Math.round((totalUsed / totalAllowed) * 100);
}

function isOverUsage(usage: SubscriptionUsage): boolean {
  return (
    usage.deskHoursUsed > usage.deskHoursAllowed ||
    usage.meetingRoomsUsed > usage.meetingRoomsAllowed ||
    usage.guestPassesUsed > usage.guestPassesAllowed
  );
}

function nearCapacity(usage: SubscriptionUsage, threshold = 80): boolean {
  return overallUsagePercent(usage) >= threshold;
}

const USAGE: SubscriptionUsage = {
  planId: "pro", userId: "u1", venueId: "v1",
  periodStart: "2026-10-01", periodEnd: "2026-10-31",
  deskHoursUsed: 40, deskHoursAllowed: 80,
  meetingRoomsUsed: 8, meetingRoomsAllowed: 10,
  guestPassesUsed: 2, guestPassesAllowed: 5,
};

describe("Venue subscription usage tracking", () => {
  it("deskHoursRemaining: 80-40 = 40", () => {
    expect(deskHoursRemaining(USAGE)).toBe(40);
  });

  it("deskHoursRemaining: over usage clamps to 0", () => {
    expect(deskHoursRemaining({ ...USAGE, deskHoursUsed: 100 })).toBe(0);
  });

  it("meetingRoomsRemaining: 10-8 = 2", () => {
    expect(meetingRoomsRemaining(USAGE)).toBe(2);
  });

  it("overallUsagePercent: (40+8+2)/(80+10+5) = ~53%", () => {
    expect(overallUsagePercent(USAGE)).toBeCloseTo(53, 0);
  });

  it("isOverUsage: within limits → false", () => {
    expect(isOverUsage(USAGE)).toBe(false);
  });

  it("isOverUsage: desk hours exceeded → true", () => {
    expect(isOverUsage({ ...USAGE, deskHoursUsed: 90 })).toBe(true);
  });

  it("nearCapacity: 53% usage < 80% threshold → false", () => {
    expect(nearCapacity(USAGE)).toBe(false);
  });

  it("nearCapacity: high usage → true", () => {
    expect(nearCapacity({ ...USAGE, deskHoursUsed: 76, meetingRoomsUsed: 10, guestPassesUsed: 5 })).toBe(true);
  });
});
