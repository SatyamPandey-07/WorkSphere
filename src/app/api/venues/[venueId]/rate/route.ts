import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { processVenueReviewSubmission } from "@/lib/venueReviewService";
import { apiError } from "@/lib/apiResponse";
import { apiHandler } from "@/lib/apiHandler";

// POST /api/venues/[venueId]/rate - Add rating (delegates to shared venueReviewService)
export const POST = apiHandler<Record<string, any>, { venueId: string }>({
  authRequired: true,
  handler: async ({ body, params, userId, req }) => {
    // Ensure Identity 💎
    await ensureUserExists(userId!);

    const { venueId } = params;

    const idempotencyKey =
      req.headers.get("x-idempotency-key") || body?.idempotencyKey || body?.id;
    const forceOverwrite =
      body?.forceOverwrite === true ||
      req.headers.get("x-force-overwrite") === "true";

    const result = await processVenueReviewSubmission({
      userId: userId!,
      venueId,
      body,
      idempotencyKey,
      forceOverwrite,
    });

    if (result.status >= 400) {
      return apiError(
        result.error ?? "Request failed",
        result.status,
        result.status === 409 ? "CONFLICT" : "VALIDATION_FAILED",
        {
          conflictType: result.conflictType,
          serverReview: result.serverReview,
          serverVenue: result.serverVenue,
          message: result.message,
        },
      );
    }

    return NextResponse.json(result.data, { status: result.status });
  },
});

// GET /api/venues/[venueId]/rate - Get user's rating
export const GET = apiHandler<void, { venueId: string }>({
  authRequired: true,
  handler: async ({ params, userId }) => {
    const { venueId } = params;

    // Find the venue first to get our internal ID (venueId from URL might be a placeId)
    const venue = await prisma.venue.findFirst({
      where: {
        OR: [{ id: venueId }, { placeId: venueId }],
      },
      select: { id: true },
    });

    if (!venue) {
      return NextResponse.json({ rating: null });
    }

    const rating = await prisma.venueRating.findUnique({
      where: {
        userId_venueId: {
          userId: userId!,
          venueId: venue.id,
        },
      },
    });

    return NextResponse.json({ rating });
  },
});
