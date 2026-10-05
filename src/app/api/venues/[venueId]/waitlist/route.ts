import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  joinVenueWaitlist,
  getUserWaitlistEntries,
  cancelWaitlistEntry,
} from "@/lib/waitlist";
import { apiError } from "@/lib/apiResponse";

type RouteContext = {
  params: Promise<{ venueId: string }>;
};

/**
 * GET /api/venues/[venueId]/waitlist
 * Fetches the user's active waitlist entries for this venue.
 */
export async function GET(_req: NextRequest, context: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const { venueId } = await context.params;

  try {
    const entries = await getUserWaitlistEntries(userId, venueId);
    return NextResponse.json({
      success: true,
      entries,
    });
  } catch (error: any) {
    return apiError(error.message || "Failed to fetch waitlist entries", 500, "INTERNAL_ERROR");
  }
}

/**
 * POST /api/venues/[venueId]/waitlist
 * Joins the waitlist for a specific venue, date, and time slot.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const { venueId } = await context.params;

  try {
    const body = await req.json();
    const result = await joinVenueWaitlist(userId, {
      ...body,
      venueId,
    });

    return NextResponse.json({
      success: true,
      data: result.entry,
      message: result.message,
    });
  } catch (error: any) {
    return apiError(error.message || "Failed to join waitlist", 400, "BAD_REQUEST");
  }
}

/**
 * DELETE /api/venues/[venueId]/waitlist
 * Cancels a user's waitlist entry.
 */
export async function DELETE(req: NextRequest, _context: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const waitlistId = req.nextUrl.searchParams.get("waitlistId");
  if (!waitlistId) {
    return apiError("Missing waitlistId parameter", 400, "BAD_REQUEST");
  }

  try {
    const success = await cancelWaitlistEntry(waitlistId, userId);
    return NextResponse.json({
      success,
      message: success ? "Waitlist entry cancelled." : "Entry not found.",
    });
  } catch (error: any) {
    return apiError(error.message || "Failed to cancel waitlist entry", 500, "INTERNAL_ERROR");
  }
}
