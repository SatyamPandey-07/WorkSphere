/**
 * Tests for comprehensive venue booking analytics metrics.
 */

interface BookingAnalytic {
  bookingId: string;
  venueId: string;
  date: string;
  dayOfWeek: number;
  hour: number;
  durationHours: number;
  attendees: number;
  totalCents: number;
  channel: "direct" | "mobile" | "partner";
  isRepeatCustomer: boolean;
}

function channelBreakdown(
  analytics: BookingAnalytic[],
  venueId: string
): Record<string, number> {
  const counts: Record<string, number> = {};
  analytics
    .filter((a) => a.venueId === venueId)
    .forEach((a) => { counts[a.channel] = (counts[a.channel] ?? 0) + 1; });
  return counts;
}

function repeatCustomerRate(analytics: BookingAnalytic[], venueId: string): number {
  const venue = analytics.filter((a) => a.venueId === venueId);
  if (venue.length === 0) return 0;
  return Math.round((venue.filter((a) => a.isRepeatCustomer).length / venue.length) * 100);
}

function avgAttendeesPerBooking(analytics: BookingAnalytic[], venueId: string): number {
  const venue = analytics.filter((a) => a.venueId === venueId);
  if (venue.length === 0) return 0;
  return Math.round(venue.reduce((s, a) => s + a.attendees, 0) / venue.length * 10) / 10;
}

function peakBookingHour(analytics: BookingAnalytic[], venueId: string): number | null {
  const venue = analytics.filter((a) => a.venueId === venueId);
  if (venue.length === 0) return null;
  const hourCounts: Record<number, number> = {};
  venue.forEach((a) => { hourCounts[a.hour] = (hourCounts[a.hour] ?? 0) + 1; });
  return Number(Object.entries(hourCounts).sort((a, b) => Number(b[1]) - Number(a[1]))[0][0]);
}

const ANALYTICS: BookingAnalytic[] = [
  { bookingId: "b1", venueId: "v1", date: "2026-10-01", dayOfWeek: 4, hour: 9,  durationHours: 2, attendees: 3, totalCents: 2000, channel: "direct", isRepeatCustomer: true  },
  { bookingId: "b2", venueId: "v1", date: "2026-10-01", dayOfWeek: 4, hour: 9,  durationHours: 1, attendees: 1, totalCents: 1000, channel: "mobile", isRepeatCustomer: false },
  { bookingId: "b3", venueId: "v1", date: "2026-10-02", dayOfWeek: 5, hour: 14, durationHours: 3, attendees: 5, totalCents: 3000, channel: "direct", isRepeatCustomer: true  },
  { bookingId: "b4", venueId: "v2", date: "2026-10-01", dayOfWeek: 4, hour: 10, durationHours: 2, attendees: 2, totalCents: 1500, channel: "partner",isRepeatCustomer: false },
];

describe("Venue booking analytics", () => {
  it("channelBreakdown: v1 has 2 direct, 1 mobile", () => {
    const breakdown = channelBreakdown(ANALYTICS, "v1");
    expect(breakdown.direct).toBe(2);
    expect(breakdown.mobile).toBe(1);
  });

  it("repeatCustomerRate: v1 = 67% (2/3)", () => {
    expect(repeatCustomerRate(ANALYTICS, "v1")).toBe(67);
  });

  it("repeatCustomerRate: unknown venue → 0", () => {
    expect(repeatCustomerRate(ANALYTICS, "v99")).toBe(0);
  });

  it("avgAttendeesPerBooking: v1 = (3+1+5)/3 ≈ 3", () => {
    expect(avgAttendeesPerBooking(ANALYTICS, "v1")).toBeCloseTo(3, 0);
  });

  it("peakBookingHour: v1 peak = 9am (2 bookings)", () => {
    expect(peakBookingHour(ANALYTICS, "v1")).toBe(9);
  });

  it("peakBookingHour: empty → null", () => {
    expect(peakBookingHour(ANALYTICS, "v99")).toBeNull();
  });
});
