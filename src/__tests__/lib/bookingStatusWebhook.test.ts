/**
 * Tests for booking status change webhook event payload construction.
 */

type BookingStatus = "pending" | "confirmed" | "checked_in" | "completed" | "cancelled";

interface WebhookEvent {
  eventType: string;
  bookingId: string;
  userId: string;
  venueId: string;
  previousStatus: BookingStatus;
  newStatus: BookingStatus;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

function buildStatusChangeEvent(
  bookingId: string,
  userId: string,
  venueId: string,
  from: BookingStatus,
  to: BookingStatus,
  nowMs: number,
  metadata?: Record<string, unknown>
): WebhookEvent {
  return {
    eventType: "booking.status_changed",
    bookingId,
    userId,
    venueId,
    previousStatus: from,
    newStatus: to,
    timestamp: nowMs,
    ...(metadata ? { metadata } : {}),
  };
}

function isValidTransition(from: BookingStatus, to: BookingStatus): boolean {
  const allowed: Partial<Record<BookingStatus, BookingStatus[]>> = {
    pending:    ["confirmed", "cancelled"],
    confirmed:  ["checked_in", "cancelled"],
    checked_in: ["completed"],
    completed:  [],
    cancelled:  [],
  };
  return (allowed[from] ?? []).includes(to);
}

function eventToJson(event: WebhookEvent): string {
  return JSON.stringify({ ...event, _version: "1.0" });
}

const NOW = 1_700_000_000_000;

describe("Booking status webhook", () => {
  it("buildStatusChangeEvent: correct eventType", () => {
    const e = buildStatusChangeEvent("b1", "u1", "v1", "pending", "confirmed", NOW);
    expect(e.eventType).toBe("booking.status_changed");
  });

  it("buildStatusChangeEvent: records both statuses", () => {
    const e = buildStatusChangeEvent("b1", "u1", "v1", "confirmed", "checked_in", NOW);
    expect(e.previousStatus).toBe("confirmed");
    expect(e.newStatus).toBe("checked_in");
  });

  it("buildStatusChangeEvent: timestamp correct", () => {
    const e = buildStatusChangeEvent("b1", "u1", "v1", "pending", "confirmed", NOW);
    expect(e.timestamp).toBe(NOW);
  });

  it("isValidTransition: pending → confirmed → true", () => {
    expect(isValidTransition("pending", "confirmed")).toBe(true);
  });

  it("isValidTransition: pending → checked_in → false", () => {
    expect(isValidTransition("pending", "checked_in")).toBe(false);
  });

  it("isValidTransition: completed → anything → false", () => {
    expect(isValidTransition("completed", "cancelled")).toBe(false);
  });

  it("isValidTransition: confirmed → cancelled → true", () => {
    expect(isValidTransition("confirmed", "cancelled")).toBe(true);
  });

  it("eventToJson: produces valid JSON with _version", () => {
    const e = buildStatusChangeEvent("b1", "u1", "v1", "pending", "confirmed", NOW);
    const json = JSON.parse(eventToJson(e));
    expect(json._version).toBe("1.0");
    expect(json.bookingId).toBe("b1");
  });
});
