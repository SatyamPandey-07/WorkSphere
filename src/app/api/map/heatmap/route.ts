import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type VenueData = {
  id: string;
  latitude: number;
  longitude: number;
};

export async function GET() {
  try {
    const todayStr = new Date().toISOString().split("T")[0];

    const [venues, activeBookings, ratingsSummary] = await Promise.all([
      prisma.venue.findMany({
        select: {
          id: true,
          latitude: true,
          longitude: true,
        },
      }),
      prisma.booking.groupBy({
        by: ["venueId"],
        where: {
          date: todayStr,
          status: "CONFIRMED",
        },
        _count: {
          id: true,
        },
      }),
      prisma.venueRating.groupBy({
        by: ["venueId", "noiseLevel"],
        _count: {
          id: true,
        },
      }),
    ]);

    // Map active bookings by venue ID for O(1) retrieval
    const activeBookingMap = new Map<string, number>();
    for (const b of activeBookings) {
      activeBookingMap.set(b.venueId, b._count.id);
    }

    // Map noise rating distributions by venue ID to avoid global-limit bias
    const venueNoiseMap = new Map<
      string,
      { loud: number; moderate: number; quiet: number; total: number }
    >();

    for (const r of ratingsSummary) {
      if (!r.venueId) continue;
      const stats = venueNoiseMap.get(r.venueId) ?? {
        loud: 0,
        moderate: 0,
        quiet: 0,
        total: 0,
      };
      const count = r._count.id;
      if (r.noiseLevel === "loud") {
        stats.loud += count;
      } else if (r.noiseLevel === "moderate") {
        stats.moderate += count;
      } else if (r.noiseLevel === "quiet") {
        stats.quiet += count;
      }
      stats.total += count;
      venueNoiseMap.set(r.venueId, stats);
    }

    const heatmapPoints = (venues as VenueData[]).map((venue: VenueData) => {
      const bookingCount = activeBookingMap.get(venue.id) ?? 0;
      const noiseStats = venueNoiseMap.get(venue.id);

      // Defined baseline fallback score (0.2) when a venue has no user ratings
      let noiseScore = 0.2;

      if (noiseStats && noiseStats.total > 0) {
        const loudRatio = noiseStats.loud / noiseStats.total;
        const moderateRatio = noiseStats.moderate / noiseStats.total;
        noiseScore = 0.1 + (loudRatio * 0.4 + moderateRatio * 0.2);
      }

      const weight = Math.min(0.1 + bookingCount * 0.2 + noiseScore, 1.0);

      return [venue.latitude, venue.longitude, Number(weight.toFixed(4))];
    });

    return NextResponse.json({ success: true, data: heatmapPoints });
  } catch (error) {
    console.error("Heatmap calculation metrics failed:", error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
