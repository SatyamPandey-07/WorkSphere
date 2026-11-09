/**
 * route.ts
 * /api/analytics/acoustic-gradient
 * Generates continuous spatial acoustic sound gradients and per-seat decibel ratings.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  generateAcousticField,
  type SoundEmitter,
} from "@/lib/spatial/acousticGradientEngine";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const venueId = searchParams.get("venueId") || "venue-sf-01";

    const defaultEmitters: SoundEmitter[] = [
      {
        id: "emit-espresso",
        name: "Espresso Bar & Steam Wand",
        type: "ESPRESSO_BAR",
        x: 80,
        y: 25,
        baseDecibels: 68,
        isActive: true,
      },
      {
        id: "emit-entrance",
        name: "Main Reception & Street Door",
        type: "ENTRANCE_DOOR",
        x: 15,
        y: 85,
        baseDecibels: 58,
        isActive: true,
      },
      {
        id: "emit-lounge",
        name: "Collaborative Team Table",
        type: "COLLABORATIVE_TABLE",
        x: 50,
        y: 60,
        baseDecibels: 54,
        isActive: true,
      },
      {
        id: "emit-booth",
        name: "Acoustic Phone Booths",
        type: "PHONE_BOOTH",
        x: 20,
        y: 20,
        baseDecibels: 38,
        isActive: true,
      },
    ];

    const defaultDesks = [
      { id: "d-1", seatNumber: "Desk 01 (Quiet North Nook)", x: 25, y: 15 },
      { id: "d-2", seatNumber: "Desk 02 (Center Hot Desk)", x: 45, y: 40 },
      { id: "d-3", seatNumber: "Desk 03 (Barista Adjacent)", x: 75, y: 35 },
      { id: "d-4", seatNumber: "Desk 04 (Lounge Perimeter)", x: 55, y: 75 },
      { id: "d-5", seatNumber: "Desk 05 (East Glass Wall)", x: 85, y: 70 },
    ];

    const fieldMap = generateAcousticField(defaultEmitters, defaultDesks);

    return NextResponse.json({
      success: true,
      venueId,
      fieldMap,
    });
  } catch (error: any) {
    console.error("[GET /api/analytics/acoustic-gradient] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate spatial acoustic field", details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { emitters, desks, gridWidth = 40, gridHeight = 25 } = body;

    if (!emitters || !desks) {
      return NextResponse.json(
        { error: "emitters and desks arrays are required" },
        { status: 400 }
      );
    }

    const fieldMap = generateAcousticField(emitters, desks, gridWidth, gridHeight);

    return NextResponse.json({
      success: true,
      fieldMap,
    });
  } catch (error: any) {
    console.error("[POST /api/analytics/acoustic-gradient] Error:", error);
    return NextResponse.json(
      { error: "Failed to recalculate acoustic field", details: error.message },
      { status: 500 }
    );
  }
}
