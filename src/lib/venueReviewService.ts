import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { venueRatingSchema, validateRequest } from "@/lib/validations";
import { updateUserPreferencesSummary } from "@/lib/agents/MemoryAgent";
import { enqueueTelemetry } from "@/lib/telemetryQueue";
import { resolveVenue } from "@/lib/venueResolver";
import { emitWebhookEvent } from "@/lib/webhooks/deliver";
import { getRedis } from "@/lib/redis";

// In-memory fallback for idempotency tracking (when Redis is unavailable or in dev/tests)
const idempotencyCache = new Map<string, { ratingId: string; expiresAt: number }>();

// In-flight mutex promise map to serialize concurrent requests with the identical idempotency key
const inFlightRequests = new Map<string, Promise<ReviewSubmissionResult>>();

export async function getIdempotencyRecord(key: string): Promise<string | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const val = await redis.get(key);
      if (val) return String(val);
    } catch {
      // fallback to in-memory
    }
  }
  const entry = idempotencyCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.ratingId;
  }
  return null;
}

export async function setIdempotencyRecord(
  key: string,
  ratingId: string,
  ttlSeconds: number = 86400,
): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(key, ratingId, { ex: ttlSeconds });
      return;
    } catch {
      // fallback to in-memory
    }
  }
  idempotencyCache.set(key, {
    ratingId,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

export interface ReviewSubmissionParams {
  userId: string;
  venueId: string;
  body: any;
  idempotencyKey?: string | null;
  forceOverwrite?: boolean;
}

export interface ReviewSubmissionResult {
  status: number;
  data?: any;
  error?: string;
  conflictType?: "REVIEW_MODIFIED" | "VENUE_MODIFIED";
  serverReview?: any;
  serverVenue?: any;
  message?: string;
}

export async function processVenueReviewSubmission({
  userId,
  venueId,
  body,
  idempotencyKey,
  forceOverwrite = false,
}: ReviewSubmissionParams): Promise<ReviewSubmissionResult> {
  const effectiveIdempotencyKey =
    idempotencyKey || body?.idempotencyKey || body?.id || null;
  const isForceOverwrite = Boolean(
    forceOverwrite || body?.forceOverwrite === true,
  );

  // 1. Concurrent in-flight request deduplication
  if (effectiveIdempotencyKey) {
    const inFlightKey = `${userId}:${effectiveIdempotencyKey}`;
    const activePromise = inFlightRequests.get(inFlightKey);
    if (activePromise) {
      return await activePromise;
    }

    const runnerPromise = (async () => {
      const cacheKey = `worksphere:idempotency:review:${userId}:${effectiveIdempotencyKey}`;
      const cachedRatingId = await getIdempotencyRecord(cacheKey);
      if (cachedRatingId) {
        const existingRating = await prisma.venueRating.findUnique({
          where: { id: cachedRatingId },
        });
        if (existingRating) {
          return {
            status: 200,
            data: { rating: existingRating, idempotent: true },
          };
        }
      }

      return await executeReviewSubmission({
        userId,
        venueId,
        body,
        effectiveIdempotencyKey,
        isForceOverwrite,
      });
    })();

    inFlightRequests.set(inFlightKey, runnerPromise);
    try {
      return await runnerPromise;
    } finally {
      inFlightRequests.delete(inFlightKey);
    }
  }

  return await executeReviewSubmission({
    userId,
    venueId,
    body,
    effectiveIdempotencyKey: null,
    isForceOverwrite,
  });
}

async function executeReviewSubmission({
  userId,
  venueId,
  body,
  effectiveIdempotencyKey,
  isForceOverwrite,
}: {
  userId: string;
  venueId: string;
  body: any;
  effectiveIdempotencyKey: string | null;
  isForceOverwrite: boolean;
}): Promise<ReviewSubmissionResult> {
  // 2. Validate rating payload
  const validation = validateRequest(venueRatingSchema, body);
  if (!validation.success) {
    return {
      status: 400,
      error: validation.error,
    };
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
  const {
    venue: venueData,
    baseReviewUpdatedAt,
    baseVenueUpdatedAt,
    baseReview,
  } = body || {};

  // 3. Resolve target venue
  const dbVenue = await resolveVenue({
    id: venueId,
    placeId: venueData?.placeId,
    name: venueData?.name,
    address: venueData?.address,
    category: venueData?.category,
    lat: venueData?.lat,
    lng: venueData?.lng,
    latitude: venueData?.latitude,
    longitude: venueData?.longitude,
  });

  if (!dbVenue) {
    return {
      status: 404,
      error: "Venue not found. Search for it again and retry.",
    };
  }
  const finalVenueId = dbVenue.id;

  // 4. Conflict detection
  const existingRating = await prisma.venueRating.findUnique({
    where: {
      userId_venueId: {
        userId,
        venueId: finalVenueId,
      },
    },
  });

  if (!isForceOverwrite) {
    // 4a. Base review snapshot comparison (detects field modifications on server regardless of schema updatedAt)
    if (existingRating && baseReview && typeof baseReview === "object") {
      const isModified =
        (baseReview.wifiQuality !== undefined &&
          existingRating.wifiQuality !== baseReview.wifiQuality) ||
        (baseReview.hasOutlets !== undefined &&
          existingRating.hasOutlets !== baseReview.hasOutlets) ||
        (baseReview.noiseLevel !== undefined &&
          existingRating.noiseLevel !== baseReview.noiseLevel) ||
        (baseReview.comment !== undefined &&
          (existingRating.comment || "") !== (baseReview.comment || ""));

      if (isModified) {
        return {
          status: 409,
          error: "Conflict",
          conflictType: "REVIEW_MODIFIED",
          serverReview: existingRating,
          serverVenue: {
            id: dbVenue.id,
            name: dbVenue.name,
            updatedAt: dbVenue.updatedAt,
          },
          message:
            "Review on server has been modified since it was loaded offline.",
        };
      }
    }

    // 4b. Base review timestamp check (detects new review created concurrently on another device)
    if (existingRating && baseReviewUpdatedAt) {
      const clientReviewTime = new Date(baseReviewUpdatedAt).getTime();
      const serverReviewTime = new Date(existingRating.createdAt).getTime();
      if (serverReviewTime > clientReviewTime) {
        return {
          status: 409,
          error: "Conflict",
          conflictType: "REVIEW_MODIFIED",
          serverReview: existingRating,
          serverVenue: {
            id: dbVenue.id,
            name: dbVenue.name,
            updatedAt: dbVenue.updatedAt,
          },
          message:
            "Review on server was created or updated since base review timestamp.",
        };
      }
    }

    // 4c. Venue state timestamp check
    if (baseVenueUpdatedAt) {
      const clientVenueTime = new Date(baseVenueUpdatedAt).getTime();
      const serverVenueTime = new Date(dbVenue.updatedAt).getTime();
      if (serverVenueTime > clientVenueTime) {
        return {
          status: 409,
          error: "Conflict",
          conflictType: "VENUE_MODIFIED",
          serverReview: existingRating,
          serverVenue: {
            id: dbVenue.id,
            name: dbVenue.name,
            updatedAt: dbVenue.updatedAt,
          },
          message:
            "Venue details on server were modified since it was loaded offline.",
        };
      }
    }
  }

  // 5. Construct payloads (strictly scoped to VenueRating schema fields)
  const ratingUpdatePayload = {
    wifiQuality,
    hasOutlets,
    noiseLevel,
    avgDecibels: avgDecibels || null,
    peakDecibels: peakDecibels || null,
    hasErgonomic,
    outletDensity,
    wifiSpeed,
    downloadMbps:
      downloadSpeed !== undefined && downloadSpeed !== null
        ? Number(downloadSpeed)
        : null,
    uploadMbps:
      uploadSpeed !== undefined && uploadSpeed !== null
        ? Number(uploadSpeed)
        : null,
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
    downloadMbps:
      downloadSpeed !== undefined && downloadSpeed !== null
        ? Number(downloadSpeed)
        : null,
    uploadMbps:
      uploadSpeed !== undefined && uploadSpeed !== null
        ? Number(uploadSpeed)
        : null,
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

  // 6. Safe upsert with retry handling
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

  // 7. Telemetry ingestion if performance metrics present
  if (downloadSpeed && uploadSpeed && latency && crowdLevel) {
    await enqueueTelemetry({
      venueId: finalVenueId,
      download: downloadSpeed,
      upload: uploadSpeed,
      latency: latency,
      crowdLevel: crowdLevel,
      timestamp: new Date().toISOString(),
    });
  }

  // 8. Run aggregate calculation & user preference summaries
  const runAfter = async () => {
    try {
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
        (allRatings.filter((r: any) => r.hasNoMusic).length /
          allRatings.length) *
        100;
      const quietZonePercent =
        (allRatings.filter((r: any) => r.hasQuietZone).length /
          allRatings.length) *
        100;

      const noiseCounts: Record<string, number> = {};
      allRatings.forEach((r: { noiseLevel: string }) => {
        noiseCounts[r.noiseLevel] = (noiseCounts[r.noiseLevel] || 0) + 1;
      });
      const dominantNoise =
        Object.keys(noiseCounts).length > 0
          ? Object.entries(noiseCounts).reduce(
              (a: [string, number], b: [string, number]) =>
                b[1] > a[1] ? b : a,
            )[0]
          : null;

      const lightingCounts: Record<string, number> = {};
      allRatings.forEach((r: any) => {
        if (r.lighting) {
          lightingCounts[r.lighting] = (lightingCounts[r.lighting] || 0) + 1;
        }
      });
      const dominantLighting =
        Object.keys(lightingCounts).length > 0
          ? Object.entries(lightingCounts).reduce(
              (a: [string, number], b: [string, number]) =>
                b[1] > a[1] ? b : a,
            )[0]
          : null;

      const densityCounts: Record<string, number> = {};
      allRatings.forEach((r: any) => {
        if (r.outletDensity) {
          densityCounts[r.outletDensity] =
            (densityCounts[r.outletDensity] || 0) + 1;
        }
      });
      const dominantDensity =
        Object.keys(densityCounts).length > 0
          ? Object.entries(densityCounts).reduce(
              (a: [string, number], b: [string, number]) =>
                b[1] > a[1] ? b : a,
            )[0]
          : "none";

      const aggregatedPowerTypes = Array.from(
        new Set(allRatings.flatMap((r: any) => r.powerTypes || [])),
      );
      const aggregatedOutletLocations = Array.from(
        new Set(allRatings.flatMap((r: any) => r.outletLocations || [])),
      );

      const validSpeeds = allRatings
        .filter((r: any) => r.wifiSpeed !== null && r.wifiSpeed > 0)
        .map((r: any) => r.wifiSpeed as number);
      const avgSpeed =
        validSpeeds.length > 0
          ? Math.round(
              validSpeeds.reduce((sum: number, s: number) => sum + s, 0) /
                validSpeeds.length,
            )
          : null;

      const musicCounts: Record<string, number> = {};
      allRatings.forEach((r: any) => {
        if (r.musicStyle) {
          musicCounts[r.musicStyle] = (musicCounts[r.musicStyle] || 0) + 1;
        }
      });
      const dominantMusic =
        Object.keys(musicCounts).length > 0
          ? Object.entries(musicCounts).reduce(
              (a: [string, number], b: [string, number]) =>
                b[1] > a[1] ? b : a,
            )[0]
          : null;

      const petsAllowedIndoorsPercent =
        (allRatings.filter((r: any) => r.petsAllowedIndoors).length /
          allRatings.length) *
        100;
      const patioOnlyPercent =
        (allRatings.filter((r: any) => r.patioOnly).length /
          allRatings.length) *
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

      await updateUserPreferencesSummary(userId);
    } catch (err) {
      console.error("[venueReviewService] Background aggregation failed:", err);
    }
  };

  try {
    after(runAfter);
  } catch {
    await runAfter();
  }

  // 9. Webhook event dispatch
  emitWebhookEvent(userId, "REVIEW_SUBMITTED", {
    venueId: finalVenueId,
    venueName: dbVenue.name,
    ratingId: rating.id,
    wifiQuality: rating.wifiQuality,
    noiseLevel: rating.noiseLevel,
    hasOutlets: rating.hasOutlets,
    comment: rating.comment,
  });

  // 10. Record idempotency key for 24h
  if (effectiveIdempotencyKey) {
    const cacheKey = `worksphere:idempotency:review:${userId}:${effectiveIdempotencyKey}`;
    await setIdempotencyRecord(cacheKey, rating.id, 86400);
  }

  return {
    status: 201,
    data: { rating, venue: dbVenue },
  };
}
