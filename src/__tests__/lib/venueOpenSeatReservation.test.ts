/**
 * Tests for open seat (first-come-first-served) reservation.
 */

interface OpenSeat {
  seatId: string;
  venueId: string;
  zone: string;
  isOccupied: boolean;
  occupiedBy: string | null;
  occupiedSince: number | null;
}

function availableSeats(seats: OpenSeat[], venueId: string, zone?: string): OpenSeat[] {
  return seats.filter(
    (s) => s.venueId === venueId && !s.isOccupied && (zone ? s.zone === zone : true)
  );
}

function occupySeat(seat: OpenSeat, userId: string, nowMs: number): OpenSeat {
  if (seat.isOccupied) throw new Error(`Seat ${seat.seatId} is already occupied`);
  return { ...seat, isOccupied: true, occupiedBy: userId, occupiedSince: nowMs };
}

function vacateSeat(seat: OpenSeat, userId: string): OpenSeat {
  if (seat.occupiedBy !== userId) throw new Error("Only the occupant can vacate");
  return { ...seat, isOccupied: false, occupiedBy: null, occupiedSince: null };
}

function occupancyByZone(seats: OpenSeat[], venueId: string): Record<string, { total: number; occupied: number }> {
  const result: Record<string, { total: number; occupied: number }> = {};
  seats.filter((s) => s.venueId === venueId).forEach((s) => {
    if (!result[s.zone]) result[s.zone] = { total: 0, occupied: 0 };
    result[s.zone].total++;
    if (s.isOccupied) result[s.zone].occupied++;
  });
  return result;
}

const NOW = 1_700_000_000_000;
const SEATS: OpenSeat[] = [
  { seatId: "s1", venueId: "v1", zone: "quiet", isOccupied: false,  occupiedBy: null, occupiedSince: null        },
  { seatId: "s2", venueId: "v1", zone: "quiet", isOccupied: true,   occupiedBy: "u1", occupiedSince: NOW - 1000  },
  { seatId: "s3", venueId: "v1", zone: "social",isOccupied: false,  occupiedBy: null, occupiedSince: null        },
  { seatId: "s4", venueId: "v2", zone: "quiet", isOccupied: false,  occupiedBy: null, occupiedSince: null        },
];

describe("Open seat reservation", () => {
  it("availableSeats: v1 total available = 2", () => {
    expect(availableSeats(SEATS, "v1")).toHaveLength(2);
  });

  it("availableSeats: quiet zone v1 available = 1", () => {
    expect(availableSeats(SEATS, "v1", "quiet")).toHaveLength(1);
  });

  it("occupySeat: assigns user", () => {
    const occupied = occupySeat(SEATS[0], "u2", NOW);
    expect(occupied.isOccupied).toBe(true);
    expect(occupied.occupiedBy).toBe("u2");
  });

  it("occupySeat: throws when already occupied", () => {
    expect(() => occupySeat(SEATS[1], "u2", NOW)).toThrow("already occupied");
  });

  it("vacateSeat: clears occupation", () => {
    const vacated = vacateSeat(SEATS[1], "u1");
    expect(vacated.isOccupied).toBe(false);
    expect(vacated.occupiedBy).toBeNull();
  });

  it("vacateSeat: throws for wrong user", () => {
    expect(() => vacateSeat(SEATS[1], "u2")).toThrow("Only the occupant");
  });

  it("occupancyByZone: quiet has 2 total, 1 occupied", () => {
    const zones = occupancyByZone(SEATS, "v1");
    expect(zones["quiet"].total).toBe(2);
    expect(zones["quiet"].occupied).toBe(1);
  });
});
