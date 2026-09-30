/**
 * Tests for venue reservation system with optimistic locking.
 */

interface ReservationSlot {
  slotId: string;
  venueId: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  capacity: number;
  reservedCount: number;
  version: number;       // optimistic locking version
}

function tryReserve(
  slot: ReservationSlot,
  seats: number,
  expectedVersion: number
): ReservationSlot | null {
  if (slot.version !== expectedVersion) return null; // version conflict
  if (slot.reservedCount + seats > slot.capacity) return null; // no capacity
  return {
    ...slot,
    reservedCount: slot.reservedCount + seats,
    version: slot.version + 1,
  };
}

function tryRelease(
  slot: ReservationSlot,
  seats: number,
  expectedVersion: number
): ReservationSlot | null {
  if (slot.version !== expectedVersion) return null;
  const newCount = Math.max(0, slot.reservedCount - seats);
  return { ...slot, reservedCount: newCount, version: slot.version + 1 };
}

function availableSeats(slot: ReservationSlot): number {
  return slot.capacity - slot.reservedCount;
}

function isSlotOverbooked(slot: ReservationSlot): boolean {
  return slot.reservedCount > slot.capacity;
}

const SLOT: ReservationSlot = {
  slotId: "sl1", venueId: "v1", date: "2026-10-01",
  startMinutes: 540, endMinutes: 720,
  capacity: 10, reservedCount: 6, version: 3,
};

describe("Venue reservation system with optimistic locking", () => {
  it("tryReserve: correct version + capacity → new slot", () => {
    const updated = tryReserve(SLOT, 3, 3);
    expect(updated!.reservedCount).toBe(9);
    expect(updated!.version).toBe(4);
  });

  it("tryReserve: wrong version → null (conflict)", () => {
    expect(tryReserve(SLOT, 2, 5)).toBeNull(); // version 5 != 3
  });

  it("tryReserve: exceeds capacity → null", () => {
    expect(tryReserve(SLOT, 6, 3)).toBeNull(); // 6+6=12 > 10
  });

  it("tryRelease: releases seats", () => {
    const updated = tryRelease(SLOT, 2, 3);
    expect(updated!.reservedCount).toBe(4);
    expect(updated!.version).toBe(4);
  });

  it("tryRelease: wrong version → null", () => {
    expect(tryRelease(SLOT, 2, 99)).toBeNull();
  });

  it("availableSeats: 10-6 = 4", () => {
    expect(availableSeats(SLOT)).toBe(4);
  });

  it("isSlotOverbooked: 6/10 → false", () => {
    expect(isSlotOverbooked(SLOT)).toBe(false);
  });

  it("isSlotOverbooked: over capacity → true", () => {
    expect(isSlotOverbooked({ ...SLOT, reservedCount: 15 })).toBe(true);
  });
});
