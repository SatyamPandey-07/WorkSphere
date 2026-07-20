import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { venueRatingSchema, validateRequest } from "@/lib/validations";
import { updateUserPreferencesSummary } from "@/lib/agents/MemoryAgent";

// POST /api/venues/[venueId]/rate - Add rating
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ venueId: string }> },
) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Ensure Identity 💎
    await ensureUserExists(userId);

    const { venueId } = await context.params;
    const body = await req.json();

    // Validate rating data with Zod
    const validation = validateRequest(venueRatingSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const {
      wifiQuality,
      hasOutlets,
      noiseLevel,
      avgDecibels,
      peakDecibels,
      comment,
      hasErgonomic,
      outletDensity,
      wifiSpeed,
      downloadSpeed,
      uploadSpeed,
      latency,
      crowdLevel,
      speedtestPhoto,
      hasPhoneBooths,
      hasNoMusic,
      hasQuietZone,
      lighting,
      musicStyle,
      powerTypes,
      outletLocations,
      petsAllowedIndoors,
      patioOnly,
      waterBowlsProvided,
      dogFriendly,
      catsAllowed,
    } = validation.data;
    const { venue: venueData } = body; // venue data for creating new venues

    const targetPlaceId = venueData?.placeId || venueId;

    // Helper function to safely upsert venue handling concurrent creation/updates
    async function executeVenueUpsert() {
      let retries = 0;
      while (retries < 3) {
        try {
          return await prisma.venue.upsert({
            where: { placeId: targetPlaceId },
            update: {
              name: venueData?.name || "Unknown Venue",
              address: venueData?.address || null,
              category: venueData?.category || "other",
            },
            create: {
              placeId: targetPlaceId,
              name: venueData?.name || "Unknown Venue",
              latitude: venueData?.lat || venueData?.latitude || 0,
              longitude: venueData?.lng || venueData?.longitude || 0,
              category: venueData?.category || "other",
              address: venueData?.address || null,
            },
          });
        } catch (err: any) {
          retries++;
          if (err?.code === "P2002" || err?.code === "P2034") {
            const existing = await prisma.venue.findFirst({
              where: {
                OR: [{ placeId: targetPlaceId }, { id: targetPlaceId }],
              },
            });
            if (existing) return existing;
            await new Promise((res) => setTimeout(res, 50 * retries));
          } else {
            throw err;
          }
        }
      }
      return await prisma.venue.findFirstOrThrow({
        where: { OR: [{ placeId: targetPlaceId }, { id: targetPlaceId }] },
      });
    }

    const dbVenue = await executeVenueUpsert();
    const finalVenueId = dbVenue.id;

    const ratingUpdatePayload = {
      wifiQuality,
      hasOutlets,
      noiseLevel,
      avgDecibels: avgDecibels || null,
      peakDecibels: peakDecibels || null,
      hasErgonomic,
      outletDensity,
      wifiSpeed,
      comment,
      speedtestPhoto,
      hasPhoneBooths,
      hasNoMusic,
      hasQuietZone,
      lighting,
      musicStyle,
      powerTypes: powerTypes || [],
      outletLocations: outletLocations || [],
      petsAllowedIndoors,
      patioOnly,
      waterBowlsProvided,
      dogFriendly,
      catsAllowed,
    };

    const ratingCreatePayload = {
      userId,
      venueId: finalVenueId,
      wifiQuality,
      hasOutlets,
      noiseLevel,
      avgDecibels: avgDecibels || null,
      peakDecibels: peakDecibels || null,
      hasErgonomic: hasErgonomic || false,
      outletDensity: outletDensity || "none",
      wifiSpeed: wifiSpeed || null,
      comment,
      speedtestPhoto,
      hasPhoneBooths: hasPhoneBooths || false,
      hasNoMusic: hasNoMusic || false,
      hasQuietZone: hasQuietZone || false,
      lighting: lighting || null,
      musicStyle,
      powerTypes: powerTypes || [],
      outletLocations: outletLocations || [],
      petsAllowedIndoors: petsAllowedIndoors || false,
      patioOnly: patioOnly || false,
      waterBowlsProvided: waterBowlsProvided || false,
      dogFriendly: dogFriendly || false,
      catsAllowed: catsAllowed || false,
    };

    // Helper function to safely upsert rating handling concurrent user review updates
    async function executeRatingUpsert() {
      let retries = 0;
      while (retries < 3) {
        try {
          return await prisma.venueRating.upsert({
            where: {
              userId_venueId: {
                userId,
                venueId: finalVenueId,
              },
            },
            update: ratingUpdatePayload,
            create: ratingCreatePayload,
          });
        } catch (err: any) {
          retries++;
          if (err?.code === "P2002" || err?.code === "P2034") {
            try {
              return await prisma.venueRating.update({
                where: {
                  userId_venueId: {
                    userId,
                    venueId: finalVenueId,
                  },
                },
                data: ratingUpdatePayload,
              });
            } catch {
              if (retries >= 3) throw err;
              await new Promise((res) => setTimeout(res, 50 * retries));
            }
          } else {
            throw err;
          }
        }
      }
      return await prisma.venueRating.findUniqueOrThrow({
        where: {
          userId_venueId: {
            userId,
            venueId: finalVenueId,
          },
        },
      });
    }

    const rating = await executeRatingUpsert();

    // Create WifiTelemetry entry if all speed/latency/crowd data is provided
    if (downloadSpeed && uploadSpeed && latency && crowdLevel) {
      await prisma.wifiTelemetry.create({
        data: {
          venueId: finalVenueId,
          download: downloadSpeed,
          upload: uploadSpeed,
          latency: latency,
          crowdLevel: crowdLevel,
        },
      });
    }

    // Update venue with new averages
    const allRatings = await prisma.venueRating.findMany({
      where: { venueId: finalVenueId },
    });

    const avgWifi =
      allRatings.reduce(
        (sum: number, r: { wifiQuality: number }) => sum + r.wifiQuality,
        0,
      ) / allRatings.length;
    const outletPercent =
      (allRatings.filter((r: { hasOutlets: boolean }) => r.hasOutlets).length /
        allRatings.length) *
      100;
    const ergonomicPercent =
      (allRatings.filter((r: any) => r.hasErgonomic).length /
        allRatings.length) *
      100;
    const phoneBoothsPercent =
      (allRatings.filter((r: any) => r.hasPhoneBooths).length /
        allRatings.length) *
      100;
    const noMusicPercent =
      (allRatings.filter((r: any) => r.hasNoMusic).length / allRatings.length) *
      100;
    const quietZonePercent =
      (allRatings.filter((r: any) => r.hasQuietZone).length /
        allRatings.length) *
      100;

    // Most common noise level
    const noiseCounts: Record<string, number> = {};
    allRatings.forEach((r: { noiseLevel: string }) => {
      noiseCounts[r.noiseLevel] = (noiseCounts[r.noiseLevel] || 0) + 1;
    });
    const dominantNoise = Object.entries(noiseCounts).reduce((a, b) =>
      b[1] > a[1] ? b : a,
    )[0];

    // Most common lighting
    const lightingCounts: Record<string, number> = {};
    allRatings.forEach((r: any) => {
      if (r.lighting) {
        lightingCounts[r.lighting] = (lightingCounts[r.lighting] || 0) + 1;
      }
    });
    const dominantLighting =
      Object.keys(lightingCounts).length > 0
        ? Object.entries(lightingCounts).reduce((a, b) =>
            b[1] > a[1] ? b : a,
          )[0]
        : null;

    // Most common outlet density
    const densityCounts: Record<string, number> = {};
    allRatings.forEach((r: any) => {
      if (r.outletDensity) {
        densityCounts[r.outletDensity] =
          (densityCounts[r.outletDensity] || 0) + 1;
      }
    });
    const dominantDensity =
      Object.keys(densityCounts).length > 0
        ? Object.entries(densityCounts).reduce((a, b) =>
            b[1] > a[1] ? b : a,
          )[0]
        : "none";

    // Aggregate power types (unique union of all powerTypes in all ratings)
    const aggregatedPowerTypes = Array.from(
      new Set(allRatings.flatMap((r: any) => r.powerTypes || [])),
    );

    // Aggregate outlet locations (unique union of all outletLocations in all ratings)
    const aggregatedOutletLocations = Array.from(
      new Set(allRatings.flatMap((r: any) => r.outletLocations || [])),
    );

    // Average wifi speed
    const validSpeeds = allRatings
      .filter((r: any) => r.wifiSpeed !== null && r.wifiSpeed > 0)
      .map((r: any) => r.wifiSpeed as number);
    const avgSpeed =
      validSpeeds.length > 0
        ? Math.round(
            validSpeeds.reduce((sum, s) => sum + s, 0) / validSpeeds.length,
          )
        : null;

    // Most common music style
    const musicCounts: Record<string, number> = {};
    allRatings.forEach((r: any) => {
      if (r.musicStyle) {
        musicCounts[r.musicStyle] = (musicCounts[r.musicStyle] || 0) + 1;
      }
    });
    const dominantMusic =
      Object.keys(musicCounts).length > 0
        ? Object.entries(musicCounts).reduce((a, b) => (b[1] > a[1] ? b : a))[0]
        : null;
    const petsAllowedIndoorsPercent =
      (allRatings.filter((r: any) => r.petsAllowedIndoors).length /
        allRatings.length) *
      100;
    const patioOnlyPercent =
      (allRatings.filter((r: any) => r.patioOnly).length / allRatings.length) *
      100;
    const waterBowlsPercent =
      (allRatings.filter((r: any) => r.waterBowlsProvided).length /
        allRatings.length) *
      100;
    const dogFriendlyPercent =
      (allRatings.filter((r: any) => r.dogFriendly).length /
        allRatings.length) *
      100;
    const catsAllowedPercent =
      (allRatings.filter((r: any) => r.catsAllowed).length /
        allRatings.length) *
      100;

    await prisma.venue.update({
      where: { id: finalVenueId },
      data: {
        wifiQuality: Math.round(avgWifi),
        hasOutlets: outletPercent > 50,
        noiseLevel: dominantNoise,
        hasErgonomic: ergonomicPercent > 50,
        outletDensity: dominantDensity,
        wifiSpeed: avgSpeed,
        hasPhoneBooths: phoneBoothsPercent > 50,
        hasNoMusic: noMusicPercent > 50,
        hasQuietZone: quietZonePercent > 50,
        lighting: dominantLighting,
        musicStyle: dominantMusic,
        powerTypes: aggregatedPowerTypes,
        outletLocations: aggregatedOutletLocations,
        petsAllowedIndoors: petsAllowedIndoorsPercent > 50,
        patioOnly: patioOnlyPercent > 50,
        waterBowlsProvided: waterBowlsPercent > 50,
        dogFriendly: dogFriendlyPercent > 50,
        catsAllowed: catsAllowedPercent > 50,
        crowdsourced: true,
      },
    });

    // Trigger background preference summary consolidation
    updateUserPreferencesSummary(userId).catch((err) =>
      console.error("[RateAPI] Background preference sync failed:", err),
    );

    return NextResponse.json({ rating }, { status: 201 });
  } catch (error) {
    console.error("POST /api/venues/[venueId]/rate error:", error);
    return NextResponse.json(
      { error: "Failed to submit rating" },
      { status: 500 },
    );
  }
}

// GET /api/venues/[venueId]/rate - Get user's rating
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ venueId: string }> },
) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { venueId } = await context.params;

    // Find the venue first to get our internal ID (venueId from URL might be a placeId)
    const venue = await prisma.venue.findFirst({
      where: {
        OR: [{ id: venueId }, { placeId: venueId }],
      },
      select: { id: true },
    });

    if (!venue) {
      return NextResponse.json({ rating: null });
    }

    const rating = await prisma.venueRating.findUnique({
      where: {
        userId_venueId: {
          userId,
          venueId: venue.id,
        },
      },
    });

    return NextResponse.json({ rating });
  } catch (error) {
    console.error("GET /api/venues/[venueId]/rate error:", error);
    return NextResponse.json(
      { error: "Failed to fetch rating" },
      { status: 500 },
    );
  }
}
