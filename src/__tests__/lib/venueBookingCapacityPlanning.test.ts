/**
 * Tests for venue capacity planning and load management.
 */

interface CapacityConfig {
  venueId: string;
  maxCapacity: number;
  safeCapacity: number;    // recommended max (usually 80% of max)
  emergencyExits: number;
  squareMeters: number;
}

interface CapacityEvent {
  venueId: string;
  eventDate: string;
  confirmedGuests: number;
  expectedGuests: number;
  standingAllowed: boolean;
}

function safetyCapacity(config: CapacityConfig): number {
  return Math.min(config.safeCapacity, config.maxCapacity);
}

function capacityUtilisation(event: CapacityEvent, config: CapacityConfig): number {
  return Math.round((event.confirmedGuests / config.maxCapacity) * 100);
}

function isOverCapacity(event: CapacityEvent, config: CapacityConfig): boolean {
  return event.confirmedGuests > config.maxCapacity;
}

function isNearCapacity(event: CapacityEvent, config: CapacityConfig, threshold = 0.85): boolean {
  return event.confirmedGuests >= config.maxCapacity * threshold;
}

function densityPerSqm(event: CapacityEvent, config: CapacityConfig): number {
  if (config.squareMeters === 0) return 0;
  return Math.round((event.confirmedGuests / config.squareMeters) * 100) / 100;
}

function requiredExitCapacity(guestCount: number, personsPerExit = 100): number {
  return Math.ceil(guestCount / personsPerExit);
}

function hasAdequateExits(event: CapacityEvent, config: CapacityConfig): boolean {
  return config.emergencyExits >= requiredExitCapacity(event.confirmedGuests);
}

const CONFIG: CapacityConfig = {
  venueId: "v1", maxCapacity: 300, safeCapacity: 250, emergencyExits: 4, squareMeters: 500,
};
const EVENT: CapacityEvent = {
  venueId: "v1", eventDate: "2026-11-01", confirmedGuests: 270,
  expectedGuests: 280, standingAllowed: false,
};

describe("Venue capacity planning", () => {
  it("capacityUtilisation: 270 of 300 = 90%", () => {
    expect(capacityUtilisation(EVENT, CONFIG)).toBe(90);
  });

  it("isOverCapacity: 270 < 300 → false", () => {
    expect(isOverCapacity(EVENT, CONFIG)).toBe(false);
  });

  it("isNearCapacity: 270 ≥ 255 (85%) → true", () => {
    expect(isNearCapacity(EVENT, CONFIG)).toBe(true);
  });

  it("densityPerSqm: 270 / 500 = 0.54", () => {
    expect(densityPerSqm(EVENT, CONFIG)).toBe(0.54);
  });

  it("requiredExitCapacity: 270 guests → 3 exits", () => {
    expect(requiredExitCapacity(270)).toBe(3);
  });

  it("hasAdequateExits: 4 exits for 270 → true", () => {
    expect(hasAdequateExits(EVENT, CONFIG)).toBe(true);
  });
});
