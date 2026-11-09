import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import {
  acquireDeskReservation,
  releaseDeskReservation,
  getDeskReservationTimer,
  DEFAULT_DESK_RESERVATION_TTL_SECONDS,
} from "@/lib/reservations/deskReservationCountdown";
import { apiError } from "@/lib/apiResponse";

/**
 * POST /api/reservations/desk/hold
 * Atomically acquires or renews a countdown reservation hold on a desk.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const user = await currentUser();
  const userName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.username ||
    "User";

  const body = await req.json().catch(() => ({}));
  const venueId = typeof body.venueId === "string" ? body.venueId : "";
  const deskId = typeof body.deskId === "string" ? body.deskId : "";
  const ttlSeconds =
    typeof body.ttlSeconds === "number" && body.ttlSeconds > 0
      ? body.ttlSeconds
      : DEFAULT_DESK_RESERVATION_TTL_SECONDS;

  if (!venueId || !deskId) {
    return apiError("venueId and deskId are required", 400, "BAD_REQUEST");
  }

  const result = await acquireDeskReservation(
    venueId,
    deskId,
    userId,
    userName,
    ttlSeconds,
  );

  if (!result.success) {
    return NextResponse.json(
      {
        success: false,
        error: "DESK_ALREADY_HELD",
        heldBy: result.heldBy,
        heldByName: result.heldByName,
        expiresAt: result.expiresAt,
        remainingSeconds: result.remainingSeconds,
        remainingMs: result.remainingMs,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    success: true,
    reservation: result.reservation,
    expiresAt: result.expiresAt,
    remainingSeconds: result.remainingSeconds,
    remainingMs: result.remainingMs,
  });
}

/**
 * DELETE /api/reservations/desk/hold
 * Atomically releases the desk reservation hold using Compare-and-Delete (CAD).
 */
export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const body = await req.json().catch(() => ({}));
  const venueId =
    typeof body.venueId === "string"
      ? body.venueId
      : req.nextUrl.searchParams.get("venueId") || "";
  const deskId =
    typeof body.deskId === "string"
      ? body.deskId
      : req.nextUrl.searchParams.get("deskId") || "";

  if (!venueId || !deskId) {
    return apiError("venueId and deskId are required", 400, "BAD_REQUEST");
  }

  const released = await releaseDeskReservation(venueId, deskId, userId);

  return NextResponse.json({
    success: released,
    venueId,
    deskId,
  });
}

/**
 * GET /api/reservations/desk/hold?venueId=...&deskId=...
 * Inspects current hold state and remaining countdown timer duration.
 */
export async function GET(req: NextRequest) {
  const venueId = req.nextUrl.searchParams.get("venueId");
  const deskId = req.nextUrl.searchParams.get("deskId");
  const { userId } = await auth();

  if (!venueId || !deskId) {
    return apiError("venueId and deskId query parameters are required", 400, "BAD_REQUEST");
  }

  const timerInfo = await getDeskReservationTimer(venueId, deskId, userId ?? undefined);

  return NextResponse.json(timerInfo);
}
