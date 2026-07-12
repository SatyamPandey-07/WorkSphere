import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ venueId: string }> }
) {
  try {
    const { venueId } = await params;
    if (!venueId) {
      return NextResponse.json({ error: "Venue ID is required" }, { status: 400 });
    }

    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
      include: {
        wifiTelemetry: {
          orderBy: { timestamp: 'desc' },
          take: 50
        }
      }
    });

    if (!venue && !venueId.startsWith("mock-")) {
      return NextResponse.json({ error: "Venue not found" }, { status: 404 });
    }

    const baseSpeed = venue?.wifiSpeed || 50; // Fallback to 50 Mbps if no base speed known
    
    // In a real AI system, this would call a model endpoint.
    // For now, we mock the prediction logic using a heuristic based on time of day.
    // We assume peak crowds at 10 AM - 11 AM and 2 PM - 4 PM.
    const predictions = [];
    
    for (let hour = 8; hour <= 20; hour++) { // 8 AM to 8 PM
      let crowdMultiplier = 1.0;
      let crowdLevel = "empty";

      if (hour >= 10 && hour <= 11) {
        crowdMultiplier = 0.6; // 40% drop during morning rush
        crowdLevel = "busy";
      } else if (hour >= 14 && hour <= 16) {
        crowdMultiplier = 0.5; // 50% drop during afternoon peak
        crowdLevel = "very busy";
      } else if (hour >= 12 && hour <= 13) {
        crowdMultiplier = 0.8; // Lunchtime dip
        crowdLevel = "moderate";
      } else if (hour >= 17 && hour <= 18) {
        crowdMultiplier = 0.7; // Evening transition
        crowdLevel = "busy";
      } else {
        crowdMultiplier = 0.95; // Slightly below max at quiet times
      }

      // Add a bit of random noise for realism
      const noise = (Math.random() * 0.1) - 0.05; // +/- 5%
      let predictedSpeed = Math.round(baseSpeed * (crowdMultiplier + noise));
      
      // Ensure it doesn't go below 1 Mbps
      if (predictedSpeed < 1) predictedSpeed = 1;

      const timeLabel = hour === 12 ? "12 PM" : hour > 12 ? `${hour - 12} PM` : `${hour} AM`;

      predictions.push({
        time: timeLabel,
        speed: predictedSpeed,
        crowd: crowdLevel
      });
    }

    return NextResponse.json({ predictions });
  } catch (error) {
    console.error("Wifi prediction error:", error);
    return NextResponse.json(
      { error: "Failed to generate wifi prediction" },
      { status: 500 }
    );
  }
}
