import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getVenueLiveVibe, recordVenueLiveVibe, VibeType } from "@/lib/venues/liveVibeService";
import { rateLimit } from "@/lib/rateLimit";

type RouteContext = {
  params: Promise<{
    venueId: string;
  }>;
};

const VALID_VIBES: VibeType[] = ["silent_focus", "moderate_buzz", "lively"];

/**
 * GET /api/venues/[venueId]/vibe
 * Returns the current aggregated live vibe & noise status for the venue (2-hour TTL window).
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { venueId } = await context.params;

    if (!venueId) {
      return NextResponse.json(
        { success: false, error: "Venue ID is required." },
        { status: 400 },
      );
    }

    const vibe = await getVenueLiveVibe(venueId);

    return NextResponse.json({
      success: true,
      vibe,
    });
  } catch (error) {
    console.error("[GET /api/venues/[venueId]/vibe] Error:", error);
    return NextResponse.json(
      { success: false, error: "Unable to retrieve live venue vibe." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/venues/[venueId]/vibe
 * Submits a 1-tap live vibe reaction with 2-hour TTL.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { venueId } = await context.params;

    if (!venueId) {
      return NextResponse.json(
        { success: false, error: "Venue ID is required." },
        { status: 400 },
      );
    }

    const { userId } = await auth();
    const identifier = userId
      ? `vibe:${venueId}:${userId}`
      : `vibe:${venueId}:${request.headers.get("x-forwarded-for") || "anon"}`;

    if (!(await rateLimit(identifier, 10))) {
      return NextResponse.json(
        { success: false, error: "You've voted recently. Please wait a moment." },
        { status: 429 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const rawVibe = body?.vibe;

    if (!rawVibe || !VALID_VIBES.includes(rawVibe)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid vibe. Must be one of: silent_focus, moderate_buzz, lively",
        },
        { status: 400 },
      );
    }

    const updatedVibe = await recordVenueLiveVibe(venueId, rawVibe as VibeType, userId);

    return NextResponse.json({
      success: true,
      message: "Live vibe recorded!",
      vibe: updatedVibe,
    });
  } catch (error) {
    console.error("[POST /api/venues/[venueId]/vibe] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to record live vibe. Please try again." },
      { status: 500 },
    );
  }
}
