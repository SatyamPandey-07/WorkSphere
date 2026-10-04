/**
 * Tests for venue booking lifecycle KPI measurement.
 */

interface BookingLifecycleEvent {
  bookingId: string;
  event: "inquiry" | "quote_sent" | "booking_created" | "payment_received" | "confirmed" | "completed" | "cancelled";
  timestamp: number;
}

interface BookingJourney {
  bookingId: string;
  events: BookingLifecycleEvent[];
  finalStatus: "completed" | "cancelled" | "pending";
  totalValue: number;
}

function eventTimestamp(journey: BookingJourney, event: BookingLifecycleEvent["event"]): number | null {
  return journey.events.find((e) => e.event === event)?.timestamp ?? null;
}

function timeToConfirmMs(journey: BookingJourney): number | null {
  const created = eventTimestamp(journey, "booking_created");
  const confirmed = eventTimestamp(journey, "confirmed");
  if (!created || !confirmed) return null;
  return confirmed - created;
}

function timeToPayMs(journey: BookingJourney): number | null {
  const created = eventTimestamp(journey, "booking_created");
  const paid = eventTimestamp(journey, "payment_received");
  if (!created || !paid) return null;
  return paid - created;
}

function avgTimeToConfirmMs(journeys: BookingJourney[]): number {
  const times = journeys.map((j) => timeToConfirmMs(j)).filter((t): t is number => t !== null);
  if (times.length === 0) return 0;
  return Math.round(times.reduce((s, t) => s + t, 0) / times.length);
}

function completionRate(journeys: BookingJourney[]): number {
  if (journeys.length === 0) return 0;
  return Math.round((journeys.filter((j) => j.finalStatus === "completed").length / journeys.length) * 100);
}

function avgBookingValue(journeys: BookingJourney[]): number {
  const completed = journeys.filter((j) => j.finalStatus === "completed");
  if (completed.length === 0) return 0;
  return Math.round(completed.reduce((s, j) => s + j.totalValue, 0) / completed.length * 100) / 100;
}

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
const JOURNEYS: BookingJourney[] = [
  {
    bookingId: "b1", finalStatus: "completed", totalValue: 1200,
    events: [
      { bookingId: "b1", event: "booking_created",  timestamp: NOW - 48 * HOUR },
      { bookingId: "b1", event: "payment_received", timestamp: NOW - 36 * HOUR },
      { bookingId: "b1", event: "confirmed",        timestamp: NOW - 24 * HOUR },
      { bookingId: "b1", event: "completed",        timestamp: NOW },
    ],
  },
  {
    bookingId: "b2", finalStatus: "cancelled", totalValue: 0,
    events: [
      { bookingId: "b2", event: "booking_created", timestamp: NOW - 72 * HOUR },
      { bookingId: "b2", event: "cancelled",       timestamp: NOW - 60 * HOUR },
    ],
  },
];

describe("Booking lifecycle KPI measurement", () => {
  it("timeToConfirmMs: b1 confirmed 24h after creation", () => {
    expect(timeToConfirmMs(JOURNEYS[0])).toBe(24 * HOUR);
  });

  it("timeToPayMs: b1 paid 12h after creation", () => {
    expect(timeToPayMs(JOURNEYS[0])).toBe(12 * HOUR);
  });

  it("avgTimeToConfirmMs: only b1 has confirmation", () => {
    expect(avgTimeToConfirmMs(JOURNEYS)).toBe(24 * HOUR);
  });

  it("completionRate: 1 of 2 = 50%", () => {
    expect(completionRate(JOURNEYS)).toBe(50);
  });

  it("avgBookingValue: only b1 completed = $1200", () => {
    expect(avgBookingValue(JOURNEYS)).toBe(1200);
  });

  it("eventTimestamp: null for missing event", () => {
    expect(eventTimestamp(JOURNEYS[1], "confirmed")).toBeNull();
  });
});
