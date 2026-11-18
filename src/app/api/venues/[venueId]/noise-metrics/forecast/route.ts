import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateNoiseForecast } from "@/lib/noiseForecast";
import { generateWeeklyNoiseForecast } from "@/lib/weeklyNoiseForecast";
import { isValidTimeZone } from "@/lib/booking/dateTimeAdapter";
import { getRedis } from "@/lib/redis";
import { apiError } from "@/lib/apiResponse";

export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_TTL_SECONDS = 60 * 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;

    const venue = await prisma.venue.findFirst({
      where: {
        OR: [{ id: venueId }, { placeId: venueId }],
      },
      select: { id: true },
    });

    if (!venue) {
      return apiError("Venue not found", 404, "VENUE_NOT_FOUND");
    }

    const url = new URL(request.url);
    const requestedTimeZone = url.searchParams.get("tz") ?? "UTC";
    const timeZone = isValidTimeZone(requestedTimeZone)
      ? requestedTimeZone
      : "UTC";
    const cacheKey = `worksphere:venue-noise-forecast:v1:${venue.id}:${timeZone}`;
    const redis = getRedis();

    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached && typeof cached === "object") {
          return NextResponse.json(cached, {
            headers: { "X-Noise-Forecast-Cache": "HIT" },
          });
        }
        if (typeof cached === "string") {
          try {
            return NextResponse.json(JSON.parse(cached), {
              headers: { "X-Noise-Forecast-Cache": "HIT" },
            });
          } catch {
            // Ignore malformed/stale cache entries and rebuild the result.
          }
        }
      } catch (cacheError) {
        console.warn("[noise-forecast] Redis read failed; rebuilding result", cacheError);
      }
    }

    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - WEEK_MS);
    const [allTimeRatings, weeklyRatings] = await Promise.all([
      // Preserve the original all-history 24-hour summary for existing clients.
      prisma.venueRating.findMany({
        where: { venueId: venue.id, avgDecibels: { not: null } },
        select: { avgDecibels: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      // Keep the new weekday/hour forecast bounded to the trailing seven days.
      prisma.venueRating.findMany({
        where: {
          venueId: venue.id,
          avgDecibels: { not: null },
          createdAt: { gte: windowStart, lte: windowEnd },
        },
        select: { avgDecibels: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const rawData = allTimeRatings.map((rating) => ({
      avgDecibels: rating.avgDecibels as number,
      timestamp: rating.createdAt,
    }));
    const weeklyRawData = weeklyRatings.map((rating) => ({
      avgDecibels: rating.avgDecibels as number,
      timestamp: rating.createdAt,
    }));

    const result = {
      venueId: venue.id,
      // Keep the pre-existing all-history hourly summary unchanged.
      forecast: generateNoiseForecast(rawData, timeZone),
      // The 7 x 24 weekday/hour matrix uses only the trailing seven days.
      weeklyForecast: generateWeeklyNoiseForecast(weeklyRawData, {
        timeZone,
        windowStart,
        windowEnd,
      }),
    };

    if (redis) {
      try {
        await redis.set(cacheKey, result, { ex: CACHE_TTL_SECONDS });
      } catch (cacheError) {
        // Forecast availability must not depend on an optional cache service.
        console.warn("[noise-forecast] Redis write failed", cacheError);
      }
    }

    return NextResponse.json(result, {
      headers: { "X-Noise-Forecast-Cache": "MISS" },
    });
  } catch (error) {
    console.error(
      "GET /api/venues/[venueId]/noise-metrics/forecast error:",
      error,
    );
    return apiError("Failed to generate noise forecast", 500, "INTERNAL_ERROR");
  }
}
