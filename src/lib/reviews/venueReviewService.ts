/**
 * Venue Review Application Service.
 *
 * Orchestrates venue review submissions, idempotency locking, content moderation,
 * data repository operations, rating aggregations, telemetry, and webhooks.
 */

import { after } from "next/server";
import { venueRatingSchema, validateRequest } from "@/lib/validations";
import { updateUserPreferencesSummary } from "@/lib/agents/MemoryAgent";
import { enqueueTelemetry } from "@/lib/telemetryQueue";
import { resolveVenue } from "@/lib/venueResolver";
import { emitWebhookEvent } from "@/lib/webhooks/deliver";
import { getRedis } from "@/lib/redis";
import {
  ReviewSubmissionParams,
  ReviewSubmissionResult,
} from "./types";
import {
  VenueReviewRepository,
  defaultVenueReviewRepository,
} from "./venueReviewRepository";
import {
  ReviewModerator,
  defaultReviewModerator,
} from "./reviewModerator";
import {
  RatingAggregator,
  defaultRatingAggregator,
} from "./ratingAggregator";

// In-memory fallback for idempotency tracking
const idempotencyCache = new Map<string, { ratingId: string; expiresAt: number }>();

// In-flight mutex promise map to serialize concurrent requests with identical idempotency key
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

export class VenueReviewService {
  constructor(
    private repository: VenueReviewRepository = defaultVenueReviewRepository,
    private moderator: ReviewModerator = defaultReviewModerator,
    private aggregator: RatingAggregator = defaultRatingAggregator,
  ) {}

  /**
   * Main entrypoint for processing review submissions with idempotency and concurrency controls.
   */
  public async submitReview(
    params: ReviewSubmissionParams,
  ): Promise<ReviewSubmissionResult> {
    const {
      userId,
      venueId,
      body,
      idempotencyKey,
      forceOverwrite = false,
    } = params;

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
          const existingRating =
            await this.repository.findRatingById(cachedRatingId);
          if (existingRating) {
            return {
              status: 200,
              data: { rating: existingRating, idempotent: true },
            };
          }
        }

        return await this.executeSubmission({
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

    return await this.executeSubmission({
      userId,
      venueId,
      body,
      effectiveIdempotencyKey: null,
      isForceOverwrite,
    });
  }

  /**
   * Internal submission execution orchestrating validation, moderation, repository upsert, and aggregates.
   */
  private async executeSubmission({
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
      baseReviewUpdatedAt: rawBaseReviewUpdatedAt,
      baseVenueUpdatedAt,
      baseReview,
      baseVersion,
      baseVersionTimestamp,
    } = body || {};

    const baseReviewUpdatedAt =
      rawBaseReviewUpdatedAt || baseVersionTimestamp || baseVersion;

    // 3. Moderate comment content
    const moderation = this.moderator.moderateComment(comment);
    const finalComment = moderation.sanitizedComment ?? comment;

    // 4. Resolve target venue
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

    // 5. Conflict detection
    const existingRating = await this.repository.findUserVenueRating(
      userId,
      finalVenueId,
    );

    if (!isForceOverwrite) {
      // 5a. Base review snapshot comparison
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

      // 5b. Base review timestamp check
      if (existingRating && baseReviewUpdatedAt) {
        const clientReviewTime = new Date(baseReviewUpdatedAt).getTime();
        const serverReviewTime = new Date(
          existingRating.updatedAt ?? existingRating.createdAt,
        ).getTime();
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

      // 5c. Venue state timestamp check
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

    // 6. Construct payloads
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
      comment: finalComment,
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
      comment: finalComment,
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

    // 7. Upsert rating record via repository
    const rating = await this.repository.upsertRating({
      userId,
      venueId: finalVenueId,
      update: ratingUpdatePayload,
      create: ratingCreatePayload,
    });

    // 8. Telemetry ingestion if performance metrics present
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

    // 9. Run aggregate calculation & user preference summaries
    const runAfter = async () => {
      try {
        await this.runAggregations(finalVenueId, userId);
      } catch (err) {
        console.error(
          "[venueReviewService] Background aggregation failed:",
          err,
        );
      }
    };

    try {
      after(runAfter);
    } catch {
      await runAfter();
    }

    // 10. Webhook event dispatch
    emitWebhookEvent(userId, "REVIEW_SUBMITTED", {
      venueId: finalVenueId,
      venueName: dbVenue.name,
      ratingId: rating.id,
      wifiQuality: rating.wifiQuality,
      noiseLevel: rating.noiseLevel,
      hasOutlets: rating.hasOutlets,
      comment: rating.comment,
    });

    // 11. Record idempotency key for 24h
    if (effectiveIdempotencyKey) {
      const cacheKey = `worksphere:idempotency:review:${userId}:${effectiveIdempotencyKey}`;
      await setIdempotencyRecord(cacheKey, rating.id, 86400);
    }

    return {
      status: 201,
      data: { rating, venue: dbVenue },
    };
  }

  /**
   * Orchestrates rating aggregation and updates the target venue record.
   */
  public async runAggregations(
    venueId: string,
    userId?: string,
  ): Promise<void> {
    const allRatings = await this.repository.findVenueRatings(venueId);
    const summary = this.aggregator.calculateAggregates(allRatings);

    await this.repository.updateVenueAggregates(venueId, {
      wifiQuality: summary.wifiQuality,
      hasOutlets: summary.hasOutlets,
      noiseLevel: summary.noiseLevel,
      hasErgonomic: summary.hasErgonomic,
      outletDensity: summary.outletDensity,
      wifiSpeed: summary.wifiSpeed,
      hasPhoneBooths: summary.hasPhoneBooths,
      hasNoMusic: summary.hasNoMusic,
      hasQuietZone: summary.hasQuietZone,
      lighting: summary.lighting,
      musicStyle: summary.musicStyle,
      powerTypes: summary.powerTypes,
      outletLocations: summary.outletLocations,
      petsAllowedIndoors: summary.petsAllowedIndoors,
      patioOnly: summary.patioOnly,
      waterBowlsProvided: summary.waterBowlsProvided,
      dogFriendly: summary.dogFriendly,
      catsAllowed: summary.catsAllowed,
      crowdsourced: summary.crowdsourced,
    });

    if (userId) {
      await updateUserPreferencesSummary(userId);
    }
  }

  /**
   * Fetches reviews for a venue.
   */
  public async getVenueReviews(venueId: string, userId?: string | null) {
    const venue = await this.repository.findVenue(venueId);
    if (!venue) {
      return { reviews: [] };
    }

    const reviews = await this.repository.findVenueRatings(venue.id, {
      includeUser: true,
    });

    return {
      reviews: reviews.map((r: any) => ({
        ...r,
        user: userId
          ? { firstName: r.user?.firstName, lastName: r.user?.lastName }
          : null,
      })),
    };
  }
}

export const globalVenueReviewService = new VenueReviewService();

/**
 * Functional bridge helper for processVenueReviewSubmission.
 */
export async function processVenueReviewSubmission(
  params: ReviewSubmissionParams,
): Promise<ReviewSubmissionResult> {
  return globalVenueReviewService.submitReview(params);
}
