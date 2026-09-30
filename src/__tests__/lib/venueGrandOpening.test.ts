/**
 * Tests for venue grand opening event management and promotions.
 */

interface GrandOpeningEvent {
  eventId: string;
  venueId: string;
  openingDate: string;
  celebrationPeriodDays: number;
  introductoryDiscountPct: number;
  freeTrialHours: number;
  maxAttendees: number;
  rsvpCount: number;
  launched: boolean;
}

function isInOpeningPeriod(event: GrandOpeningEvent, dateStr: string): boolean {
  if (!event.launched) return false;
  const openingDate = new Date(event.openingDate);
  const checkDate = new Date(dateStr);
  const endDate = new Date(openingDate.getTime() + event.celebrationPeriodDays * 86_400_000);
  return checkDate >= openingDate && checkDate <= endDate;
}

function openingDiscount(event: GrandOpeningEvent, baseCents: number, dateStr: string): number {
  if (!isInOpeningPeriod(event, dateStr)) return baseCents;
  return Math.round(baseCents * (1 - event.introductoryDiscountPct / 100));
}

function canRsvp(event: GrandOpeningEvent): boolean {
  return !event.launched || event.rsvpCount < event.maxAttendees;
}

function daysUntilOpening(event: GrandOpeningEvent, todayStr: string): number {
  const opening = new Date(event.openingDate).getTime();
  const today = new Date(todayStr).getTime();
  return Math.max(0, Math.ceil((opening - today) / 86_400_000));
}

function addRsvp(event: GrandOpeningEvent): GrandOpeningEvent {
  if (!canRsvp(event)) throw new Error("RSVP limit reached or event not accepting RSVPs");
  return { ...event, rsvpCount: event.rsvpCount + 1 };
}

const EVENT: GrandOpeningEvent = {
  eventId: "go1", venueId: "v1", openingDate: "2026-11-01",
  celebrationPeriodDays: 7, introductoryDiscountPct: 25,
  freeTrialHours: 2, maxAttendees: 200, rsvpCount: 150,
  launched: true,
};

describe("Venue grand opening", () => {
  it("isInOpeningPeriod: opening day → true", () => {
    expect(isInOpeningPeriod(EVENT, "2026-11-01")).toBe(true);
  });

  it("isInOpeningPeriod: day 5 → true", () => {
    expect(isInOpeningPeriod(EVENT, "2026-11-05")).toBe(true);
  });

  it("isInOpeningPeriod: day 8 (after period) → false", () => {
    expect(isInOpeningPeriod(EVENT, "2026-11-09")).toBe(false);
  });

  it("isInOpeningPeriod: not launched → false", () => {
    expect(isInOpeningPeriod({ ...EVENT, launched: false }, "2026-11-01")).toBe(false);
  });

  it("openingDiscount: 25% off during period", () => {
    expect(openingDiscount(EVENT, 10_000, "2026-11-03")).toBe(7_500);
  });

  it("openingDiscount: no discount outside period", () => {
    expect(openingDiscount(EVENT, 10_000, "2026-12-01")).toBe(10_000);
  });

  it("canRsvp: below max → true", () => {
    expect(canRsvp(EVENT)).toBe(true);
  });

  it("canRsvp: at max → false", () => {
    expect(canRsvp({ ...EVENT, rsvpCount: 200 })).toBe(false);
  });

  it("daysUntilOpening: before opening date", () => {
    expect(daysUntilOpening(EVENT, "2026-10-15")).toBeGreaterThan(0);
  });

  it("addRsvp: increments count", () => {
    expect(addRsvp(EVENT).rsvpCount).toBe(151);
  });
});
