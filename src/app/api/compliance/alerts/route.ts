/**
 * alerts/route.ts
 * API endpoint that evaluates upcoming travel itineraries against current visa limits
 * and pushes proactive warnings.
 */
import { NextRequest, NextResponse } from "next/server";
import { VisaDayTracker } from "@/core/compliance/VisaDayTracker";

export interface ItineraryLeg {
  country: string;
  entryDate: string;
  exitDate: string;
}

export interface ItineraryRequest {
  userId: string;
  legs: ItineraryLeg[];
}

export interface Alert {
  severity: "info" | "warning" | "critical";
  message: string;
  zone: string;
  daysRemaining: number;
}

export async function POST(request: NextRequest) {
  try {
    const body: ItineraryRequest = await request.json();
    const { userId, legs } = body;

    if (!userId || !Array.isArray(legs)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const tracker = new VisaDayTracker();

    // In a real app, we would load the user's historical movements into the tracker first
    // For this endpoint, we assume the tracker is pre-loaded or we just evaluate the itinerary

    const alerts: Alert[] = [];

    for (const leg of legs) {
      const entry = new Date(leg.entryDate);
      const exit = new Date(leg.exitDate);
      const durationDays = Math.ceil(
        (exit.getTime() - entry.getTime()) / (1000 * 60 * 60 * 24),
      );

      // Simulate the stay
      const futureStatuses = tracker.simulateFutureStay(
        leg.country,
        entry,
        durationDays,
      );

      for (const status of futureStatuses) {
        if (status.isBreached) {
          alerts.push({
            severity: "critical",
            message: `Itinerary will breach ${status.zoneName} visa limit.`,
            zone: status.zoneName,
            daysRemaining: status.daysRemaining,
          });
        } else if (status.isApproachingLimit) {
          alerts.push({
            severity: "warning",
            message: `Itinerary leaves only ${status.daysRemaining} days in ${status.zoneName}.`,
            zone: status.zoneName,
            daysRemaining: status.daysRemaining,
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        alerts,
        evaluatedLegs: legs.length,
      },
    });
  } catch (error: any) {
    console.error("[Alerts API] Error evaluating itinerary:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}
