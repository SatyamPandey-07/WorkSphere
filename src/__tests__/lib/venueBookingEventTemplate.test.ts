/**
 * Tests for venue booking event template configuration engine.
 */

type EventType = "conference" | "wedding" | "workshop" | "concert" | "private_party" | "corporate";

interface EventTemplate {
  type: EventType;
  defaultCapacity: number;
  setupHours: number;
  teardownHours: number;
  requiredAmenities: string[];
  basePriceMultiplier: number;
  minBookingHours: number;
}

const TEMPLATES: Record<EventType, EventTemplate> = {
  conference:    { type: "conference",    defaultCapacity: 200, setupHours: 2, teardownHours: 1, requiredAmenities: ["projector", "av_system", "wifi"], basePriceMultiplier: 1.2, minBookingHours: 4 },
  wedding:       { type: "wedding",       defaultCapacity: 150, setupHours: 4, teardownHours: 2, requiredAmenities: ["catering", "dance_floor", "lighting"], basePriceMultiplier: 1.8, minBookingHours: 8 },
  workshop:      { type: "workshop",      defaultCapacity: 30,  setupHours: 1, teardownHours: 1, requiredAmenities: ["whiteboard", "wifi"], basePriceMultiplier: 0.9, minBookingHours: 2 },
  concert:       { type: "concert",       defaultCapacity: 500, setupHours: 6, teardownHours: 3, requiredAmenities: ["stage", "sound_system", "lighting"], basePriceMultiplier: 2.0, minBookingHours: 6 },
  private_party: { type: "private_party", defaultCapacity: 80,  setupHours: 2, teardownHours: 1, requiredAmenities: ["bar", "lighting"], basePriceMultiplier: 1.1, minBookingHours: 3 },
  corporate:     { type: "corporate",     defaultCapacity: 100, setupHours: 1, teardownHours: 1, requiredAmenities: ["wifi", "av_system"], basePriceMultiplier: 1.15, minBookingHours: 3 },
};

function totalEventHours(eventType: EventType, bookingHours: number): number {
  const t = TEMPLATES[eventType];
  return t.setupHours + bookingHours + t.teardownHours;
}

function templatePrice(eventType: EventType, basePrice: number, bookingHours: number): number {
  const t = TEMPLATES[eventType];
  if (bookingHours < t.minBookingHours) return 0; // invalid
  return Math.round(basePrice * t.basePriceMultiplier * bookingHours * 100) / 100;
}

function hasRequiredAmenities(eventType: EventType, venueAmenities: string[]): boolean {
  return TEMPLATES[eventType].requiredAmenities.every((a) => venueAmenities.includes(a));
}

function missingAmenities(eventType: EventType, venueAmenities: string[]): string[] {
  return TEMPLATES[eventType].requiredAmenities.filter((a) => !venueAmenities.includes(a));
}

function eventsByCapacity(minCapacity: number): EventType[] {
  return (Object.values(TEMPLATES) as EventTemplate[])
    .filter((t) => t.defaultCapacity >= minCapacity)
    .map((t) => t.type);
}

describe("Event template configuration engine", () => {
  it("totalEventHours: workshop 3h booking = 5h total", () => {
    expect(totalEventHours("workshop", 3)).toBe(5);
  });

  it("templatePrice: wedding 8h at $100 base = $1440", () => {
    expect(templatePrice("wedding", 100, 8)).toBe(1440);
  });

  it("templatePrice: below min hours → 0", () => {
    expect(templatePrice("conference", 100, 2)).toBe(0);
  });

  it("hasRequiredAmenities: all present → true", () => {
    expect(hasRequiredAmenities("workshop", ["whiteboard", "wifi", "projector"])).toBe(true);
  });

  it("missingAmenities: identifies missing ones", () => {
    const missing = missingAmenities("conference", ["wifi"]);
    expect(missing).toContain("projector");
    expect(missing).toContain("av_system");
  });

  it("eventsByCapacity: only concert for 300+", () => {
    const types = eventsByCapacity(300);
    expect(types).toContain("concert");
    expect(types).not.toContain("workshop");
  });
});
