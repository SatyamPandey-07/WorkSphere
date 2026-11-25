import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  tileToBoundingBox,
  validateTileCoordinates,
} from "@/lib/geo/heatmapTile";
import {
  aggregateHeatmapTile,
  getHeatmapTileCacheKey,
  getOrComputeCachedTile,
  HeatmapPoint,
  NoiseStats,
} from "@/lib/geo/heatmapAggregator";

type VenueData = {
  id: string;
  latitude: number;
  longitude: number;
};

export async function GET(req?: Request) {
  try {
    const todayStr = new Date().toISOString().split("T")[0];

    // Check if tile query parameters were provided
    let url: URL | null = null;
    if (req && req.url) {
      try {
        url = new URL(req.url);
      } catch {
        url = null;
      }
    }

    const searchParams = url?.searchParams;
    const zParam = searchParams?.get("z") ?? searchParams?.get("zoom");
    const xParam = searchParams?.get("x") ?? searchParams?.get("tileX");
    const yParam = searchParams?.get("y") ?? searchParams?.get("tileY");

    const isTileQuery = Boolean(zParam && xParam && yParam);

    if (isTileQuery) {
      const z = Number(zParam);
      const x = Number(xParam);
      const y = Number(yParam);

      const validation = validateTileCoordinates(z, x, y);
      if (!validation.valid) {
        return NextResponse.json(
          {
            success: false,
            error: validation.error || "Invalid tile coordinates",
          },
          { status: 400 },
        );
      }

      const bounds = tileToBoundingBox(z, x, y);
      const cacheKey = getHeatmapTileCacheKey(z, x, y, todayStr);

      const points = await getOrComputeCachedTile(cacheKey, async () => {
        // Spatial filter at the database level: only fetch venues inside tile bounds
        const venues = (await prisma.venue.findMany({
          where: {
            latitude: {
              gte: bounds.minLat,
              lt: bounds.maxLat,
            },
            longitude:
              bounds.minLng <= bounds.maxLng
                ? {
                    gte: bounds.minLng,
                    lt: bounds.maxLng,
                  }
                : undefined, // Cross-antimeridian bounds handled in application filter if needed
          },
          select: {
            id: true,
            latitude: true,
            longitude: true,
          },
        })) as VenueData[];

        if (venues.length === 0) {
          return [];
        }

        const venueIds = venues.map((v) => v.id);

        // Fetch only active bookings and ratings for venues in this spatial tile
        const [activeBookings, ratingsSummary] = await Promise.all([
          prisma.booking.groupBy({
            by: ["venueId"],
            where: {
              venueId: { in: venueIds },
              date: todayStr,
              status: "CONFIRMED",
            },
            _count: {
              id: true,
            },
          }),
          prisma.venueRating.groupBy({
            by: ["venueId", "noiseLevel"],
            where: {
              venueId: { in: venueIds },
            },
            _count: {
              id: true,
            },
          }),
        ]);

        const activeBookingMap = new Map<string, number>();
        for (const b of activeBookings) {
          activeBookingMap.set(b.venueId, b._count.id);
        }

        const venueNoiseMap = new Map<string, NoiseStats>();
        for (const r of ratingsSummary) {
          if (!r.venueId) continue;
          const stats = venueNoiseMap.get(r.venueId) ?? {
            loud: 0,
            moderate: 0,
            quiet: 0,
            total: 0,
          };
          const count = r._count.id;
          if (r.noiseLevel === "loud") stats.loud += count;
          else if (r.noiseLevel === "moderate") stats.moderate += count;
          else if (r.noiseLevel === "quiet") stats.quiet += count;
          stats.total += count;
          venueNoiseMap.set(r.venueId, stats);
        }

        return aggregateHeatmapTile({
          z,
          x,
          y,
          bounds,
          venues,
          activeBookings: activeBookingMap,
          venueNoiseStats: venueNoiseMap,
        });
      });

      return NextResponse.json({
        success: true,
        tile: { z, x, y, bounds },
        count: points.length,
        data: points,
      });
    }

    // Baseline fallback: legacy global query when no tile coordinates are specified
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
    const venueNoiseMap = new Map<string, NoiseStats>();

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

    const heatmapPoints: HeatmapPoint[] = (venues as VenueData[]).map(
      (venue: VenueData) => {
        const bookingCount = activeBookingMap.get(venue.id) ?? 0;
        const noiseStats = venueNoiseMap.get(venue.id);

        let noiseScore = 0.2;
        if (noiseStats && noiseStats.total > 0) {
          const loudRatio = noiseStats.loud / noiseStats.total;
          const moderateRatio = noiseStats.moderate / noiseStats.total;
          noiseScore = 0.1 + (loudRatio * 0.4 + moderateRatio * 0.2);
        }

        const weight = Math.min(0.1 + bookingCount * 0.2 + noiseScore, 1.0);
        return [venue.latitude, venue.longitude, Number(weight.toFixed(4))];
      },
    );

    return NextResponse.json({ success: true, data: heatmapPoints });
  } catch (error) {
    console.error("Heatmap calculation metrics failed:", error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
