/**
 * route.ts
 * /api/analytics/noise-forecast
 * Returns 24-hour predictive acoustic curves, peak noise hazard intervals, and Edge-AI spectral ratings.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generate24HourNoiseForecast } from "@/lib/noise/acousticForecaster";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const venueId = searchParams.get("venueId") || "venue-default-sf";

    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
      select: {
        id: true,
        name: true,
        category: true,
        hasQuietZone: true,
        noiseLevel: true,
      },
    });

    const venueName = venue?.name || "SoMa Focus Hub & Artisan Cafe";
    const venueCategory = venue?.category || "coworking";
    const hasQuietZone = venue?.hasQuietZone ?? true;

    const report = generate24HourNoiseForecast(
      venueId,
      venueName,
      venueCategory,
      hasQuietZone
    );

    return NextResponse.json({
      success: true,
      report,
    });
  } catch (error: any) {
    console.error("[GET /api/analytics/noise-forecast] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate acoustic noise forecast", details: error.message },
      { status: 500 }
    );
  }
}
