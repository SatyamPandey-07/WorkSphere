/**
 * Tests for venue parking space reservation system.
 */

type VehicleSize = "motorcycle" | "compact" | "standard" | "suv" | "accessible";

interface ParkingSpot {
  spotId: string;
  venueId: string;
  level: number;
  section: string;
  isAccessible: boolean;
  supportedSizes: VehicleSize[];
  isReserved: boolean;
  reservedBy: string | null;
  reservedUntil: number | null;
  pricePerHourCents: number;
}

function isSpotAvailable(spot: ParkingSpot, nowMs: number): boolean {
  if (!spot.isReserved) return true;
  if (spot.reservedUntil !== null && nowMs >= spot.reservedUntil) return true;
  return false;
}

function canFitVehicle(spot: ParkingSpot, vehicleSize: VehicleSize): boolean {
  return spot.supportedSizes.includes(vehicleSize);
}

function reserveSpot(
  spot: ParkingSpot,
  userId: string,
  durationMs: number,
  nowMs: number
): ParkingSpot {
  if (!isSpotAvailable(spot, nowMs)) throw new Error("Spot not available");
  return { ...spot, isReserved: true, reservedBy: userId, reservedUntil: nowMs + durationMs };
}

function releaseSpot(spot: ParkingSpot, userId: string): ParkingSpot {
  if (spot.reservedBy !== userId) throw new Error("Only reserver can release");
  return { ...spot, isReserved: false, reservedBy: null, reservedUntil: null };
}

function availableForVehicle(
  spots: ParkingSpot[],
  venueId: string,
  vehicleSize: VehicleSize,
  nowMs: number
): ParkingSpot[] {
  return spots.filter(
    (s) => s.venueId === venueId && isSpotAvailable(s, nowMs) && canFitVehicle(s, vehicleSize)
  );
}

const NOW = 1_700_000_000_000;
const SPOTS: ParkingSpot[] = [
  { spotId: "p1", venueId: "v1", level: 1, section: "A", isAccessible: false, supportedSizes: ["compact", "standard", "suv"], isReserved: false, reservedBy: null, reservedUntil: null, pricePerHourCents: 200 },
  { spotId: "p2", venueId: "v1", level: 1, section: "A", isAccessible: true,  supportedSizes: ["accessible", "compact", "standard"], isReserved: false, reservedBy: null, reservedUntil: null, pricePerHourCents: 200 },
  { spotId: "p3", venueId: "v1", level: 2, section: "B", isAccessible: false, supportedSizes: ["motorcycle"], isReserved: true, reservedBy: "u1", reservedUntil: NOW + 3600_000, pricePerHourCents: 100 },
];

describe("Venue parking reservation", () => {
  it("isSpotAvailable: free spot → true", () => {
    expect(isSpotAvailable(SPOTS[0], NOW)).toBe(true);
  });

  it("isSpotAvailable: reserved → false", () => {
    expect(isSpotAvailable(SPOTS[2], NOW)).toBe(false);
  });

  it("isSpotAvailable: expired reservation → true", () => {
    expect(isSpotAvailable(SPOTS[2], NOW + 2 * 3600_000)).toBe(true);
  });

  it("canFitVehicle: standard fits in p1", () => {
    expect(canFitVehicle(SPOTS[0], "standard")).toBe(true);
  });

  it("canFitVehicle: motorcycle doesn't fit in p1", () => {
    expect(canFitVehicle(SPOTS[0], "motorcycle")).toBe(false);
  });

  it("reserveSpot: assigns user and expiry", () => {
    const reserved = reserveSpot(SPOTS[0], "u2", 3600_000, NOW);
    expect(reserved.reservedBy).toBe("u2");
    expect(reserved.isReserved).toBe(true);
  });

  it("reserveSpot: throws when not available", () => {
    expect(() => reserveSpot(SPOTS[2], "u2", 3600_000, NOW)).toThrow("not available");
  });

  it("releaseSpot: frees the spot", () => {
    const released = releaseSpot(SPOTS[2], "u1");
    expect(released.isReserved).toBe(false);
  });

  it("availableForVehicle: standard car spots at v1", () => {
    const available = availableForVehicle(SPOTS, "v1", "standard", NOW);
    expect(available).toHaveLength(2); // p1 and p2
  });
});
