import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { processGeofenceExitCheck } from "@/lib/reservations/deskManager";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// Simple rate limiter store
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW = 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  if (record.count >= RATE_LIMIT_MAX) return false;
  record.count += 1;
  return true;
}

export async function POST(request: NextRequest) {
  const clientIp = request.headers.get("x-forwarded-for") || "127.0.0.1";
  if (!checkRateLimit(clientIp)) {
    return NextResponse.json(
      { success: false, error: "Rate limit exceeded." },
      { status: 429 },
    );
  }

  // Session authentication check via Clerk
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized: Missing or invalid session token.",
      },
      { status: 401 },
    );
  }

  try {
    const body = await request.json();
    const { bookingId, userCoords } = body || {};

    if (!bookingId) {
      return NextResponse.json(
        { success: false, error: "Missing required parameter: bookingId." },
        { status: 400 },
      );
    }

    // Validate user coordinates: latitude must be in [-90, 90] and longitude in [-180, 180]
    if (
      !userCoords ||
      typeof userCoords.latitude !== "number" ||
      typeof userCoords.longitude !== "number" ||
      !Number.isFinite(userCoords.latitude) ||
      !Number.isFinite(userCoords.longitude) ||
      userCoords.latitude < -90 ||
      userCoords.latitude > 90 ||
      userCoords.longitude < -180 ||
      userCoords.longitude > 180
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid user coordinates: latitude must be in [-90, 90] and longitude in [-180, 180].",
        },
        { status: 400 },
      );
    }

    // Server-side booking lookup verifying ownership
    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        userId,
      },
      include: {
        venue: true,
      },
    });

    if (!booking) {
      return NextResponse.json(
        { success: false, error: "Booking not found." },
        { status: 404 },
      );
    }

    // Verify booking is in an active state for geofence processing
    const activeStatuses = ["CONFIRMED", "CHECKED_IN", "PENDING"];
    if (!activeStatuses.includes(booking.status)) {
      return NextResponse.json(
        {
          success: false,
          error: `Booking is not in an active state for geofence tracking (current status: ${booking.status}).`,
        },
        { status: 400 },
      );
    }

    if (!booking.venue) {
      return NextResponse.json(
        { success: false, error: "Associated venue not found for booking." },
        { status: 404 },
      );
    }

    // Authoritative venue and seat coordinates derived from database relations
    const venueCoords = {
      latitude: booking.venue.latitude,
      longitude: booking.venue.longitude,
    };
    const deskId = booking.seatId || "unassigned";
    const venueId = booking.venueId;

    const result = await processGeofenceExitCheck({
      bookingId: booking.id,
      deskId,
      venueId,
      userCoords,
      venueCoords,
    });

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error processing geofence exit telemetry:", error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
