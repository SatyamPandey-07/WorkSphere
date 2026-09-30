/**
 * Tests for venue tour/viewing appointment booking.
 */

interface TourSlot {
  id: string;
  venueId: string;
  startMs: number;
  durationMinutes: number;
  maxAttendees: number;
  bookedCount: number;
  isVirtual: boolean;
}

function isSlotAvailable(slot: TourSlot, nowMs: number): boolean {
  if (slot.startMs <= nowMs) return false; // past
  return slot.bookedCount < slot.maxAttendees;
}

function bookSlot(slot: TourSlot): TourSlot {
  if (slot.bookedCount >= slot.maxAttendees) throw new Error("No availability");
  return { ...slot, bookedCount: slot.bookedCount + 1 };
}

function tourEndMs(slot: TourSlot): number {
  return slot.startMs + slot.durationMinutes * 60_000;
}

function upcomingVirtualTours(slots: TourSlot[], venueId: string, nowMs: number): TourSlot[] {
  return slots
    .filter((s) => s.venueId === venueId && s.isVirtual && s.startMs > nowMs)
    .sort((a, b) => a.startMs - b.startMs);
}

const NOW = 1_700_000_000_000;
const SLOT: TourSlot = {
  id: "t1", venueId: "v1", startMs: NOW + 3600_000,
  durationMinutes: 30, maxAttendees: 4, bookedCount: 2, isVirtual: false,
};

describe("Venue tour booking", () => {
  it("isSlotAvailable: future with space → true", () => {
    expect(isSlotAvailable(SLOT, NOW)).toBe(true);
  });

  it("isSlotAvailable: past slot → false", () => {
    expect(isSlotAvailable(SLOT, NOW + 7200_000)).toBe(false);
  });

  it("isSlotAvailable: fully booked → false", () => {
    expect(isSlotAvailable({ ...SLOT, bookedCount: 4 }, NOW)).toBe(false);
  });

  it("bookSlot increments bookedCount", () => {
    const updated = bookSlot(SLOT);
    expect(updated.bookedCount).toBe(3);
  });

  it("bookSlot throws when full", () => {
    expect(() => bookSlot({ ...SLOT, bookedCount: 4 })).toThrow("No availability");
  });

  it("bookSlot is immutable", () => {
    bookSlot(SLOT);
    expect(SLOT.bookedCount).toBe(2);
  });

  it("tourEndMs: 30 min after start", () => {
    expect(tourEndMs(SLOT)).toBe(NOW + 3600_000 + 30 * 60_000);
  });

  it("upcomingVirtualTours filters virtual and future", () => {
    const slots: TourSlot[] = [
      { ...SLOT, id: "t2", isVirtual: true,  startMs: NOW + 1000  },
      { ...SLOT, id: "t3", isVirtual: false, startMs: NOW + 2000  },
      { ...SLOT, id: "t4", isVirtual: true,  startMs: NOW - 1000  }, // past
    ];
    const upcoming = upcomingVirtualTours(slots, "v1", NOW);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].id).toBe("t2");
  });
});
