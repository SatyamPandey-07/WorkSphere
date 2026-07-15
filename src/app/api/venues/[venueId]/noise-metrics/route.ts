import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type BucketKey = "morning" | "lunch" | "afternoon" | "evening";

const bucketOrder: Array<{ key: BucketKey; label: string }> = [
  { key: "morning", label: "Morning" },
  { key: "lunch", label: "Lunch hour" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
];

function getBucket(hour: number): BucketKey {
  if (hour < 11) return "morning";
  if (hour < 14) return "lunch";
  if (hour < 18) return "afternoon";
  return "evening";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ venueId: string }> },
) {
  const { venueId } = await params;

  const venue = await prisma.venue.findFirst({
    where: {
      OR: [{ id: venueId }, { placeId: venueId }],
    },
    select: { id: true },
  });

  if (!venue) {
    return NextResponse.json({ error: "Venue not found" }, { status: 404 });
  }

  const ratings = await prisma.venueRating.findMany({
    where: {
      venueId: venue.id,
      avgDecibels: { not: null },
    },
    select: {
      avgDecibels: true,
      peakDecibels: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const grouped: Record<
    BucketKey,
    { averages: number[]; peaks: number[] }
  > = {
    morning: { averages: [], peaks: [] },
    lunch: { averages: [], peaks: [] },
    afternoon: { averages: [], peaks: [] },
    evening: { averages: [], peaks: [] },
  };

  for (const rating of ratings) {
    if (rating.avgDecibels === null) continue;

    const bucket = getBucket(rating.createdAt.getHours());

    grouped[bucket].averages.push(rating.avgDecibels);

    if (rating.peakDecibels !== null) {
      grouped[bucket].peaks.push(rating.peakDecibels);
    }
  }

  const buckets = bucketOrder.map(({ key, label }) => {
    const averageValues = grouped[key].averages;
    const peakValues = grouped[key].peaks;

    const averageDb =
      averageValues.length > 0
        ? Math.round(
            (averageValues.reduce((sum, value) => sum + value, 0) /
              averageValues.length) *
              10,
          ) / 10
        : null;

    const peakDb =
      peakValues.length > 0
        ? Math.round(Math.max(...peakValues) * 10) / 10
        : null;

    return {
      key,
      label,
      averageDb,
      peakDb,
      samples: averageValues.length,
    };
  });

  return NextResponse.json({
    venueId: venue.id,
    buckets,
    totalSamples: ratings.length,
  });
}
