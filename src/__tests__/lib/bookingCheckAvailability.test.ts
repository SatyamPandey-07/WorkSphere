/**
 * Tests for real-time availability checking across multiple venues.
 */

interface VenueAvailability {
  venueId: string;
  date: string;
  availableSlots: {
    startMinutes: number;
    endMinutes: number;
    seatsAvailable: number;
    priceCents: number;
  }[];
  isOpenForDate: boolean;
}

function findAvailableVenues(
  availabilities: VenueAvailability[],
  date: string,
  startMinutes: number,
  endMinutes: number,
  minSeats: number
): string[] {
  return availabilities
    .filter((a) =>
      a.date === date &&
      a.isOpenForDate &&
      a.availableSlots.some(
        (s) => s.startMinutes <= startMinutes && s.endMinutes >= endMinutes && s.seatsAvailable >= minSeats
      )
    )
    .map((a) => a.venueId);
}

function cheapestAvailableSlot(
  availability: VenueAvailability,
  startMinutes: number,
  endMinutes: number,
  minSeats: number
): { priceCents: number; venueId: string } | null {
  if (!availability.isOpenForDate) return null;
  const slots = availability.availableSlots.filter(
    (s) => s.startMinutes <= startMinutes && s.endMinutes >= endMinutes && s.seatsAvailable >= minSeats
  );
  if (slots.length === 0) return null;
  const cheapest = slots.reduce((min, s) => s.priceCents < min.priceCents ? s : min);
  return { priceCents: cheapest.priceCents, venueId: availability.venueId };
}

const AVAIL: VenueAvailability[] = [
  {
    venueId: "v1", date: "2026-10-15", isOpenForDate: true,
    availableSlots: [
      { startMinutes: 480, endMinutes: 720, seatsAvailable: 10, priceCents: 1000 },
      { startMinutes: 720, endMinutes: 960, seatsAvailable: 5,  priceCents: 800  },
    ],
  },
  {
    venueId: "v2", date: "2026-10-15", isOpenForDate: true,
    availableSlots: [
      { startMinutes: 480, endMinutes: 1080, seatsAvailable: 20, priceCents: 1200 },
    ],
  },
  {
    venueId: "v3", date: "2026-10-15", isOpenForDate: false, availableSlots: [],
  },
];

describe("Real-time venue availability check", () => {
  it("findAvailableVenues: 9am-12pm with 5 seats", () => {
    const available = findAvailableVenues(AVAIL, "2026-10-15", 540, 720, 5);
    expect(available).toContain("v1");
    expect(available).toContain("v2");
  });

  it("findAvailableVenues: closed venue excluded", () => {
    const available = findAvailableVenues(AVAIL, "2026-10-15", 540, 720, 1);
    expect(available).not.toContain("v3");
  });

  it("findAvailableVenues: different date → empty", () => {
    expect(findAvailableVenues(AVAIL, "2026-10-16", 540, 720, 1)).toHaveLength(0);
  });

  it("cheapestAvailableSlot: v1 afternoon slot = 800", () => {
    const result = cheapestAvailableSlot(AVAIL[0], 720, 960, 3);
    expect(result!.priceCents).toBe(800);
  });

  it("cheapestAvailableSlot: too many seats needed → null", () => {
    expect(cheapestAvailableSlot(AVAIL[0], 720, 960, 10)).toBeNull(); // only 5 available
  });

  it("cheapestAvailableSlot: closed venue → null", () => {
    expect(cheapestAvailableSlot(AVAIL[2], 480, 720, 1)).toBeNull();
  });
});
