/**
 * route.ts
 * /api/analytics/carbon-footprint
 * Computes monthly commuter carbon footprints, avoided CO2 savings, and exports corporate Scope 3 ESG dossiers.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import {
  generateMonthlyCarbonSummary,
  exportCorporateESGReportCSV,
  type CommuteMode,
} from "@/lib/sustainability/carbonEngine";

export const dynamic = "force-dynamic";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    const { userId: authenticatedUserId } = await auth();

    if (!authenticatedUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const requestedUserId = searchParams.get("userId");

    if (requestedUserId && requestedUserId !== authenticatedUserId) {
      return NextResponse.json(
        { error: "Forbidden: Cannot access another user's carbon footprint" },
        { status: 403 },
      );
    }

    const userId = authenticatedUserId;
    const month = searchParams.get("month") || "October 2026";
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    if (startDate || endDate) {
      if (
        !startDate ||
        !endDate ||
        !ISO_DATE_PATTERN.test(startDate) ||
        !ISO_DATE_PATTERN.test(endDate)
      ) {
        return NextResponse.json(
          {
            error:
              "Invalid date range parameters. Both startDate and endDate must be YYYY-MM-DD",
          },
          { status: 400 },
        );
      }
      if (startDate > endDate) {
        return NextResponse.json(
          { error: "startDate cannot be after endDate" },
          { status: 400 },
        );
      }
    }

    // Fetch user's bookings from database
    const bookings = await prisma.booking.findMany({
      where: {
        userId,
        ...(startDate && endDate
          ? {
              date: {
                gte: startDate,
                lte: endDate,
              },
            }
          : {}),
      },
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

    // Extract verified commute records if available on the booking records.
    // Strictly reject synthetic modulo math or hardcoded fallback trips.
    // If telemetry or real commute attributes are absent, do NOT fake them.
    const verifiedTrips: Array<{
      bookingId: string;
      venueName: string;
      date: string;
      distanceKm: number;
      commuteMode: CommuteMode;
      isGreenCertifiedVenue: boolean;
    }> = [];

    for (const b of bookings) {
      const record = b as unknown as {
        commuteDistanceKm?: number;
        commuteMode?: CommuteMode;
        isGreenCertifiedVenue?: boolean;
      };
      if (
        typeof record.commuteDistanceKm === "number" &&
        record.commuteDistanceKm > 0 &&
        record.commuteMode
      ) {
        verifiedTrips.push({
          bookingId: b.confirmationId || `BK-${b.id.slice(-6)}`,
          venueName: b.venue.name,
          date: b.date,
          distanceKm: record.commuteDistanceKm,
          commuteMode: record.commuteMode,
          isGreenCertifiedVenue: Boolean(record.isGreenCertifiedVenue),
        });
      }
    }

    if (verifiedTrips.length === 0) {
      return NextResponse.json({
        success: true,
        status: "INSUFFICIENT_DATA",
        message:
          "No verified commute records found for the requested period. Telemetry data is required for audited carbon footprint analytics.",
        summary: null,
        totalBookings: bookings.length,
      });
    }

    const periodLabel =
      startDate && endDate ? `${startDate} to ${endDate}` : month;
    const summary = generateMonthlyCarbonSummary(verifiedTrips, periodLabel);

    return NextResponse.json({
      success: true,
      status: "AVAILABLE",
      summary,
    });
  } catch (error: any) {
    console.error("[GET /api/analytics/carbon-footprint] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to generate carbon footprint analytics",
        details: error.message,
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId: authenticatedUserId } = await auth();

    if (!authenticatedUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { summary, format = "csv" } = body;

    if (!summary || typeof summary !== "object") {
      return NextResponse.json(
        { error: "Missing or invalid summary payload" },
        { status: 400 },
      );
    }

    if (!Array.isArray(summary.records)) {
      return NextResponse.json(
        { error: "Invalid summary payload: records array is required" },
        { status: 400 },
      );
    }

    if (format !== "csv" && format !== "json") {
      return NextResponse.json(
        { error: "Invalid format. Supported formats: 'csv', 'json'" },
        { status: 400 },
      );
    }

    if (format === "csv") {
      const csvData = exportCorporateESGReportCSV(summary);
      const safePeriod = summary.periodMonth
        ? String(summary.periodMonth).replace(/\s+/g, "-")
        : "Report";

      return new NextResponse(csvData, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename=WorkSphere-Scope3-ESG-Report-${safePeriod}.csv`,
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
      { status: 500 },
    );
  }
}
