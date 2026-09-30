/**
 * Tests for user seat preference storage and matching.
 */

interface SeatPreference {
  userId: string;
  preferNearWindow: boolean;
  preferQuietZone: boolean;
  preferStandingDesk: boolean;
  preferGroundFloor: boolean;
  preferMonitor: boolean;
  avoidNearKitchen: boolean;
}

interface AvailableSeat {
  seatId: string;
  isNearWindow: boolean;
  isQuietZone: boolean;
  isStandingDesk: boolean;
  floor: number;
  hasMonitor: boolean;
  isNearKitchen: boolean;
}

function preferenceMatchScore(seat: AvailableSeat, prefs: SeatPreference): number {
  let score = 0;
  if (prefs.preferNearWindow && seat.isNearWindow) score += 2;
  if (prefs.preferQuietZone && seat.isQuietZone) score += 3;
  if (prefs.preferStandingDesk && seat.isStandingDesk) score += 2;
  if (prefs.preferGroundFloor && seat.floor === 1) score += 1;
  if (prefs.preferMonitor && seat.hasMonitor) score += 2;
  if (prefs.avoidNearKitchen && seat.isNearKitchen) score -= 3;
  return score;
}

function bestSeatForUser(seats: AvailableSeat[], prefs: SeatPreference): AvailableSeat | null {
  if (seats.length === 0) return null;
  return seats.reduce((best, s) =>
    preferenceMatchScore(s, prefs) > preferenceMatchScore(best, prefs) ? s : best
  );
}

function filterByHardRequirements(
  seats: AvailableSeat[],
  prefs: SeatPreference
): AvailableSeat[] {
  return seats.filter((s) => {
    if (prefs.preferStandingDesk && !s.isStandingDesk) return false;
    if (prefs.preferMonitor && !s.hasMonitor) return false;
    return true;
  });
}

const PREFS: SeatPreference = {
  userId: "u1", preferNearWindow: true, preferQuietZone: true,
  preferStandingDesk: false, preferGroundFloor: true,
  preferMonitor: true, avoidNearKitchen: true,
};

const SEATS: AvailableSeat[] = [
  { seatId: "a1", isNearWindow: true, isQuietZone: true, isStandingDesk: false, floor: 1, hasMonitor: true,  isNearKitchen: false },
  { seatId: "a2", isNearWindow: false,isQuietZone: false,isStandingDesk: true,  floor: 2, hasMonitor: false, isNearKitchen: true  },
  { seatId: "a3", isNearWindow: true, isQuietZone: false,isStandingDesk: false, floor: 1, hasMonitor: false, isNearKitchen: false },
];

describe("Booking seat preference", () => {
  it("preferenceMatchScore: a1 scores highest", () => {
    expect(preferenceMatchScore(SEATS[0], PREFS)).toBeGreaterThan(preferenceMatchScore(SEATS[1], PREFS));
  });

  it("preferenceMatchScore: near kitchen penalty reduces score", () => {
    const withKitchen = preferenceMatchScore(SEATS[1], PREFS);
    const noKitchen = preferenceMatchScore({ ...SEATS[1], isNearKitchen: false }, PREFS);
    expect(withKitchen).toBeLessThan(noKitchen);
  });

  it("bestSeatForUser: returns a1 (highest score)", () => {
    expect(bestSeatForUser(SEATS, PREFS)!.seatId).toBe("a1");
  });

  it("bestSeatForUser: empty seats → null", () => {
    expect(bestSeatForUser([], PREFS)).toBeNull();
  });

  it("filterByHardRequirements: monitor required filters out a2, a3", () => {
    const filtered = filterByHardRequirements(SEATS, { ...PREFS, preferMonitor: true });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].seatId).toBe("a1");
  });

  it("filterByHardRequirements: no requirements → all seats", () => {
    const noReqs: SeatPreference = { ...PREFS, preferStandingDesk: false, preferMonitor: false };
    expect(filterByHardRequirements(SEATS, noReqs)).toHaveLength(3);
  });
});
