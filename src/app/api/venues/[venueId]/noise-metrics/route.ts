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

  const grouped: Record<BucketKey, { averages: number[]; peaks: number[] }> = {
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;
    const body = await request.json().catch(() => ({}));

    const rawDb = body.decibels ?? body.avgDecibels;
    const decibels =
      typeof rawDb === "number" ? Math.round(rawDb * 10) / 10 : null;

    if (
      decibels === null ||
      isNaN(decibels) ||
      decibels < 30 ||
      decibels > 90
    ) {
      return NextResponse.json(
        { error: "Decibel reading must be a number between 30 and 90 dB" },
        { status: 400 },
      );
    }

    const rawPeak = body.peakDecibels;
    const peakDecibels =
      typeof rawPeak === "number" && !isNaN(rawPeak)
        ? Math.round(Math.max(rawPeak, decibels) * 10) / 10
        : decibels;

    const venue = await prisma.venue.findFirst({
      where: {
        OR: [{ id: venueId }, { placeId: venueId }],
      },
      select: { id: true },
    });

    if (!venue) {
      return NextResponse.json({ error: "Venue not found" }, { status: 404 });
    }

    // Determine noise level category
    const noiseLevel =
      decibels < 45 ? "quiet" : decibels <= 65 ? "moderate" : "loud";

    // Obtain user id or fallback guest user
    let userId = "guest-noise-reporter";
    try {
      const { auth } = await import("@clerk/nextjs/server");
      const session = await auth();
      if (session?.userId) {
        userId = session.userId;
      }
    } catch {
      // Ignore if auth helper unavailable
    }

    // Ensure user record exists in database for FK constraint
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        firstName: userId === "guest-noise-reporter" ? "Guest" : "User",
      },
    });

    // Record noise metric rating
    await prisma.venueRating.upsert({
      where: {
        userId_venueId: {
          userId,
          venueId: venue.id,
        },
      },
      update: {
        avgDecibels: decibels,
        peakDecibels,
        noiseLevel,
      },
      create: {
        userId,
        venueId: venue.id,
        wifiQuality: 3,
        hasOutlets: false,
        noiseLevel,
        avgDecibels: decibels,
        peakDecibels,
      },
    });

    // Update venue aggregate noiseLevel if applicable
    await prisma.venue.update({
      where: { id: venue.id },
      data: { noiseLevel },
    });

    // Re-fetch updated metrics to return live buckets
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

    const grouped: Record<BucketKey, { averages: number[]; peaks: number[] }> =
      {
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
              (averageValues.reduce((sum, val) => sum + val, 0) /
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

    return NextResponse.json(
      {
        success: true,
        venueId: venue.id,
        decibels,
        noiseLevel,
        buckets,
        totalSamples: ratings.length,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error submitting noise metric:", error);
    return NextResponse.json(
      { error: "Internal server error submitting noise metric" },
      { status: 500 },
    );
  }
}
