/**
 * Tests for split-seat booking (multiple people share one desk over the day).
 */

interface SeatTimeShare {
  shareId: string;
  seatId: string;
  venueId: string;
  date: string;
  userId: string;
  startMinutes: number;
  endMinutes: number;
  priceCents: number;
}

function isTimeShareConflict(a: SeatTimeShare, b: SeatTimeShare): boolean {
  if (a.seatId !== b.seatId || a.date !== b.date || a.shareId === b.shareId) return false;
  return a.startMinutes < b.endMinutes && a.endMinutes > b.startMinutes;
}

function seatUtilizationPercent(
  shares: SeatTimeShare[],
  seatId: string,
  date: string,
  openMinutes = 480,
  closeMinutes = 1200
): number {
  const seatShares = shares.filter((s) => s.seatId === seatId && s.date === date);
  const bookedMinutes = seatShares.reduce((sum, s) => sum + (s.endMinutes - s.startMinutes), 0);
  const totalMinutes = closeMinutes - openMinutes;
  if (totalMinutes <= 0) return 0;
  return Math.round((bookedMinutes / totalMinutes) * 100);
}

function revenueFromSplitSeat(shares: SeatTimeShare[], seatId: string, date: string): number {
  return shares
    .filter((s) => s.seatId === seatId && s.date === date)
    .reduce((sum, s) => sum + s.priceCents, 0);
}

function availableTimeSlots(
  shares: SeatTimeShare[],
  seatId: string,
  date: string,
  durationMinutes: number,
  openMinutes = 480,
  closeMinutes = 1200
): { startMinutes: number; endMinutes: number }[] {
  const booked = shares.filter((s) => s.seatId === seatId && s.date === date)
    .sort((a, b) => a.startMinutes - b.startMinutes);

  const slots: { startMinutes: number; endMinutes: number }[] = [];
  let current = openMinutes;

  for (const share of booked) {
    if (share.startMinutes - current >= durationMinutes) {
      slots.push({ startMinutes: current, endMinutes: current + durationMinutes });
    }
    current = Math.max(current, share.endMinutes);
  }

  if (current + durationMinutes <= closeMinutes) {
    slots.push({ startMinutes: current, endMinutes: current + durationMinutes });
  }

  return slots;
}

const SHARES: SeatTimeShare[] = [
  { shareId: "ss1", seatId: "d1", venueId: "v1", date: "2026-10-01", userId: "u1", startMinutes: 480, endMinutes: 720, priceCents: 1500 },
  { shareId: "ss2", seatId: "d1", venueId: "v1", date: "2026-10-01", userId: "u2", startMinutes: 780, endMinutes: 1020, priceCents: 1500 },
];

describe("Venue split-seat booking", () => {
  it("isTimeShareConflict: adjacent timeslots → false", () => {
    expect(isTimeShareConflict(SHARES[0], SHARES[1])).toBe(false);
  });

  it("isTimeShareConflict: overlapping → true", () => {
    const overlap: SeatTimeShare = { ...SHARES[1], shareId: "ss3", startMinutes: 700 };
    expect(isTimeShareConflict(SHARES[0], overlap)).toBe(true);
  });

  it("seatUtilizationPercent: 2×240 booked = 480/720 ≈ 67%", () => {
    expect(seatUtilizationPercent(SHARES, "d1", "2026-10-01")).toBeCloseTo(67, 0);
  });

  it("revenueFromSplitSeat: 1500+1500 = 3000", () => {
    expect(revenueFromSplitSeat(SHARES, "d1", "2026-10-01")).toBe(3000);
  });

  it("availableTimeSlots: finds 60-min gap between bookings", () => {
    const slots = availableTimeSlots(SHARES, "d1", "2026-10-01", 60);
    // Gap: 720-780 = 60 min
    expect(slots.some((s) => s.startMinutes === 720)).toBe(true);
  });
});
