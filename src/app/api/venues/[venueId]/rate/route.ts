import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { processVenueReviewSubmission } from "@/lib/venueReviewService";
import { apiError } from "@/lib/apiResponse";

// POST /api/venues/[venueId]/rate - Add rating (delegates to shared venueReviewService)
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ venueId: string }> },
) {
  try {
    const { userId: rawUserId } = await auth();

    if (!rawUserId) {
      return apiError("Unauthorized", 401, "UNAUTHORIZED");
    }
    const userId: string = rawUserId;

    // Ensure Identity 💎
    await ensureUserExists(userId);

    const { venueId } = await context.params;
    const body = await req.json();

    const idempotencyKey =
      req.headers.get("x-idempotency-key") || body?.idempotencyKey || body?.id;
    const forceOverwrite =
      body?.forceOverwrite === true ||
      req.headers.get("x-force-overwrite") === "true";

    const result = await processVenueReviewSubmission({
      userId,
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
  } catch (error) {
    console.error("POST /api/venues/[venueId]/rate error:", error);
    return apiError("Failed to submit rating", 500, "INTERNAL_ERROR");
  }
}

// GET /api/venues/[venueId]/rate - Get user's rating
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ venueId: string }> },
) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return apiError("Unauthorized", 401, "UNAUTHORIZED");
    }

    const { venueId } = await context.params;

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
          userId,
          venueId: venue.id,
        },
      },
    });

    return NextResponse.json({ rating });
  } catch (error) {
    console.error("GET /api/venues/[venueId]/rate error:", error);
    return apiError("Failed to fetch rating", 500, "INTERNAL_ERROR");
  }
}
