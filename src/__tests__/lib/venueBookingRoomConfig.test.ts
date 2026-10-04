/**
 * Tests for venue room configuration and layout management.
 */

type RoomType = "ballroom" | "boardroom" | "breakout" | "auditorium" | "studio" | "outdoor";

interface Room {
  id: string;
  venueId: string;
  name: string;
  type: RoomType;
  sqm: number;
  maxCapacity: number;
  pricePerHour: number;
  amenities: string[];
  connectable: string[];  // IDs of rooms that can be combined with this one
}

interface RoomConfig {
  rooms: Room[];
  combinedCapacity: number;
  combinedSqm: number;
  combinedPrice: number;
  discountPercent: number;
}

function singleRoomConfig(room: Room, hours: number): { capacity: number; totalCost: number } {
  return {
    capacity: room.maxCapacity,
    totalCost: Math.round(room.pricePerHour * hours * 100) / 100,
  };
}

function canCombine(roomA: Room, roomB: Room): boolean {
  return roomA.connectable.includes(roomB.id) || roomB.connectable.includes(roomA.id);
}

function combinedRoomConfig(rooms: Room[], discountPercent = 10): RoomConfig {
  const totalCap = rooms.reduce((s, r) => s + r.maxCapacity, 0);
  const totalSqm = rooms.reduce((s, r) => s + r.sqm, 0);
  const basePrice = rooms.reduce((s, r) => s + r.pricePerHour, 0);
  const discountedPrice = Math.round(basePrice * (1 - discountPercent / 100) * 100) / 100;
  return { rooms, combinedCapacity: totalCap, combinedSqm: totalSqm, combinedPrice: discountedPrice, discountPercent };
}

function roomsForCapacity(rooms: Room[], minCapacity: number): Room[] {
  return rooms.filter((r) => r.maxCapacity >= minCapacity);
}

function sharedAmenities(roomA: Room, roomB: Room): string[] {
  return roomA.amenities.filter((a) => roomB.amenities.includes(a));
}

const ROOMS: Room[] = [
  { id: "r1", venueId: "v1", name: "Grand Ballroom", type: "ballroom",  sqm: 500, maxCapacity: 400, pricePerHour: 300, amenities: ["wifi", "av", "catering", "stage"],   connectable: ["r2"] },
  { id: "r2", venueId: "v1", name: "East Wing",      type: "ballroom",  sqm: 300, maxCapacity: 200, pricePerHour: 200, amenities: ["wifi", "av", "catering"],             connectable: ["r1"] },
  { id: "r3", venueId: "v1", name: "Boardroom A",    type: "boardroom", sqm: 50,  maxCapacity: 20,  pricePerHour: 80,  amenities: ["wifi", "av", "whiteboard"],           connectable: [] },
];

describe("Room configuration management", () => {
  it("singleRoomConfig: Grand Ballroom 4h = $1200", () => {
    const config = singleRoomConfig(ROOMS[0], 4);
    expect(config.totalCost).toBe(1200);
    expect(config.capacity).toBe(400);
  });

  it("canCombine: r1 and r2 can combine → true", () => {
    expect(canCombine(ROOMS[0], ROOMS[1])).toBe(true);
  });

  it("canCombine: r3 and r1 cannot combine → false", () => {
    expect(canCombine(ROOMS[2], ROOMS[0])).toBe(false);
  });

  it("combinedRoomConfig: r1+r2 = 600 capacity, 10% discount", () => {
    const config = combinedRoomConfig([ROOMS[0], ROOMS[1]]);
    expect(config.combinedCapacity).toBe(600);
    expect(config.combinedPrice).toBe(450); // (300+200)*0.9
  });

  it("roomsForCapacity: 100+ capacity returns r1 and r2", () => {
    const filtered = roomsForCapacity(ROOMS, 100);
    expect(filtered.length).toBe(2);
  });

  it("sharedAmenities: r1 and r2 share wifi, av, catering", () => {
    const shared = sharedAmenities(ROOMS[0], ROOMS[1]);
    expect(shared).toContain("wifi");
    expect(shared).toContain("av");
  });
});
