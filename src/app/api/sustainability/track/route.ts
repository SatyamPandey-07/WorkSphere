/**
 * track/route.ts
 * API endpoint to log completed commute telemetry and update the user's lifetime sustainability ledger.
 */
import { NextRequest, NextResponse } from "next/server";
import { TransportMode } from "@/core/sustainability/CarbonFootprintEngine";

export interface CommuteLog {
  userId: string;
  date: string;
  mode: TransportMode;
  distanceKm: number;
  co2Grams: number;
  durationMin: number;
  routePolyline?: string;
}

// Mock ledger database
const userLedgers: Map<string, CommuteLog[]> = new Map();

export async function POST(request: NextRequest) {
  try {
    const body: CommuteLog = await request.json();
    const { userId, date, mode, distanceKm, co2Grams, durationMin } = body;

    if (
      !userId ||
      !mode ||
      distanceKm === undefined ||
      co2Grams === undefined
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    if (!userLedgers.has(userId)) {
      userLedgers.set(userId, []);
    }

    const ledger = userLedgers.get(userId)!;
    ledger.push({
      userId,
      date: date || new Date().toISOString().split("T")[0],
      mode,
      distanceKm,
      co2Grams,
      durationMin,
    });

    // Calculate lifetime stats
    const totalCO2 = ledger.reduce((sum, log) => sum + log.co2Grams, 0);
    const totalDistance = ledger.reduce((sum, log) => sum + log.distanceKm, 0);

    console.log(
      `[Track API] Logged commute for ${userId}: ${distanceKm}km, ${co2Grams}g CO2`,
    );

    return NextResponse.json({
      success: true,
      data: {
        lifetimeCO2Kg: parseFloat((totalCO2 / 1000).toFixed(2)),
        lifetimeDistanceKm: parseFloat(totalDistance.toFixed(2)),
        totalCommutes: ledger.length,
      },
    });
  } catch (error: any) {
    console.error("[Track API] Error logging commute:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const ledger = userLedgers.get(userId) || [];

  return NextResponse.json({
    success: true,
    data: ledger,
  });
}
