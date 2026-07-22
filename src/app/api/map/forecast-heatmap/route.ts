import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Types for venue and bookings similar to heatmap route
type VenueData = {
  id: string;
  latitude: number;
  longitude: number;
};

type ActiveBookingGroup = {
  venueId: string;
  _count: {
    id: number;
  };
};

type RatingData = {
  venueId: string;
  noiseLevel: string;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const dayParam = url.searchParams.get("day");
    const hourParam = url.searchParams.get("hour");
    const day = dayParam !== null ? parseInt(dayParam, 10) : null;
    const hour = hourParam !== null ? parseInt(hourParam, 10) : null;

    // Placeholder: use current heatmap logic. In future replace with historical telemetry lookup.
    const venues = await prisma.venue.findMany({
      select: { id: true, latitude: true, longitude: true },
    });

    const todayStr = new Date().toISOString().split("T")[0];
    const activeBookings = await prisma.booking.groupBy({
      by: ["venueId"],
      where: { date: todayStr, status: "CONFIRMED" },
      _count: { id: true },
    });

    const recentRatings = await prisma.venueRating.findMany({
      select: { venueId: true, noiseLevel: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const heatmapPoints = (venues as VenueData[]).map((venue) => {
      const bookingCount =
        (activeBookings as ActiveBookingGroup[]).find(
          (b) => b.venueId === venue.id,
        )?._count.id || 0;

      const venueNoiseRatings = (recentRatings as RatingData[]).filter(
        (r) => r.venueId === venue.id,
      );
      let noiseScore = 0.2;
      if (venueNoiseRatings.length > 0) {
        const loudCount = venueNoiseRatings.filter(
          (r) => r.noiseLevel === "loud",
        ).length;
        const moderateCount = venueNoiseRatings.filter(
          (r) => r.noiseLevel === "moderate",
        ).length;
        noiseScore += loudCount * 0.4 + moderateCount * 0.2;
      }
      const weight = Math.min(0.1 + bookingCount * 0.2 + noiseScore, 1.0);
      return [venue.latitude, venue.longitude, weight];
    });

    return NextResponse.json({ success: true, data: heatmapPoints, day, hour });
  } catch (error) {
    console.error("Forecast heatmap calculation failed:", error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
