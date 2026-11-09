/**
 * route.ts
 * /api/analytics/carbon-footprint
 * Computes monthly commuter carbon footprints, avoided CO2 savings, and exports corporate Scope 3 ESG dossiers.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  generateMonthlyCarbonSummary,
  exportCorporateESGReportCSV,
  type CommuteMode,
} from "@/lib/sustainability/carbonEngine";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId") || "user_nomad_demo";
    const month = searchParams.get("month") || "October 2026";

    // Fetch user's bookings from database
    const bookings = await prisma.booking.findMany({
      where: { userId },
      include: {
        venue: {
          select: {
            name: true,
            category: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    // Transform DB bookings or use realistic sample commute data
    let trips = bookings.map((b, idx) => {
      const modes: CommuteMode[] = ["WALKING", "BICYCLING", "PUBLIC_TRANSIT", "ELECTRIC_SCOOTER"];
      const selectedMode = modes[idx % modes.length];
      const dist = Number((2.5 + (idx % 4) * 1.8).toFixed(1));

      return {
        bookingId: b.confirmationId || `BK-${b.id.slice(-6)}`,
        venueName: b.venue.name,
        date: b.date || new Date().toISOString().split("T")[0],
        distanceKm: dist,
        commuteMode: selectedMode,
        isGreenCertifiedVenue: idx % 2 === 0,
      };
    });

    if (trips.length < 4) {
      trips = [
        {
          bookingId: "BK-78901",
          venueName: "Sightglass Artisan Coffee & Lab",
          date: "2026-10-02",
          distanceKm: 2.4,
          commuteMode: "WALKING" as CommuteMode,
          isGreenCertifiedVenue: true,
        },
        {
          bookingId: "BK-78902",
          venueName: "Workshop Cafe SoMa",
          date: "2026-10-04",
          distanceKm: 5.8,
          commuteMode: "BICYCLING" as CommuteMode,
          isGreenCertifiedVenue: true,
        },
        {
          bookingId: "BK-78903",
          venueName: "Canopy Collaborative Lounge",
          date: "2026-10-06",
          distanceKm: 8.2,
          commuteMode: "PUBLIC_TRANSIT" as CommuteMode,
          isGreenCertifiedVenue: false,
        },
        {
          bookingId: "BK-78904",
          venueName: "Factory Berlin Mitte",
          date: "2026-10-08",
          distanceKm: 3.5,
          commuteMode: "ELECTRIC_SCOOTER" as CommuteMode,
          isGreenCertifiedVenue: true,
        },
      ];
    }

    const summary = generateMonthlyCarbonSummary(trips, month);

    return NextResponse.json({
      success: true,
      summary,
    });
  } catch (error: any) {
    console.error("[GET /api/analytics/carbon-footprint] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate carbon footprint analytics", details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { summary, format = "csv" } = body;

    if (!summary) {
      return NextResponse.json({ error: "Missing summary payload" }, { status: 400 });
    }

    if (format === "csv") {
      const csvData = exportCorporateESGReportCSV(summary);
      return new NextResponse(csvData, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename=WorkSphere-Scope3-ESG-Report-${summary.periodMonth.replace(" ", "-")}.csv`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      report: summary,
      exportedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[POST /api/analytics/carbon-footprint] Error:", error);
    return NextResponse.json(
      { error: "Failed to export ESG report", details: error.message },
      { status: 500 }
    );
  }
}
