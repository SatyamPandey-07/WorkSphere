/**
 * route.ts
 * /api/venues/[venueId]/solar
 * Computes solar azimuth, elevation, and desk sunlight exposure for a given venue.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  calculateSolarPosition,
  evaluateFloorplanSolarExposure,
  type WindowFacade,
} from "@/lib/geo/solarPosition";

type RouteContext = { params: Promise<{ venueId: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { venueId } = await context.params;
    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date");
    const hourParam = Number(searchParams.get("hour")) || 14; // default 2 PM

    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
      include: {
        seats: {
          where: { isEnabled: true },
          select: {
            id: true,
            seatNumber: true,
            type: true,
            x: true,
            y: true,
            isQuietZone: true,
          },
        },
      },
    });

    const latitude = venue?.latitude ?? 37.7749;
    const longitude = venue?.longitude ?? -122.4194;

    const targetDate = dateParam ? new Date(dateParam) : new Date();
    targetDate.setHours(hourParam, 0, 0, 0);

    const solarCoords = calculateSolarPosition(latitude, longitude, targetDate);

    // Default window facades for venue floorplan (South & West facing glass perimeter)
    const defaultWindows: WindowFacade[] = [
      {
        id: "win-south",
        facingBearingDeg: 180, // South
        wallStart: { x: 50, y: 500 },
        wallEnd: { x: 750, y: 500 },
      },
      {
        id: "win-west",
        facingBearingDeg: 270, // West
        wallStart: { x: 750, y: 50 },
        wallEnd: { x: 750, y: 500 },
      },
    ];

    // Map seats into desks array
    const desks =
      venue && venue.seats.length > 0
        ? venue.seats.map((s) => ({
            id: s.id,
            seatNumber: s.seatNumber,
            x: s.x,
            y: s.y,
          }))
        : [
            { id: "s-1", seatNumber: "Desk-01 (Window South)", x: 120, y: 440 },
            { id: "s-2", seatNumber: "Desk-02 (Window West)", x: 680, y: 220 },
            { id: "s-3", seatNumber: "Desk-03 (Center Island)", x: 380, y: 280 },
            { id: "s-4", seatNumber: "Desk-04 (Quiet Pod North)", x: 150, y: 100 },
          ];

    const deskExposures = evaluateFloorplanSolarExposure(solarCoords, defaultWindows, desks);

    // Compute hourly timeline for slider preview (8 AM to 8 PM)
    const hourlyTimeline = Array.from({ length: 13 }, (_, i) => {
      const h = 8 + i;
      const d = new Date(targetDate);
      d.setHours(h, 0, 0, 0);
      const pos = calculateSolarPosition(latitude, longitude, d);
      return {
        hour: h,
        timeLabel: `${h}:00`,
        elevationDeg: pos.elevationDeg,
        azimuthDeg: pos.azimuthDeg,
        isDaylight: pos.isDaylight,
      };
    });

    return NextResponse.json({
      success: true,
      venueName: venue?.name || "Workspace Venue",
      selectedHour: hourParam,
      solarCoordinates: solarCoords,
      hourlyTimeline,
      deskExposures,
    });
  } catch (error: any) {
    console.error("[GET /api/venues/[venueId]/solar] Error:", error);
    return NextResponse.json(
      { error: "Failed to compute solar orientation", details: error.message },
      { status: 500 }
    );
  }
}
