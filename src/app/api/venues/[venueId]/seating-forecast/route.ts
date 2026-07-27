import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;

    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
      select: { maxCapacity: true },
    });

    if (!venue) {
      return NextResponse.json({ error: "Venue not found" }, { status: 404 });
    }

    const maxCapacity = venue.maxCapacity || 50;

    // Generate mock forecast data based on typical coworking hours
    const forecast = [];
    const recommendedHours = [];

    for (let i = 0; i < 24; i++) {
      let predictedOccupancy = 0;
      let confidence = 0.8;

      if (i >= 9 && i <= 17) {
        // Business hours
        if (i === 12 || i === 13) {
          // Lunch rush
          predictedOccupancy = Math.floor(maxCapacity * 0.8);
          confidence = 0.9;
        } else {
          // Normal business hours
          predictedOccupancy = Math.floor(maxCapacity * 0.6);
          confidence = 0.85;
        }
      } else if (i >= 18 && i <= 21) {
        // Evening
        predictedOccupancy = Math.floor(maxCapacity * 0.3);
        confidence = 0.7;
      } else {
        // Night / Early morning
        predictedOccupancy = Math.floor(maxCapacity * 0.05);
        confidence = 0.6;
      }

      // Add a bit of randomness to make it look realistic, but keep it consistent for the same hour
      const seed = (i * 17) % 5;
      predictedOccupancy = Math.min(
        maxCapacity,
        Math.max(0, predictedOccupancy + seed - 2),
      );

      forecast.push({
        hour: i,
        predictedOccupancy,
        confidence,
        capacity: maxCapacity,
      });
    }

    // Recommended hours (lowest occupancy during business hours)
    const businessHours = forecast.filter((f) => f.hour >= 9 && f.hour <= 17);
    businessHours.sort((a, b) => a.predictedOccupancy - b.predictedOccupancy);

    recommendedHours.push(...businessHours.slice(0, 3).map((f) => f.hour));

    return NextResponse.json({
      forecast,
      recommendedHours,
      capacity: maxCapacity,
    });
  } catch (error) {
    console.error("Error generating seating forecast:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
