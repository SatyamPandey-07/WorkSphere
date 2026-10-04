/**
 * Tests for venue booking webhook event handling and validation.
 */

type WebhookEventType =
  | "booking.created"
  | "booking.confirmed"
  | "booking.cancelled"
  | "payment.succeeded"
  | "payment.failed"
  | "review.submitted"
  | "venue.updated";

interface WebhookPayload {
  id: string;
  type: WebhookEventType;
  timestamp: number;
  liveMode: boolean;
  data: Record<string, unknown>;
  signature: string;
}

interface WebhookConfig {
  secret: string;
  allowedTypes: WebhookEventType[];
  maxAgeMs: number;
}

function isWebhookStale(payload: WebhookPayload, nowMs: number, maxAgeMs: number): boolean {
  return nowMs - payload.timestamp > maxAgeMs;
}

function isEventTypeAllowed(payload: WebhookPayload, config: WebhookConfig): boolean {
  return config.allowedTypes.includes(payload.type);
}

function extractBookingId(payload: WebhookPayload): string | null {
  if (payload.data.bookingId && typeof payload.data.bookingId === "string") {
    return payload.data.bookingId;
  }
  return null;
}

function isPaymentEvent(payload: WebhookPayload): boolean {
  return payload.type.startsWith("payment.");
}

function eventsByType(payloads: WebhookPayload[]): Record<WebhookEventType, number> {
  const counts: Partial<Record<WebhookEventType, number>> = {};
  for (const p of payloads) counts[p.type] = (counts[p.type] ?? 0) + 1;
  return counts as Record<WebhookEventType, number>;
}

function filterLiveMode(payloads: WebhookPayload[]): WebhookPayload[] {
  return payloads.filter((p) => p.liveMode);
}

const NOW = 1_700_000_000_000;
const CONFIG: WebhookConfig = {
  secret: "whsec_test",
  allowedTypes: ["booking.created", "booking.confirmed", "payment.succeeded"],
  maxAgeMs: 300_000, // 5 minutes
};

const PAYLOADS: WebhookPayload[] = [
  { id: "wh1", type: "booking.created",  timestamp: NOW - 60_000,  liveMode: true,  data: { bookingId: "b1" }, signature: "sig1" },
  { id: "wh2", type: "payment.succeeded",timestamp: NOW - 30_000,  liveMode: true,  data: { bookingId: "b2", amount: 500 }, signature: "sig2" },
  { id: "wh3", type: "venue.updated",    timestamp: NOW - 600_000, liveMode: false, data: { venueId: "v1" }, signature: "sig3" },
];

describe("Webhook handler utilities", () => {
  it("isWebhookStale: 60s old within 5min window → false", () => {
    expect(isWebhookStale(PAYLOADS[0], NOW, CONFIG.maxAgeMs)).toBe(false);
  });

  it("isWebhookStale: 10min old exceeds 5min → true", () => {
    expect(isWebhookStale(PAYLOADS[2], NOW, CONFIG.maxAgeMs)).toBe(true);
  });

  it("isEventTypeAllowed: booking.created → allowed", () => {
    expect(isEventTypeAllowed(PAYLOADS[0], CONFIG)).toBe(true);
  });

  it("isEventTypeAllowed: venue.updated → not allowed", () => {
    expect(isEventTypeAllowed(PAYLOADS[2], CONFIG)).toBe(false);
  });

  it("extractBookingId: returns b1", () => {
    expect(extractBookingId(PAYLOADS[0])).toBe("b1");
  });

  it("isPaymentEvent: payment.succeeded → true", () => {
    expect(isPaymentEvent(PAYLOADS[1])).toBe(true);
  });

  it("filterLiveMode: 2 live-mode events", () => {
    expect(filterLiveMode(PAYLOADS).length).toBe(2);
  });
});
