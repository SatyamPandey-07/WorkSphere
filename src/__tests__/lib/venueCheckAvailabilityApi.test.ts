/**
 * Tests for venue real-time availability check API response parsing.
 */

interface AvailabilitySlot {
  startMs: number;
  endMs: number;
  seatType: string;
  availableCount: number;
  priceCents: number;
}

interface AvailabilityResponse {
  venueId: string;
  date: string;
  slots: AvailabilitySlot[];
  lastUpdatedMs: number;
}

function isFreshResponse(response: AvailabilityResponse, nowMs: number, maxAgeMs = 60_000): boolean {
  return nowMs - response.lastUpdatedMs <= maxAgeMs;
}

function availableSlotsForType(
  response: AvailabilityResponse,
  seatType: string,
  minSeats: number
): AvailabilitySlot[] {
  return response.slots.filter(
    (s) => s.seatType === seatType && s.availableCount >= minSeats
  );
}

function cheapestSlot(slots: AvailabilitySlot[]): AvailabilitySlot | null {
  if (slots.length === 0) return null;
  return slots.reduce((min, s) => s.priceCents < min.priceCents ? s : min);
}

function totalAvailableSeats(response: AvailabilityResponse, seatType: string): number {
  return response.slots
    .filter((s) => s.seatType === seatType)
    .reduce((sum, s) => sum + s.availableCount, 0);
}

const NOW = 1_700_000_000_000;
const RESPONSE: AvailabilityResponse = {
  venueId: "v1",
  date: "2026-10-01",
  lastUpdatedMs: NOW - 30_000,
  slots: [
    { startMs: NOW + 3600_000, endMs: NOW + 7200_000, seatType: "hot_desk",  availableCount: 5, priceCents: 1000 },
    { startMs: NOW + 7200_000, endMs: NOW + 10800_000, seatType: "hot_desk", availableCount: 3, priceCents: 800  },
    { startMs: NOW + 3600_000, endMs: NOW + 7200_000, seatType: "private",   availableCount: 1, priceCents: 3000 },
  ],
};

describe("Venue availability API response", () => {
  it("isFreshResponse: 30s old → fresh", () => {
    expect(isFreshResponse(RESPONSE, NOW)).toBe(true);
  });

  it("isFreshResponse: 90s old → stale", () => {
    expect(isFreshResponse(RESPONSE, NOW + 90_000)).toBe(false);
  });

  it("availableSlotsForType: hot_desk with 3+ seats", () => {
    const slots = availableSlotsForType(RESPONSE, "hot_desk", 3);
    expect(slots).toHaveLength(2);
  });

  it("availableSlotsForType: hot_desk needing 6 → empty (none have 6+)", () => {
    const slots = availableSlotsForType(RESPONSE, "hot_desk", 6);
    expect(slots).toHaveLength(0);
  });

  it("cheapestSlot: hot_desk lowest is 800", () => {
    const slots = availableSlotsForType(RESPONSE, "hot_desk", 1);
    expect(cheapestSlot(slots)!.priceCents).toBe(800);
  });

  it("cheapestSlot: empty → null", () => {
    expect(cheapestSlot([])).toBeNull();
  });

  it("totalAvailableSeats: hot_desk = 5+3 = 8", () => {
    expect(totalAvailableSeats(RESPONSE, "hot_desk")).toBe(8);
  });

  it("totalAvailableSeats: private = 1", () => {
    expect(totalAvailableSeats(RESPONSE, "private")).toBe(1);
  });
});
