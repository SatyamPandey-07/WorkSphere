/**
 * Tests for push notification payload building and validation.
 */

interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: Record<string, unknown>;
  ttl?: number;
}

function buildBookingPayload(
  bookingId: string,
  venueName: string,
  action: "confirmed" | "reminder" | "cancelled"
): PushNotificationPayload {
  const messages = {
    confirmed: { title: "Booking Confirmed", body: `Your booking at ${venueName} is confirmed!` },
    reminder:  { title: "Booking Reminder",  body: `Your booking at ${venueName} is in 1 hour.` },
    cancelled: { title: "Booking Cancelled", body: `Your booking at ${venueName} has been cancelled.` },
  };
  return {
    ...messages[action],
    data: { bookingId, type: action },
    ttl: action === "reminder" ? 3_600 : 86_400,
  };
}

function isValidPayload(payload: PushNotificationPayload): boolean {
  return !!payload.title.trim() && !!payload.body.trim();
}

function truncateBody(payload: PushNotificationPayload, maxChars = 100): PushNotificationPayload {
  if (payload.body.length <= maxChars) return payload;
  return { ...payload, body: payload.body.slice(0, maxChars - 3) + "..." };
}

describe("Push notification payload", () => {
  it("confirmed payload has correct title", () => {
    const p = buildBookingPayload("b1", "Café Hub", "confirmed");
    expect(p.title).toBe("Booking Confirmed");
  });

  it("confirmed body includes venue name", () => {
    const p = buildBookingPayload("b1", "Café Hub", "confirmed");
    expect(p.body).toContain("Café Hub");
  });

  it("reminder payload has 1h TTL", () => {
    const p = buildBookingPayload("b1", "Hub", "reminder");
    expect(p.ttl).toBe(3_600);
  });

  it("confirmed payload has 24h TTL", () => {
    const p = buildBookingPayload("b1", "Hub", "confirmed");
    expect(p.ttl).toBe(86_400);
  });

  it("data includes bookingId", () => {
    const p = buildBookingPayload("bk-123", "Hub", "confirmed");
    expect(p.data?.bookingId).toBe("bk-123");
  });

  it("isValidPayload: non-empty title and body → true", () => {
    expect(isValidPayload({ title: "Hello", body: "World" })).toBe(true);
  });

  it("isValidPayload: empty title → false", () => {
    expect(isValidPayload({ title: "", body: "World" })).toBe(false);
  });

  it("truncateBody: short body unchanged", () => {
    const p = { title: "T", body: "Short body" };
    expect(truncateBody(p).body).toBe("Short body");
  });

  it("truncateBody: long body gets '...'", () => {
    const p = { title: "T", body: "a".repeat(150) };
    const truncated = truncateBody(p);
    expect(truncated.body.endsWith("...")).toBe(true);
    expect(truncated.body.length).toBe(100);
  });
});
