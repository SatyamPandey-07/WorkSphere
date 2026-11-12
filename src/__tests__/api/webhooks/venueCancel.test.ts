import { createHash, createHmac } from "node:crypto";
import { POST } from "@/app/api/webhooks/venue-cancel/route";
import { prisma } from "@/lib/prisma";
import { emitWebhookEvent } from "@/lib/webhooks/deliver";
import { notifyNextInWaitlist } from "@/lib/waitlist";
import { publishVenueAvailability } from "@/lib/reservations/event-bus";
import { releaseDeskReservation } from "@/lib/reservations/deskReservationCountdown";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    booking: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    bookingGuest: {
      updateMany: jest.fn(),
    },
    venueCancellationWebhookEvent: {
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock("@/lib/webhooks/deliver", () => ({
  emitWebhookEvent: jest.fn(),
}));

jest.mock("@/lib/waitlist", () => ({
  notifyNextInWaitlist: jest.fn().mockResolvedValue({ notified: false }),
}));

jest.mock("@/lib/reservations/event-bus", () => ({
  publishVenueAvailability: jest.fn(),
}));

jest.mock("@/lib/reservations/deskReservationCountdown", () => ({
  releaseDeskReservation: jest.fn().mockResolvedValue(true),
}));

const SECRET = "test-venue-cancellation-secret";
const booking = {
  id: "booking_123",
  userId: "user_123",
  venueId: "venue_123",
  date: "2026-11-20",
  time: "10:00",
  timeZone: "UTC",
  confirmationId: "CONFIRM-123",
  seatId: "seat_123",
  duration: 60,
};

function signedRequest(
  rawBody: string,
  idempotencyKey = "event-123",
  signatureOverride?: string,
): Request {
  const signature =
    signatureOverride ??
    createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex");

  return new Request("http://localhost/api/webhooks/venue-cancel", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-WorkSphere-Signature": `sha256=${signature}`,
      "X-Idempotency-Key": idempotencyKey,
    },
    body: rawBody,
  });
}

describe("POST /api/webhooks/venue-cancel", () => {
  const originalSecret = process.env.VENUE_CANCEL_WEBHOOK_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VENUE_CANCEL_WEBHOOK_SECRET = SECRET;

    (prisma.venueCancellationWebhookEvent.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
    (prisma.venueCancellationWebhookEvent.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.venueCancellationWebhookEvent.create as jest.Mock).mockResolvedValue({ id: "event-row-1" });
    (prisma.booking.findFirst as jest.Mock).mockResolvedValue(booking);
    (prisma.booking.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.bookingGuest.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.VENUE_CANCEL_WEBHOOK_SECRET;
    } else {
      process.env.VENUE_CANCEL_WEBHOOK_SECRET = originalSecret;
    }
  });

  it("rejects missing or invalid HMAC signatures", async () => {
    const rawBody = JSON.stringify({ bookingId: booking.id });
    const response = await POST(signedRequest(rawBody, "invalid-event", "00".repeat(32)));

    expect(response.status).toBe(401);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
  });

  it("atomically cancels a booking and records the idempotency key", async () => {
    const rawBody = JSON.stringify({
      bookingId: booking.id,
      reason: "Venue closed unexpectedly",
    });
    const response = await POST(signedRequest(rawBody));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      duplicate: false,
      bookingId: booking.id,
      status: "CANCELLED_BY_OPERATOR",
      refundRequested: true,
    });
    expect(prisma.venueCancellationWebhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey: "event-123",
        payloadHash: createHash("sha256").update(rawBody).digest("hex"),
        bookingId: booking.id,
      }),
    });
    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: booking.id,
        status: { in: ["CONFIRMED", "PENDING", "CHECKED_IN"] },
      },
      data: { status: "CANCELLED_BY_OPERATOR" },
    });
    expect(prisma.bookingGuest.updateMany).toHaveBeenCalled();
    expect(releaseDeskReservation).toHaveBeenCalledWith(
      booking.venueId,
      booking.seatId,
      booking.userId,
    );
    expect(publishVenueAvailability).toHaveBeenCalled();
    expect(emitWebhookEvent).toHaveBeenCalledWith(
      booking.userId,
      "BOOKING_CANCELLED",
      expect.objectContaining({
        cancelledBy: "VENUE_OPERATOR",
        refundRequested: true,
      }),
    );
    expect(notifyNextInWaitlist).toHaveBeenCalled();
  });

  it("acknowledges a repeated delivery with the same idempotency key and payload", async () => {
    const rawBody = JSON.stringify({ bookingId: booking.id });
    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    (prisma.venueCancellationWebhookEvent.findUnique as jest.Mock).mockResolvedValue({
      payloadHash,
      bookingId: booking.id,
    });

    const response = await POST(signedRequest(rawBody));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.duplicate).toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects reuse of an idempotency key with a different request body", async () => {
    (prisma.venueCancellationWebhookEvent.findUnique as jest.Mock).mockResolvedValue({
      payloadHash: "different-payload-hash",
      bookingId: booking.id,
    });

    const response = await POST(
      signedRequest(JSON.stringify({ bookingId: booking.id })),
    );

    expect(response.status).toBe(409);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("requires a valid idempotency key", async () => {
    const rawBody = JSON.stringify({ bookingId: booking.id });
    const response = await POST(signedRequest(rawBody, ""));

    expect(response.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
