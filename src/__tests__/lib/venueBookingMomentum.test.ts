/**
 * Tests for venue booking momentum indicators.
 */

interface BookingMomentumData {
  date: string;
  bookings: number;
  revenue: number;
  newCustomers: number;
}

function calculateMomentum(current: BookingMomentumData, previous: BookingMomentumData): number {
  if (previous.bookings === 0) return current.bookings > 0 ? 100 : 0;
  const bookingChange = ((current.bookings - previous.bookings) / previous.bookings) * 100;
  const revenueChange = previous.revenue > 0
    ? ((current.revenue - previous.revenue) / previous.revenue) * 100
    : 0;
  return Math.round((bookingChange + revenueChange) / 2);
}

function trendStrength(data: BookingMomentumData[]): "accelerating" | "steady" | "decelerating" {
  if (data.length < 3) return "steady";
  const recent = data.slice(-2);
  const older = data.slice(-4, -2);
  const recentAvg = recent.reduce((s, d) => s + d.bookings, 0) / recent.length;
  const olderAvg = older.reduce((s, d) => s + d.bookings, 0) / Math.max(1, older.length);
  const ratio = recentAvg / Math.max(1, olderAvg);
  if (ratio > 1.1) return "accelerating";
  if (ratio < 0.9) return "decelerating";
  return "steady";
}

function velocityScore(current: BookingMomentumData, target: BookingMomentumData): number {
  if (target.bookings === 0) return 0;
  return Math.round((current.bookings / target.bookings) * 100);
}

function cumulativeRevenue(data: BookingMomentumData[]): number {
  return data.reduce((s, d) => s + d.revenue, 0);
}

function peakDay(data: BookingMomentumData[]): string | null {
  if (data.length === 0) return null;
  return data.reduce((max, d) => d.bookings > max.bookings ? d : max).date;
}

const DATA: BookingMomentumData[] = [
  { date: "2026-10-01", bookings: 10, revenue: 5000, newCustomers: 3 },
  { date: "2026-10-02", bookings: 15, revenue: 7500, newCustomers: 5 },
  { date: "2026-10-03", bookings: 20, revenue: 10000, newCustomers: 7 },
  { date: "2026-10-04", bookings: 18, revenue: 9000, newCustomers: 4 },
];

describe("Venue booking momentum", () => {
  it("calculateMomentum: 10→15 bookings, 5000→7500 revenue = 50%", () => {
    const momentum = calculateMomentum(DATA[1], DATA[0]);
    expect(momentum).toBe(50);
  });

  it("calculateMomentum: previous zero bookings → 100 if current > 0", () => {
    expect(calculateMomentum(DATA[0], { ...DATA[0], bookings: 0, revenue: 0 })).toBe(100);
  });

  it("trendStrength: increasing data → accelerating", () => {
    expect(trendStrength(DATA)).toBe("accelerating");
  });

  it("velocityScore: 18/20 target = 90%", () => {
    expect(velocityScore(DATA[3], DATA[2])).toBe(90);
  });

  it("cumulativeRevenue: sum of all days", () => {
    expect(cumulativeRevenue(DATA)).toBe(31_500);
  });

  it("peakDay: Oct 3 has most bookings (20)", () => {
    expect(peakDay(DATA)).toBe("2026-10-03");
  });

  it("peakDay: empty → null", () => {
    expect(peakDay([])).toBeNull();
  });
});
