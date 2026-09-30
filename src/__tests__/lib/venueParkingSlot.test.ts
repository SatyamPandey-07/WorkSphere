/**
 * Tests for venue parking slot availability and reservation.
 */

type VehicleType = "car" | "motorcycle" | "bicycle" | "accessible";

interface ParkingSlot {
  id: string;
  venueId: string;
  type: VehicleType;
  isReserved: boolean;
  reservedBy: string | null;
  reservedUntil: number | null;
}

function isSlotFree(slot: ParkingSlot, nowMs: number): boolean {
  if (!slot.isReserved) return true;
  if (slot.reservedUntil !== null && nowMs >= slot.reservedUntil) return true;
  return false;
}

function reserveSlot(
  slot: ParkingSlot,
  userId: string,
  durationMs: number,
  nowMs: number
): ParkingSlot {
  if (!isSlotFree(slot, nowMs)) throw new Error("Slot already reserved");
  return { ...slot, isReserved: true, reservedBy: userId, reservedUntil: nowMs + durationMs };
}

function releaseSlot(slot: ParkingSlot, userId: string): ParkingSlot {
  if (slot.reservedBy !== userId) throw new Error("Only the reserver can release this slot");
  return { ...slot, isReserved: false, reservedBy: null, reservedUntil: null };
}

function availableByType(
  slots: ParkingSlot[],
  type: VehicleType,
  nowMs: number
): ParkingSlot[] {
  return slots.filter((s) => s.type === type && isSlotFree(s, nowMs));
}

const NOW = 1_700_000_000_000;
const FREE_SLOT: ParkingSlot = { id: "P1", venueId: "v1", type: "car", isReserved: false, reservedBy: null, reservedUntil: null };
const RESERVED_SLOT: ParkingSlot = { id: "P2", venueId: "v1", type: "car", isReserved: true, reservedBy: "u1", reservedUntil: NOW + 3_600_000 };

describe("Venue parking slot", () => {
  it("free slot is available", () => {
    expect(isSlotFree(FREE_SLOT, NOW)).toBe(true);
  });

  it("reserved slot is not available", () => {
    expect(isSlotFree(RESERVED_SLOT, NOW)).toBe(false);
  });

  it("expired reservation is available again", () => {
    expect(isSlotFree(RESERVED_SLOT, NOW + 4_000_000)).toBe(true);
  });

  it("reserveSlot assigns user and expiry", () => {
    const reserved = reserveSlot(FREE_SLOT, "u2", 3_600_000, NOW);
    expect(reserved.reservedBy).toBe("u2");
    expect(reserved.isReserved).toBe(true);
  });

  it("reserveSlot throws when not available", () => {
    expect(() => reserveSlot(RESERVED_SLOT, "u2", 3_600_000, NOW)).toThrow();
  });

  it("releaseSlot clears reservation", () => {
    const released = releaseSlot(RESERVED_SLOT, "u1");
    expect(released.isReserved).toBe(false);
    expect(released.reservedBy).toBeNull();
  });

  it("releaseSlot by non-owner throws", () => {
    expect(() => releaseSlot(RESERVED_SLOT, "u99")).toThrow("Only the reserver");
  });

  it("availableByType filters correctly", () => {
    const slots = [FREE_SLOT, RESERVED_SLOT, { ...FREE_SLOT, id: "P3", type: "bicycle" as VehicleType }];
    expect(availableByType(slots, "car", NOW)).toHaveLength(1);
  });
});
