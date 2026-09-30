/**
 * Tests for waitlist-to-booking conversion tracking and optimization.
 */

interface WaitlistConversionData {
  date: string;
  venueId: string;
  waitlistAdds: number;
  conversionsThatDay: number;
  conversionTimeHours: number; // avg hours from waitlist to booking
  lostDueToExpiry: number;
}

function conversionRate(data: WaitlistConversionData): number {
  if (data.waitlistAdds === 0) return 0;
  return Math.round((data.conversionsThatDay / data.waitlistAdds) * 100);
}

function expiryLossRate(data: WaitlistConversionData): number {
  if (data.waitlistAdds === 0) return 0;
  return Math.round((data.lostDueToExpiry / data.waitlistAdds) * 100);
}

function weeklyWaitlistStats(
  data: WaitlistConversionData[],
  venueId: string
): {
  totalAdds: number;
  totalConversions: number;
  avgConversionRate: number;
  avgConversionTimeHours: number;
} {
  const venue = data.filter((d) => d.venueId === venueId);
  if (venue.length === 0) return { totalAdds: 0, totalConversions: 0, avgConversionRate: 0, avgConversionTimeHours: 0 };

  const totalAdds = venue.reduce((s, d) => s + d.waitlistAdds, 0);
  const totalConversions = venue.reduce((s, d) => s + d.conversionsThatDay, 0);
  const avgRate = venue.reduce((s, d) => s + conversionRate(d), 0) / venue.length;
  const avgTime = venue.reduce((s, d) => s + d.conversionTimeHours, 0) / venue.length;

  return {
    totalAdds,
    totalConversions,
    avgConversionRate: Math.round(avgRate),
    avgConversionTimeHours: Math.round(avgTime * 10) / 10,
  };
}

const DATA: WaitlistConversionData[] = [
  { date: "2026-10-01", venueId: "v1", waitlistAdds: 20, conversionsThatDay: 12, conversionTimeHours: 4,  lostDueToExpiry: 3 },
  { date: "2026-10-02", venueId: "v1", waitlistAdds: 15, conversionsThatDay: 10, conversionTimeHours: 3,  lostDueToExpiry: 2 },
  { date: "2026-10-03", venueId: "v1", waitlistAdds: 25, conversionsThatDay: 8,  conversionTimeHours: 6,  lostDueToExpiry: 8 },
];

describe("Waitlist conversion tracking", () => {
  it("conversionRate: 12/20 = 60%", () => {
    expect(conversionRate(DATA[0])).toBe(60);
  });

  it("conversionRate: zero adds → 0", () => {
    expect(conversionRate({ ...DATA[0], waitlistAdds: 0 })).toBe(0);
  });

  it("expiryLossRate: 3/20 = 15%", () => {
    expect(expiryLossRate(DATA[0])).toBe(15);
  });

  it("weeklyWaitlistStats: correct totals", () => {
    const stats = weeklyWaitlistStats(DATA, "v1");
    expect(stats.totalAdds).toBe(60);
    expect(stats.totalConversions).toBe(30);
  });

  it("weeklyWaitlistStats: avg conversion rate", () => {
    const stats = weeklyWaitlistStats(DATA, "v1");
    expect(stats.avgConversionRate).toBeGreaterThan(30);
  });

  it("weeklyWaitlistStats: empty → zeros", () => {
    const stats = weeklyWaitlistStats(DATA, "v99");
    expect(stats.totalAdds).toBe(0);
    expect(stats.avgConversionRate).toBe(0);
  });
});
