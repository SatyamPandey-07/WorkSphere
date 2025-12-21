import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// POST /api/venues/[venueId]/rate - Add rating
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ venueId: string }> }
) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { venueId } = await context.params;
    const body = await req.json();
    const { wifiQuality, hasOutlets, noiseLevel, comment, venue: venueData } = body;

    // Validate
    if (!wifiQuality || hasOutlets === undefined || !noiseLevel) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Check if venue exists, create if not (for Overpass API results)
    let venue = await prisma.venue.findUnique({
      where: { id: venueId },
    });

    if (!venue) {
      // Create venue from provided data or with defaults
      venue = await prisma.venue.create({
        data: {
          id: venueId,
          placeId: venueId,
          name: venueData?.name || "Unknown Venue",
          latitude: venueData?.lat || 0,
          longitude: venueData?.lng || 0,
          category: venueData?.category || "other",
          address: venueData?.address || null,
        },
      });
    }

    // Upsert rating (user can only have one rating per venue)
    const rating = await prisma.venueRating.upsert({
      where: {
        userId_venueId: {
          userId,
          venueId,
        },
      },
      update: {
        wifiQuality,
        hasOutlets,
        noiseLevel,
        comment,
      },
      create: {
        userId,
        venueId,
        wifiQuality,
        hasOutlets,
        noiseLevel,
        comment,
      },
    });

    // Update venue with new averages
    const allRatings = await prisma.venueRating.findMany({
      where: { venueId },
    });

    const avgWifi = allRatings.reduce((sum: number, r: { wifiQuality: number }) => sum + r.wifiQuality, 0) / allRatings.length;
    const outletPercent = (allRatings.filter((r: { hasOutlets: boolean }) => r.hasOutlets).length / allRatings.length) * 100;
    
    // Most common noise level
    const noiseCounts: Record<string, number> = {};
    allRatings.forEach((r: { noiseLevel: string }) => {
      noiseCounts[r.noiseLevel] = (noiseCounts[r.noiseLevel] || 0) + 1;
    });
    const dominantNoise = Object.entries(noiseCounts).reduce((a, b) => b[1] > a[1] ? b : a)[0];

    await prisma.venue.update({
      where: { id: venueId },
      data: {
        wifiQuality: Math.round(avgWifi),
        hasOutlets: outletPercent > 50,
        noiseLevel: dominantNoise,
        crowdsourced: true,
      },
    });

    return NextResponse.json({ rating }, { status: 201 });
  } catch (error) {
    console.error("POST /api/venues/[venueId]/rate error:", error);
    return NextResponse.json(
      { error: "Failed to submit rating" },
      { status: 500 }
    );
  }
}

// GET /api/venues/[venueId]/rate - Get user's rating
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ venueId: string }> }
) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { venueId } = await context.params;

    const rating = await prisma.venueRating.findUnique({
      where: {
        userId_venueId: {
          userId,
          venueId,
        },
      },
    });

    return NextResponse.json({ rating });
  } catch (error) {
    console.error("GET /api/venues/[venueId]/rate error:", error);
    return NextResponse.json(
      { error: "Failed to fetch rating" },
      { status: 500 }
    );
  }
}
