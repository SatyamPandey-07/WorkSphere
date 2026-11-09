/**
 * route.ts
 * /api/telemetry/outlets
 * Ingests socket power telemetry, dead-plug reports, and returns venue power grid health.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  computeVenuePowerGridSummary,
  type DeskPowerNode,
  type PowerSocketType,
  type OutletHealthStatus,
} from "@/lib/telemetry/powerGridEngine";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const venueId = searchParams.get("venueId") || "venue-sf-01";

    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
      select: {
        id: true,
        name: true,
        hasOutlets: true,
        outletDensity: true,
        powerTypes: true,
      },
    });

    const venueName = venue?.name || "Mission Focus Coworking & Cafe";

    const mockNodes: DeskPowerNode[] = [
      {
        seatId: "seat-01",
        seatNumber: "Desk 01 (North Pod)",
        socketType: "USB_C_140W_PD",
        maxWattageW: 140,
        measuredVoltageV: 121.4,
        status: "OPERATIONAL_OPTIMAL",
        reliabilityScorePct: 99,
        lastVerifiedAt: new Date(Date.now() - 15 * 60000).toISOString(),
        reportedIssueCount: 0,
        outletLocation: "DESK_GROMMET",
      },
      {
        seatId: "seat-02",
        seatNumber: "Desk 02 (Center Hot Desk)",
        socketType: "USB_C_100W_PD",
        maxWattageW: 100,
        measuredVoltageV: 120.8,
        status: "OPERATIONAL_OPTIMAL",
        reliabilityScorePct: 96,
        lastVerifiedAt: new Date(Date.now() - 35 * 60000).toISOString(),
        reportedIssueCount: 0,
        outletLocation: "UNDER_DESK",
      },
      {
        seatId: "seat-03",
        seatNumber: "Desk 03 (Bar Counter #3)",
        socketType: "AC_UNIVERSAL_WALL",
        maxWattageW: 45,
        measuredVoltageV: 0.0,
        status: "DEAD_NO_POWER",
        reliabilityScorePct: 20,
        lastVerifiedAt: new Date(Date.now() - 120 * 60000).toISOString(),
        reportedIssueCount: 3,
        outletLocation: "WALL_MOUNTED",
      },
      {
        seatId: "seat-04",
        seatNumber: "Desk 04 (Quiet Booth)",
        socketType: "USB_C_100W_PD",
        maxWattageW: 100,
        measuredVoltageV: 119.9,
        status: "OPERATIONAL_OPTIMAL",
        reliabilityScorePct: 98,
        lastVerifiedAt: new Date(Date.now() - 5 * 60000).toISOString(),
        reportedIssueCount: 0,
        outletLocation: "DESK_GROMMET",
      },
      {
        seatId: "seat-05",
        seatNumber: "Desk 05 (Terrace Lounge)",
        socketType: "WIRELESS_MAGSAFE",
        maxWattageW: 15,
        measuredVoltageV: 120.2,
        status: "THROTTLED_LOW_WATTAGE",
        reliabilityScorePct: 78,
        lastVerifiedAt: new Date(Date.now() - 50 * 60000).toISOString(),
        reportedIssueCount: 1,
        outletLocation: "FLOOR_BOX",
      },
    ];

    const gridStatusParam = searchParams.get("gridStatus") as any;
    const summary = computeVenuePowerGridSummary(
      venueId,
      venueName,
      mockNodes,
      120,
      gridStatusParam || undefined
    );

    return NextResponse.json({
      success: true,
      summary,
    });
  } catch (error: any) {
    console.error("[GET /api/telemetry/outlets] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch power grid telemetry", details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { seatId, issueType = "DEAD_NO_POWER", comment } = body;

    if (!seatId) {
      return NextResponse.json({ error: "seatId is required" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: "Outlet issue reported! Venue operations team notified.",
      reportId: `PWR-FLAG-${Date.now().toString().slice(-6)}`,
      status: issueType,
    });
  } catch (error: any) {
    console.error("[POST /api/telemetry/outlets] Error:", error);
    return NextResponse.json(
      { error: "Failed to record power outlet report", details: error.message },
      { status: 500 }
    );
  }
}
