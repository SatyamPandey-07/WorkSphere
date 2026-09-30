/**
 * Tests for personalized seat recommendation within a venue.
 */

interface Seat {
  seatId: string;
  row: number;
  col: number;
  type: "standard" | "premium" | "accessible" | "quiet_zone";
  hasMonitor: boolean;
  isWindowSeat: boolean;
  nearPowerOutlet: boolean;
  noiseLevel: "quiet" | "moderate" | "social";
  currentlyBooked: boolean;
}

interface SeatPreferences {
  needsAccessible: boolean;
  wantsMonitor: boolean;
  wantsWindow: boolean;
  preferredNoise: "quiet" | "moderate" | "social";
  nearPowerRequired: boolean;
}

function seatMatchScore(seat: Seat, prefs: SeatPreferences): number {
  if (prefs.needsAccessible && seat.type !== "accessible") return 0;
  let score = 50; // base score

  if (prefs.wantsMonitor && seat.hasMonitor) score += 20;
  if (prefs.wantsWindow && seat.isWindowSeat) score += 15;
  if (prefs.nearPowerRequired && seat.nearPowerOutlet) score += 20;
  else if (prefs.nearPowerRequired && !seat.nearPowerOutlet) score -= 30;
  if (seat.noiseLevel === prefs.preferredNoise) score += 15;

  return Math.max(0, score);
}

function recommendSeats(
  seats: Seat[],
  prefs: SeatPreferences,
  limit = 3
): Seat[] {
  return seats
    .filter((s) => !s.currentlyBooked)
    .map((s) => ({ seat: s, score: seatMatchScore(s, prefs) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.seat);
}

function accessibleSeats(seats: Seat[]): Seat[] {
  return seats.filter((s) => s.type === "accessible" && !s.currentlyBooked);
}

const SEATS: Seat[] = [
  { seatId: "s1", row: 1, col: 1, type: "quiet_zone",  hasMonitor: true,  isWindowSeat: true,  nearPowerOutlet: true,  noiseLevel: "quiet",    currentlyBooked: false },
  { seatId: "s2", row: 2, col: 3, type: "standard",    hasMonitor: false, isWindowSeat: false, nearPowerOutlet: true,  noiseLevel: "moderate", currentlyBooked: false },
  { seatId: "s3", row: 3, col: 5, type: "accessible",  hasMonitor: true,  isWindowSeat: false, nearPowerOutlet: true,  noiseLevel: "quiet",    currentlyBooked: false },
  { seatId: "s4", row: 1, col: 3, type: "premium",     hasMonitor: true,  isWindowSeat: true,  nearPowerOutlet: false, noiseLevel: "social",   currentlyBooked: true  },
];

const PREFS: SeatPreferences = {
  needsAccessible: false, wantsMonitor: true, wantsWindow: true,
  preferredNoise: "quiet", nearPowerRequired: true,
};

describe("Venue seat booking recommendation", () => {
  it("seatMatchScore: s1 (all preferred) → high score", () => {
    expect(seatMatchScore(SEATS[0], PREFS)).toBeGreaterThan(80);
  });

  it("seatMatchScore: accessible required but s1 not accessible → 0", () => {
    const needsAccess: SeatPreferences = { ...PREFS, needsAccessible: true };
    expect(seatMatchScore(SEATS[0], needsAccess)).toBe(0);
  });

  it("recommendSeats: excludes booked seats (s4)", () => {
    const recs = recommendSeats(SEATS, PREFS);
    expect(recs.every((s) => !s.currentlyBooked)).toBe(true);
  });

  it("recommendSeats: s1 recommended first (highest score)", () => {
    const recs = recommendSeats(SEATS, PREFS);
    expect(recs[0].seatId).toBe("s1");
  });

  it("accessibleSeats: returns unbooked accessible seats", () => {
    const accessible = accessibleSeats(SEATS);
    expect(accessible.every((s) => s.type === "accessible" && !s.currentlyBooked)).toBe(true);
  });
});
