/**
 * Tests for venue capacity optimization through smart allocation.
 */

interface BookingRequest {
  requestId: string;
  seats: number;
  startMinutes: number;
  endMinutes: number;
  preferredSpaceType?: string;
}

interface Space {
  spaceId: string;
  type: string;
  capacity: number;
  existingBookings: { startMinutes: number; endMinutes: number; seats: number }[];
}

function availableCapacityAtTime(space: Space, startMin: number, endMin: number): number {
  const occupied = space.existingBookings
    .filter((b) => b.startMinutes < endMin && b.endMinutes > startMin)
    .reduce((sum, b) => sum + b.seats, 0);
  return Math.max(0, space.capacity - occupied);
}

function canAccommodate(space: Space, request: BookingRequest): boolean {
  const available = availableCapacityAtTime(space, request.startMinutes, request.endMinutes);
  return available >= request.seats;
}

function findBestSpace(spaces: Space[], request: BookingRequest): Space | null {
  const eligible = spaces
    .filter((s) => canAccommodate(s, request))
    .filter((s) => !request.preferredSpaceType || s.type === request.preferredSpaceType);

  if (eligible.length === 0) {
    // Fallback: any space that can accommodate
    const fallback = spaces.filter((s) => canAccommodate(s, request));
    if (fallback.length === 0) return null;
    return fallback.reduce((best, s) =>
      availableCapacityAtTime(s, request.startMinutes, request.endMinutes) <
      availableCapacityAtTime(best, request.startMinutes, request.endMinutes)
        ? s : best
    );
  }

  // Minimize wasted space
  return eligible.reduce((best, s) =>
    availableCapacityAtTime(s, request.startMinutes, request.endMinutes) <
    availableCapacityAtTime(best, request.startMinutes, request.endMinutes)
      ? s : best
  );
}

function utilizationAfterBooking(space: Space, request: BookingRequest): number {
  const totalMinutes = request.endMinutes - request.startMinutes;
  const newBookings = [...space.existingBookings, { startMinutes: request.startMinutes, endMinutes: request.endMinutes, seats: request.seats }];
  const bookedSeats = newBookings.reduce((sum, b) => {
    if (b.startMinutes < request.endMinutes && b.endMinutes > request.startMinutes) return sum + b.seats;
    return sum;
  }, 0);
  return Math.min(100, Math.round((bookedSeats / space.capacity) * 100));
}

const SPACES: Space[] = [
  { spaceId: "sp1", type: "small",  capacity: 5,  existingBookings: [] },
  { spaceId: "sp2", type: "medium", capacity: 15, existingBookings: [{ startMinutes: 540, endMinutes: 660, seats: 8 }] },
  { spaceId: "sp3", type: "large",  capacity: 30, existingBookings: [] },
];

const REQUEST: BookingRequest = { requestId: "r1", seats: 4, startMinutes: 540, endMinutes: 720 };

describe("Venue capacity optimization", () => {
  it("availableCapacityAtTime: sp2 at 540-720 = 15-8 = 7", () => {
    expect(availableCapacityAtTime(SPACES[1], 540, 720)).toBe(7);
  });

  it("canAccommodate: sp1 (5 capacity, 4 seats requested) → true", () => {
    expect(canAccommodate(SPACES[0], REQUEST)).toBe(true);
  });

  it("canAccommodate: sp2 (7 available, 4 requested) → true", () => {
    expect(canAccommodate(SPACES[1], REQUEST)).toBe(true);
  });

  it("findBestSpace: picks smallest fitting space (sp1)", () => {
    const best = findBestSpace(SPACES, REQUEST);
    expect(best!.spaceId).toBe("sp1"); // 5 available vs 7 in sp2 vs 30 in sp3
  });

  it("findBestSpace: preferred type honored", () => {
    const req = { ...REQUEST, preferredSpaceType: "large" };
    expect(findBestSpace(SPACES, req)!.spaceId).toBe("sp3");
  });

  it("findBestSpace: no space available → null", () => {
    const hugeReq = { ...REQUEST, seats: 100 };
    expect(findBestSpace(SPACES, hugeReq)).toBeNull();
  });
});
