import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { rateLimit } from "@/lib/rateLimit";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { processVenueReviewSubmission } from "@/lib/venueReviewService";
import { apiError } from "@/lib/apiResponse";

// GET /api/venues/[venueId]/reviews - Get all reviews/ratings for a venue
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ venueId: string }> },
) {
  try {
    const { userId } = await auth();

    const forwarded = req.headers.get("x-forwarded-for") || "unknown";
    const ip = forwarded.split(",")[0].trim() || "unknown";
    const allowed = await rateLimit(`reviews:${ip}`, 60);
    if (!allowed) {
      return apiError("Too many requests", 429, "RATE_LIMITED");
    }

    const { venueId } = await context.params;

    // Find internal venue record first
    const venue = await prisma.venue.findFirst({
      where: {
        OR: [{ id: venueId }, { placeId: venueId }],
      },
      select: { id: true },
    });

    if (!venue) {
      return NextResponse.json({ reviews: [] });
    }

    const reviews = await prisma.venueRating.findMany({
      where: { venueId: venue.id },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      reviews: reviews.map((r) => ({
        ...r,
        user: userId
          ? { firstName: r.user.firstName, lastName: r.user.lastName }
          : null,
      })),
    });
  } catch (error) {
    console.error("GET /api/venues/[venueId]/reviews error:", error);
    return apiError("Failed to fetch reviews", 500, "INTERNAL_ERROR");
  }
}

// POST /api/venues/[venueId]/reviews - Submit review with offline sync, idempotency, and conflict detection
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
    console.error("POST /api/venues/[venueId]/reviews error:", error);
    return apiError("Failed to submit review", 500, "INTERNAL_ERROR");
  }
}
