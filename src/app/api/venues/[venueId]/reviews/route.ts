import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import {
  executeIdempotent,
  IdempotencyConflictError,
  CachedHttpResponse,
} from "@/lib/idempotency";

const prisma = new PrismaClient();

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await context.params;
    const idempotencyKey = req.headers.get("x-idempotency-key")?.trim();
    const body = await req.json();

    const { userId, rating, comment } = body as {
      userId?: string;
      rating?: number;
      comment?: string;
    };

    if (!userId || typeof rating !== "number" || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "Valid userId and rating (1-5) are required" },
        { status: 400 },
      );
    }

    const createReview = async (): Promise<CachedHttpResponse> => {
      const review = await prisma.review.create({
        data: {
          venueId,
          userId,
          rating,
          comment: comment ?? "",
        },
      });
      return {
        status: 201,
        body: { review },
      };
    };

    if (!idempotencyKey) {
      const result = await createReview();
      return NextResponse.json(result.body, {
        status: result.status,
        headers: { "X-Cache-Lookup": "MISS" },
      });
    }

    const scopedKey = `venue:${venueId}:review:${idempotencyKey}`;
    const { response, cacheHit } = await executeIdempotent(
      scopedKey,
      { venueId, userId, rating, comment: comment ?? "" },
      createReview,
    );

    return NextResponse.json(response.body, {
      status: response.status,
      headers: {
        "X-Cache-Lookup": cacheHit ? "HIT" : "MISS",
      },
    });
  } catch (error: unknown) {
    if (error instanceof IdempotencyConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const details = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to submit review", details },
      { status: 500 },
    );
  }
}
