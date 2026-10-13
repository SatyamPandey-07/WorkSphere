/**
 * route.ts
 * POST /api/venues/[venueId]/evacuation
 * Generates emergency egress route, nearest fire exits, AED locator, and assembly point guidance.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  computeEmergencyEvacuationPlan,
  type EmergencyType,
} from "@/lib/safety/evacuationRouter";

type RouteContext = { params: Promise<{ venueId: string }> };

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { venueId: paramVenueId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const {
      venueId: bodyVenueId,
      userSeatNumber = "Desk A-14",
      emergencyType = "FIRE_ALARM",
      currentCoordinates = { x: 25, y: 20 },
    } = body;

    const venueId = paramVenueId || bodyVenueId;
    let venueName = "Mission Focus Coworking & Cafe";

    if (venueId) {
      const venue = await prisma.venue.findUnique({
        where: { id: venueId },
        select: { name: true },
      });
      if (venue) venueName = venue.name;
    }

    const plan = computeEmergencyEvacuationPlan(
      currentCoordinates,
      venueName,
      userSeatNumber,
      emergencyType as EmergencyType
    );

    return NextResponse.json({
      success: true,
      alertTimestamp: new Date().toISOString(),
      evacuationPlan: plan,
    });
  } catch (error: any) {
    console.error("[POST /api/venues/[venueId]/evacuation] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate emergency evacuation plan", details: error.message },
      { status: 500 }
    );
  }
}
