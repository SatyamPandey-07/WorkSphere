import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import {
  acquireDeskReservationTimer,
  getDeskReservationTimer,
  extendDeskReservationTimer,
  releaseDeskReservationTimer,
  DEFAULT_DESK_TIMER_SECONDS,
} from "@/lib/locks/deskReservationTimer";
import { apiError } from "@/lib/apiResponse";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ venueId: string; seatId: string }>;
};

/**
 * GET /api/venues/:venueId/seats/:seatId/countdown
 * Inspects atomic countdown timer status with exact millisecond PTTL from Redis.
 */
export async function GET(_req: Request, context: RouteContext) {
  const { venueId, seatId } = await context.params;
  const { userId } = await auth();

  const status = await getDeskReservationTimer(
    venueId,
    seatId,
    userId || undefined,
  );

  return NextResponse.json({
    success: true,
    venueId,
    deskId: seatId,
    seatId,
    ...status,
  });
}

/**
 * POST /api/venues/:venueId/seats/:seatId/countdown
 * Atomically starts or extends a desk reservation countdown timer.
 */
export async function POST(req: Request, context: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const { venueId, seatId } = await context.params;
  const user = await currentUser();
  const userName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.username ||
    "User";

  let body: Record<string, any> = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    body = {};
  }

  // Handle countdown extension
  if (body.action === "extend") {
    const additionalSeconds =
      typeof body.additionalSeconds === "number" ? body.additionalSeconds : 120;

    const result = await extendDeskReservationTimer(
      venueId,
      seatId,
      userId,
      additionalSeconds,
    );

    if (!result.success) {
      if (result.reason === "UNAUTHORIZED") {
        return apiError(
          "Cannot extend lock owned by another user",
          403,
          "FORBIDDEN",
        );
      }
      return apiError(
        "Active countdown timer not found or expired",
        404,
        "NOT_FOUND",
      );
    }

    return NextResponse.json({
      success: true,
      action: "extend",
      venueId,
      deskId: seatId,
      timer: result.timer,
      expiresAt: result.expiresAt,
      remainingSeconds: result.remainingSeconds,
      remainingMs: result.remainingMs,
    });
  }

  // Standard countdown timer acquisition / renewal
  const durationSeconds =
    typeof body.durationSeconds === "number"
      ? body.durationSeconds
      : DEFAULT_DESK_TIMER_SECONDS;

  const result = await acquireDeskReservationTimer({
    venueId,
    deskId: seatId,
    userId,
    userName,
    durationSeconds,
  });

  if (!result.success) {
    return apiError("DESK_ALREADY_HELD", 409, "CONFLICT", {
      heldBy: result.heldBy,
      heldByName: result.heldByName,
      expiresAt: result.expiresAt,
      remainingSeconds: result.remainingSeconds,
      remainingMs: result.remainingMs,
    });
  }

  return NextResponse.json({
    success: true,
    action: "acquire",
    venueId,
    deskId: seatId,
    timer: result.timer,
    expiresAt: result.expiresAt,
    remainingSeconds: result.remainingSeconds,
    remainingMs: result.remainingMs,
  });
}

/**
 * DELETE /api/venues/:venueId/seats/:seatId/countdown
 * Releases the active countdown timer if held by the authenticated user.
 */
export async function DELETE(_req: Request, context: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const { venueId, seatId } = await context.params;
  const released = await releaseDeskReservationTimer(venueId, seatId, userId);

  return NextResponse.json({
    success: released,
    venueId,
    deskId: seatId,
    seatId,
  });
}
