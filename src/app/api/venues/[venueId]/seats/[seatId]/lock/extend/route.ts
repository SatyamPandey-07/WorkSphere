import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { extendSeatHold } from "@/lib/locks/seatHoldLock";
import { apiError } from "@/lib/apiResponse";

type RouteContext = {
  params: Promise<{ venueId: string; seatId: string }>;
};

/**
 * POST /api/venues/:venueId/seats/:seatId/lock/extend
 *
 * Extends the authenticated lock holder's checkout lease by five minutes.
 * The original fencing token is required and each lease can be extended once.
 */
export async function POST(request: Request, context: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const { venueId, seatId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const token =
    typeof body?.token === "string" ? body.token.trim() : "";

  if (!token) {
    return apiError("A seat-hold fencing token is required.", 400, "INVALID_INPUT");
  }

  const result = await extendSeatHold(venueId, seatId, userId, token);
  if (!result.success) {
    const status =
      result.reason === "NOT_FOUND" ? 404 :
      result.reason === "UNAUTHORIZED" ? 403 :
      result.reason === "ERROR" ? 500 : 409;
    return apiError(
      "SEAT_HOLD_EXTENSION_REJECTED",
      status,
      result.reason === "UNAUTHORIZED" ? "FORBIDDEN" : "CONFLICT",
      {
        reason: result.reason,
        remainingSeconds: result.remainingSeconds,
      },
    );
  }

  return NextResponse.json({
    success: true,
    lock: result.lock,
    remainingSeconds: result.remainingSeconds,
  });
}
