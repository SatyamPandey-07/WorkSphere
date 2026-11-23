import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { rateLimit } from "@/lib/rateLimit";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { processVenueReviewSubmission } from "@/lib/venueReviewService";
import { apiError } from "@/lib/apiResponse";
import { swrCache, getVenueReviewsCacheKey } from "@/lib/cache/swrCache";
import { executeIdempotent, IdempotencyConflictError } from "@/lib/idempotency";

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
      return NextResponse.json({ reviews: [], nextCursor: null, hasMore: false });
    }

    const searchParams = req.nextUrl.searchParams;
    const rawLimit = Number(searchParams.get("limit") ?? "20");
    const limit =
      Number.isSafeInteger(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, 100)
        : 20;
    const cursor = searchParams.get("cursor")?.trim() || null;

    // Keep the existing cache key for the default first page; isolate all
    // other pages so one cursor cannot receive another page's cached results.
    const baseCacheKey = getVenueReviewsCacheKey(venue.id);
    const cacheKey =
      !cursor && limit === 20
        ? baseCacheKey
        : `${baseCacheKey}:cursor:${cursor ?? "first"}:limit:${limit}`;

    const fetchedReviews = await swrCache(cacheKey, async () => {
      return await prisma.venueRating.findMany({
        where: { venueId: venue.id },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: limit + 1,
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
        // The ID tie-breaker makes the cursor order deterministic when two
        // reviews share the same createdAt timestamp.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
    });

    const hasMore = fetchedReviews.length > limit;
    const pageReviews = fetchedReviews.slice(0, limit);
    const nextCursor =
      hasMore && pageReviews.length > 0
        ? pageReviews[pageReviews.length - 1].id
        : null;

    return NextResponse.json({
      reviews: pageReviews.map((r: any) => ({
        ...r,
        user: userId
          ? { firstName: r.user?.firstName, lastName: r.user?.lastName }
          : null,
      })),
      nextCursor,
      hasMore,
    });
  } catch (error) {
    if (
      (error as { code?: string })?.code === "P2025" &&
      req.nextUrl.searchParams.has("cursor")
    ) {
      return apiError("Invalid reviews cursor", 400, "INVALID_CURSOR");
    }
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

    const submitAction = async () => {
      const result = await processVenueReviewSubmission({
        userId,
        venueId,
        body,
        idempotencyKey,
        forceOverwrite,
      });

      if (result.status >= 400) {
        return {
          status: result.status,
          body: {
            error: result.error ?? "Request failed",
            code: result.status === 409 ? "CONFLICT" : "VALIDATION_FAILED",
            conflictType: result.conflictType,
            serverReview: result.serverReview,
            serverVenue: result.serverVenue,
            message: result.message,
          },
        };
      }

      return {
        status: result.status,
        body: result.data,
      };
    };

    if (idempotencyKey) {
      const scopedKey = `venue:${venueId}:review:${idempotencyKey}`;
      const { response, cacheHit } = await executeIdempotent(
        scopedKey,
        { venueId, userId, body },
        submitAction,
      );

      return NextResponse.json(response.body, {
        status: response.status,
        headers: {
          "X-Cache-Lookup": cacheHit ? "HIT" : "MISS",
        },
      });
    }

    const res = await submitAction();
    return NextResponse.json(res.body, { status: res.status });
  } catch (error: unknown) {
    if (error instanceof IdempotencyConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("POST /api/venues/[venueId]/reviews error:", error);
    return apiError("Failed to submit review", 500, "INTERNAL_ERROR");
  }
}
