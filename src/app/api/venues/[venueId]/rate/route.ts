import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { processVenueReviewSubmission } from "@/lib/venueReviewService";

// POST /api/venues/[venueId]/rate - Add rating (delegates to shared venueReviewService)
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ venueId: string }> },
) {
  try {
    const { userId: rawUserId } = await auth();

    if (!rawUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      return NextResponse.json(
        {
          error: result.error,
          conflictType: result.conflictType,
          serverReview: result.serverReview,
          serverVenue: result.serverVenue,
          message: result.message,
        },
        { status: result.status },
      );
    }

    return NextResponse.json(result.data, { status: result.status });
  } catch (error) {
    console.error("POST /api/venues/[venueId]/rate error:", error);
    return NextResponse.json(
      { error: "Failed to submit rating" },
      { status: 500 },
    );
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    return NextResponse.json(
      { error: "Failed to fetch rating" },
      { status: 500 },
    );
  }
}
