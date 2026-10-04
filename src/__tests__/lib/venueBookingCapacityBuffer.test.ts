/**
 * Tests for venue booking capacity buffer and overflow management.
 */

interface CapacitySlot {
  slotId: string;
  venueId: string;
  date: string;
  maxCapacity: number;
  confirmedBookings: number;
  pendingBookings: number;
  bufferPercent: number;   // % of capacity held as buffer
  allowOverbooking: boolean;
  overbookingPercent: number; // allowed overbook above maxCapacity
}

function effectiveCapacity(slot: CapacitySlot): number {
  const buffer = Math.floor(slot.maxCapacity * (slot.bufferPercent / 100));
  return slot.maxCapacity - buffer;
}

function totalBookings(slot: CapacitySlot): number {
  return slot.confirmedBookings + slot.pendingBookings;
}

function availableUnits(slot: CapacitySlot): number {
  const effective = effectiveCapacity(slot);
  return Math.max(0, effective - totalBookings(slot));
}

function isOverbooked(slot: CapacitySlot): boolean {
  if (slot.allowOverbooking) {
    const maxAllowed = Math.floor(slot.maxCapacity * (1 + slot.overbookingPercent / 100));
    return totalBookings(slot) > maxAllowed;
  }
  return totalBookings(slot) > slot.maxCapacity;
}

function occupancyPercent(slot: CapacitySlot): number {
  if (slot.maxCapacity === 0) return 0;
  return Math.round((totalBookings(slot) / slot.maxCapacity) * 100);
}

function canAcceptBooking(slot: CapacitySlot, units: number): boolean {
  return availableUnits(slot) >= units;
}

const SLOT: CapacitySlot = {
  slotId: "s1", venueId: "v1", date: "2026-11-01",
  maxCapacity: 200, confirmedBookings: 140, pendingBookings: 20,
  bufferPercent: 10, allowOverbooking: true, overbookingPercent: 5,
};

describe("Capacity buffer and overflow management", () => {
  it("effectiveCapacity: 200 - 10% = 180", () => {
    expect(effectiveCapacity(SLOT)).toBe(180);
  });

  it("totalBookings: 140 + 20 = 160", () => {
    expect(totalBookings(SLOT)).toBe(160);
  });

  it("availableUnits: 180 - 160 = 20", () => {
    expect(availableUnits(SLOT)).toBe(20);
  });

  it("isOverbooked: 160 < 210 max with 5% over → false", () => {
    expect(isOverbooked(SLOT)).toBe(false);
  });

  it("occupancyPercent: 160/200 = 80%", () => {
    expect(occupancyPercent(SLOT)).toBe(80);
  });

  it("canAcceptBooking: 15 units available → true", () => {
    expect(canAcceptBooking(SLOT, 15)).toBe(true);
  });

  it("canAcceptBooking: 25 units exceeds available 20 → false", () => {
    expect(canAcceptBooking(SLOT, 25)).toBe(false);
  });
});
