import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateNoiseForecast } from "@/lib/noiseForecast";
import { apiError } from "@/lib/apiResponse";

export async function GET(
  _request: Request,
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

    const ratings = await prisma.venueRating.findMany({
      where: {
        venueId: venue.id,
        avgDecibels: { not: null },
      },
      select: {
        avgDecibels: true,
        createdAt: true,
      },
    });

    const rawData = ratings.map((r) => ({
      avgDecibels: r.avgDecibels as number,
      timestamp: r.createdAt,
    }));

    const result = generateNoiseForecast(rawData);

    return NextResponse.json(result);
  } catch (error) {
    console.error(
      "GET /api/venues/[venueId]/noise-metrics/forecast error:",
      error,
    );
    return apiError("Failed to generate noise forecast", 500, "INTERNAL_ERROR");
  }
}
