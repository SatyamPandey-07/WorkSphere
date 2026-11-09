/**
 * route.ts
 * POST /api/ar/wayfinding
 * Calculates turn-by-turn indoor spatial vectors and waypoints for WebXR AR Wayfinding.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  computeARIndoorRoute,
  type Vector3D,
} from "@/lib/spatial/arWayfindingEngine";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      venueId,
      currentPosition = { x: 0, y: 0, z: 0 },
      targetSeatId,
      targetSeatNumber,
    } = body;

    let destination: Vector3D = { x: 5.4, y: 0, z: -8.2 };
    let seatNumber = targetSeatNumber || "Desk A-14";
    let seatId = targetSeatId || "seat_default";

    if (venueId) {
      // Look up seat or anchor in database
      const seat = await prisma.venueSeat.findFirst({
        where: {
          venueId,
          ...(targetSeatId ? { id: targetSeatId } : {}),
          ...(targetSeatNumber ? { seatNumber: targetSeatNumber } : {}),
        },
        include: { xrAnchors: true },
      });

      if (seat) {
        seatId = seat.id;
        seatNumber = seat.seatNumber;

        // If spatial anchor exists, use anchor coordinates
        if (seat.xrAnchors.length > 0 && seat.xrAnchors[0].matrix.length >= 16) {
          const m = seat.xrAnchors[0].matrix;
          destination = { x: m[12] || 5.0, y: m[13] || 0, z: m[14] || -8.0 };
        } else {
          // Convert 2D floorplan pixel coordinates (x, y) to meters (e.g. 50px = 1m)
          destination = {
            x: Number((seat.x / 50).toFixed(2)),
            y: 0,
            z: Number((-seat.y / 50).toFixed(2)),
          };
        }
      }
    }

    const route = computeARIndoorRoute(
      currentPosition,
      destination,
      seatId,
      seatNumber
    );

    return NextResponse.json({
      success: true,
      route,
      currentPose: currentPosition,
      amenitiesNearby: [
        { name: "Quiet Phone Booth", offsetDistanceMeters: 3.2 },
        { name: "Artisan Coffee Bar", offsetDistanceMeters: 12.0 },
        { name: "Printer / Scanner Station", offsetDistanceMeters: 6.5 },
      ],
    });
  } catch (error: any) {
    console.error("[POST /api/ar/wayfinding] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate AR indoor navigation route", details: error.message },
      { status: 500 }
    );
  }
}
