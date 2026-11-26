import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { DEFAULT_LOCK_TTL_SECONDS } from "@/lib/locks/seatHoldLock";
import { extendSeatHoldWithFenceToken } from "@/features/seats/seatHoldService";
import { apiError } from "@/lib/apiResponse";

type RouteContext = {
  params: Promise<{ venueId: string; seatId: string }>;
};

/**
 * POST /api/venues/:venueId/seats/:seatId/lock/extend
 * Extends an active seat hold lock only if the supplied fencing token
 * is strictly greater than the currently stored fence token.
 */
export async function POST(req: Request, context: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const { venueId, seatId } = await context.params;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON request body", 400, "BAD_REQUEST");
  }

  const rawFenceToken =
    body.fencingToken ??
    body.fenceToken ??
    req.headers.get("x-fence-token") ??
    req.headers.get("x-fencing-token");

  if (
    rawFenceToken === undefined ||
    rawFenceToken === null ||
    rawFenceToken === ""
  ) {
    return apiError(
      "fencingToken is required to extend a seat hold lock",
      400,
      "MISSING_FENCE_TOKEN",
    );
  }

  const ttlSeconds =
    typeof body.ttlSeconds === "number"
      ? body.ttlSeconds
      : DEFAULT_LOCK_TTL_SECONDS;

  const result = await extendSeatHoldWithFenceToken({
    venueId,
    seatId,
    userId,
    fenceToken: rawFenceToken as number | string,
    ttlSeconds,
  });

  if (result.status === "REJECTED") {
    if (result.reason === "STALE_TOKEN") {
      return apiError(
        "Stale or non-monotonic fencing token rejected",
        409,
        "STALE_FENCE_TOKEN",
        {
          currentFencingToken: result.currentFencingToken,
        },
      );
    }
    if (result.reason === "NOT_OWNER") {
      return apiError(
        "Seat lock is held by another user",
        403,
        "FORBIDDEN",
      );
    }
    if (result.reason === "MISSING") {
      return apiError(
        "No active seat hold lock found to extend",
        404,
        "LOCK_NOT_FOUND",
      );
    }
    return apiError(
      "Invalid fencing token format",
      400,
      "INVALID_FENCE_TOKEN",
    );
  }

  return NextResponse.json({
    success: true,
    lock: result.lock,
    fencingToken: result.fencingToken,
    expiresAt: result.expiresAt,
  });
}