import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordCheckIn } from "@/lib/checkIn";
import { verifyIotWebhookSignature } from "@/lib/security/hmac";
import { apiError } from "@/lib/apiResponse";

export const runtime = "nodejs";

interface IotCheckInPayload {
  venueId: string;
  userId: string;
  lockId?: string;
  timestamp?: number;
  [key: string]: unknown;
}

/**
 * POST /api/venues/check-in/iot
 *
 * Authenticates incoming IoT smart lock check-in webhooks using HMAC-SHA256 signature verification.
 * Header: `X-WorkSphere-Signature: t=${timestamp},v1=${signature}`
 *
 * Rejects unsigned, forged, or replayed requests (outside 300s window) with 401.
 * Records verified check-in events against the database.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signatureHeader =
    req.headers.get("x-worksphere-signature") ||
    req.headers.get("X-WorkSphere-Signature");
  const secret = process.env.WORKSPHERE_IOT_WEBHOOK_SECRET;

  const verification = verifyIotWebhookSignature(
    rawBody,
    signatureHeader,
    secret,
    { toleranceSeconds: 300 },
  );

  if (!verification.isValid) {
    return apiError(
      "Unauthorized",
      401,
      verification.reason || "UNAUTHORIZED",
    );
  }

  let payload: IotCheckInPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return apiError("Invalid JSON payload", 400, "BAD_REQUEST");
  }

  const { venueId, userId, lockId } = payload;
  if (!venueId || typeof venueId !== "string" || !userId || typeof userId !== "string") {
    return apiError(
      "Missing required fields: venueId and userId are mandatory",
      400,
      "VALIDATION_ERROR",
    );
  }

  const venue = await prisma.venue.findFirst({
    where: { OR: [{ id: venueId }, { placeId: venueId }] },
    select: { id: true, name: true, latitude: true, longitude: true },
  });

  if (!venue) {
    return apiError("Venue not found", 404, "VENUE_NOT_FOUND");
  }

  try {
    const result = await recordCheckIn(userId, venue);
    return NextResponse.json({
      success: true,
      lockId: lockId ?? null,
      ...result,
    });
  } catch (error) {
    console.error("[iot-check-in] Check-in processing failed:", error);
    return apiError(
      "Check-in failed. Please try again.",
      500,
      "INTERNAL_ERROR",
    );
  }
}
