import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { emitWebhookEvent } from "@/lib/webhooks/deliver";
import { notifyNextInWaitlist } from "@/lib/waitlist";
import { publishVenueAvailability } from "@/lib/reservations/event-bus";
import { releaseDeskReservation } from "@/lib/reservations/deskReservationCountdown";
import { dispatchVenueCancellationDiscordNotification } from "@/lib/notifications/discordNotifier";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVE_BOOKING_STATUSES = ["CONFIRMED", "PENDING", "CHECKED_IN"] as const;

class CancellationWebhookError extends Error {
  constructor(
    public readonly code: "BOOKING_NOT_FOUND" | "BOOKING_ALREADY_CANCELLED",
    message: string,
  ) {
    super(message);
    this.name = "CancellationWebhookError";
  }
}

function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;

  const signature = signatureHeader.trim().replace(/^sha256=/i, "");
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;

  const expected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest();
  const received = Buffer.from(signature, "hex");

  return received.length === expected.length && timingSafeEqual(received, expected);
}

function payloadDigest(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

function duplicateResponse(existing: {
  payloadHash: string;
  bookingId: string;
}, currentHash: string) {
  if (existing.payloadHash !== currentHash) {
    return NextResponse.json(
      {
        success: false,
        error: "The idempotency key was already used with a different payload.",
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    success: true,
    duplicate: true,
    bookingId: existing.bookingId,
    message: "This cancellation event has already been processed.",
  });
}

/**
 * POST /api/webhooks/venue-cancel
 *
 * Signature format: X-WorkSphere-Signature: sha256=<64-character hex HMAC>
 * The HMAC is calculated over the exact raw request body.
 */
export async function POST(request: Request) {
  const secret = process.env.VENUE_CANCEL_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "Venue cancellation webhook secret is not configured." },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  if (!verifySignature(
    rawBody,
    request.headers.get("x-worksphere-signature"),
    secret,
  )) {
    return NextResponse.json(
      { success: false, error: "Invalid webhook signature." },
      { status: 401 },
    );
  }

  const idempotencyKey = request.headers.get("x-idempotency-key")?.trim();
  if (
    !idempotencyKey ||
    idempotencyKey.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)
  ) {
    return NextResponse.json(
      { success: false, error: "A valid X-Idempotency-Key header is required." },
      { status: 400 },
    );
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }
  if (
    !parsedPayload ||
    typeof parsedPayload !== "object" ||
    Array.isArray(parsedPayload)
  ) {
    return NextResponse.json(
      { success: false, error: "Request body must be a JSON object." },
      { status: 400 },
    );
  }
  const payload = parsedPayload as {
    bookingId?: unknown;
    confirmationId?: unknown;
    reason?: unknown;
  };

  const bookingReference =
    typeof payload.bookingId === "string"
      ? payload.bookingId.trim()
      : typeof payload.confirmationId === "string"
        ? payload.confirmationId.trim()
        : "";
  if (!bookingReference || bookingReference.length > 128) {
    return NextResponse.json(
      { success: false, error: "bookingId or confirmationId is required." },
      { status: 400 },
    );
  }

  const currentHash = payloadDigest(rawBody);
  const now = new Date();

  try {
    // Expired keys can be safely reused after the 24-hour deduplication period.
    await prisma.venueCancellationWebhookEvent.deleteMany({
      where: { expiresAt: { lte: now } },
    });

    const existing = await prisma.venueCancellationWebhookEvent.findUnique({
      where: { idempotencyKey },
      select: { payloadHash: true, bookingId: true },
    });
    if (existing) return duplicateResponse(existing, currentHash);

    const booking = await prisma.$transaction(async (tx) => {
      const matchedBooking = await tx.booking.findFirst({
        where: {
          OR: [
            { id: bookingReference },
            { confirmationId: bookingReference },
          ],
          status: { in: [...ACTIVE_BOOKING_STATUSES] },
        },
        select: {
          id: true,
          userId: true,
          venueId: true,
          date: true,
          time: true,
          timeZone: true,
          confirmationId: true,
          seatId: true,
          duration: true,
          user: {
            select: {
              discordWebhookUrl: true,
            },
          },
          venue: {
            select: {
              name: true,
              address: true,
            },
          },
        },
      });

      if (!matchedBooking) {
        throw new CancellationWebhookError(
          "BOOKING_NOT_FOUND",
          "No active booking matched the supplied booking reference.",
        );
      }

      // The unique key and booking update commit together. If any step fails,
      // the transaction rolls back the idempotency record as well.
      await tx.venueCancellationWebhookEvent.create({
        data: {
          idempotencyKey,
          payloadHash: currentHash,
          bookingId: matchedBooking.id,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
        },
      });

      const updated = await tx.booking.updateMany({
        where: {
          id: matchedBooking.id,
          status: { in: [...ACTIVE_BOOKING_STATUSES] },
        },
        data: { status: "CANCELLED_BY_OPERATOR" },
      });
      if (updated.count !== 1) {
        throw new CancellationWebhookError(
          "BOOKING_ALREADY_CANCELLED",
          "The booking was cancelled by another request.",
        );
      }

      await tx.bookingGuest.updateMany({
        where: {
          bookingId: matchedBooking.id,
          status: { in: ["PENDING", "SENT"] },
        },
        data: { status: "CANCELLED" },
      });

      return matchedBooking;
    });

    // Release any short-lived desk hold owned by this booking's user. The
    // booking status change remains authoritative if there is no active hold.
    if (booking.seatId) {
      try {
        await releaseDeskReservation(booking.venueId, booking.seatId, booking.userId);
      } catch (error) {
        console.warn("[venue-cancel] desk hold release failed:", error);
      }
    }

    try {
      publishVenueAvailability(booking.venueId, {
        type: "booking_cancelled_by_operator",
        bookingId: booking.id,
        seatId: booking.seatId,
        date: booking.date,
        time: booking.time,
        cancelledAt: new Date().toISOString(),
      });
    } catch (error) {
      console.warn("[venue-cancel] availability broadcast failed:", error);
    }

    // The cancellation event is the durable downstream signal for configured
    // booking integrations. Payment execution is intentionally left to the
    // configured payment/escrow provider; this route never fabricates a refund.
    emitWebhookEvent(booking.userId, "BOOKING_CANCELLED", {
      bookingId: booking.id,
      confirmationId: booking.confirmationId,
      venueId: booking.venueId,
      date: booking.date,
      time: booking.time,
      cancelledBy: "VENUE_OPERATOR",
      refundRequested: true,
      reason:
        typeof payload.reason === "string"
          ? payload.reason.slice(0, 500)
          : "Venue operator cancelled the reservation",
      cancelledAt: new Date().toISOString(),
    });

    if (booking.user.discordWebhookUrl) {
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
      void dispatchVenueCancellationDiscordNotification({
        webhookUrl: booking.user.discordWebhookUrl,
        bookingId: booking.id,
        venueName: booking.venue.name,
        venueAddress: booking.venue.address,
        affectedTimeSlot: `${booking.date} ${booking.time}${booking.timeZone ? ` (${booking.timeZone})` : ""}`,
        refundStatus: "Refund requested",
        bookingDetailsUrl: `${appUrl}/api/bookings/${encodeURIComponent(booking.id)}/download`,
      });
    }

    void notifyNextInWaitlist(
      booking.venueId,
      booking.date,
      booking.time,
      booking.duration || 60,
      booking.seatId,
      booking.timeZone,
    ).catch((error) => {
      console.error("[venue-cancel] waitlist notification failed:", error);
    });

    return NextResponse.json({
      success: true,
      duplicate: false,
      bookingId: booking.id,
      status: "CANCELLED_BY_OPERATOR",
      refundRequested: true,
    });
  } catch (error: any) {
    if (error?.code === "P2002") {
      const existing = await prisma.venueCancellationWebhookEvent.findUnique({
        where: { idempotencyKey },
        select: { payloadHash: true, bookingId: true },
      });
      if (existing) return duplicateResponse(existing, currentHash);
    }

    if (error instanceof CancellationWebhookError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.code === "BOOKING_NOT_FOUND" ? 404 : 409 },
      );
    }

    console.error("[POST /api/webhooks/venue-cancel] Error:", error);
    return NextResponse.json(
      { success: false, error: "Unable to process venue cancellation webhook." },
      { status: 500 },
    );
  }
}
