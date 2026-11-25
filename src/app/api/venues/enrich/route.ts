import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { searchAndEnrichVenues, getVenueDetails } from "@/lib/venues";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";

const MAX_VENUE_NAME_LENGTH = 200;
const MAX_VENUE_ID_LENGTH = 128;
const MAX_BULK_ENRICH_VENUES = 10;
const STRICT_NUMBER_REGEX = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function parseQueryCoordinate(value: string): number {
  const trimmed = value.trim();
  if (!trimmed || !STRICT_NUMBER_REGEX.test(trimmed)) {
    return Number.NaN;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return Number.NaN;
  }
  return Object.is(parsed, -0) ? 0 : parsed;
}

const venueNameSchema = z
  .string({ message: "name must be a non-empty string" })
  .trim()
  .min(1, "name must be a non-empty string")
  .max(
    MAX_VENUE_NAME_LENGTH,
    `name must be ${MAX_VENUE_NAME_LENGTH} characters or less`,
  );

const latitudeSchema = z
  .number({ message: "lat must be a finite number" })
  .finite("lat must be a finite number")
  .min(-90, "lat must be between -90 and 90")
  .max(90, "lat must be between -90 and 90");

const longitudeSchema = z
  .number({ message: "lng must be a finite number" })
  .finite("lng must be a finite number")
  .min(-180, "lng must be between -180 and 180")
  .max(180, "lng must be between -180 and 180");

const venueIdSchema = z
  .string()
  .trim()
  .min(1, "venueId must be a non-empty string")
  .max(
    MAX_VENUE_ID_LENGTH,
    `venueId must be ${MAX_VENUE_ID_LENGTH} characters or less`,
  );

const enrichQuerySchema = z.object({
  name: venueNameSchema,
  lat: z
    .string({ message: "lat is required" })
    .trim()
    .min(1, "lat is required")
    .transform((val) => parseQueryCoordinate(val))
    .pipe(latitudeSchema),
  lng: z
    .string({ message: "lng is required" })
    .trim()
    .min(1, "lng is required")
    .transform((val) => parseQueryCoordinate(val))
    .pipe(longitudeSchema),
});

const bulkVenueItemSchema = z
  .object({
    name: venueNameSchema,
    lat: latitudeSchema,
    lng: longitudeSchema,
  })
  .passthrough();

const bulkEnrichBodySchema = z.object({
  venues: z
    .array(bulkVenueItemSchema, { message: "venues array is required" })
    .min(1, "venues must contain at least one venue")
    .max(
      MAX_BULK_ENRICH_VENUES,
      `Maximum ${MAX_BULK_ENRICH_VENUES} venues allowed per request`,
    ),
});

function formatValidationErrors(issues: z.ZodIssue[]) {
  const details = issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "request",
    message: issue.message,
  }));
  return {
    error: details.map((d) => `${d.field}: ${d.message}`).join("; "),
    details,
  };
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "anonymous"
  );
}

/**
 * Applies an IP-keyed rate limit and returns a 429 response when exceeded,
 * otherwise null. The endpoint is public, so it is throttled to protect the
 * upstream geocoding/photo services from abuse.
 */
async function enforceRateLimit(
  identifier: string,
  limit: number,
): Promise<NextResponse | null> {
  if (await rateLimit(identifier, limit)) return null;

  const info = await getRateLimitInfo(identifier, limit);
  const retryAfter = info?.resetTime
    ? Math.ceil((info.resetTime - Date.now()) / 1000)
    : 60;
  return NextResponse.json(
    {
      error: "Too many enrichment requests. Please try again later.",
      retryAfter,
    },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

/**
 * GET /api/venues/enrich - Enrich venue with OSM + Unsplash data (FREE, no card)
 * Query params:
 *   - name: venue name to search
 *   - lat, lng: coordinates to find nearby match
 *   - venueId: direct OSM ID (if known)
 */
export async function GET(req: NextRequest) {
  try {
    const limited = await enforceRateLimit(
      `venues-enrich:${clientIp(req)}`,
      30,
    );
    if (limited) return limited;

    const { searchParams } = new URL(req.url);
    const rawName = searchParams.get("name");
    const rawLat = searchParams.get("lat");
    const rawLng = searchParams.get("lng");
    const rawVenueId = searchParams.get("venueId") ?? searchParams.get("fsqId");
    const trimmedVenueId = rawVenueId?.trim() ?? "";

    // If we have venue ID, validate length and get details directly
    if (trimmedVenueId.length > 0) {
      const parsedVenueId = venueIdSchema.safeParse(trimmedVenueId);
      if (!parsedVenueId.success) {
        return NextResponse.json(
          formatValidationErrors(parsedVenueId.error.issues),
          { status: 400 },
        );
      }

      const details = await getVenueDetails(parsedVenueId.data);

      if (!details) {
        return NextResponse.json({ error: "Venue not found" }, { status: 404 });
      }

      return NextResponse.json({
        venueId: details.id,
        fsqId: details.id, // Backward compat
        name: details.name,
        photos: details.photos,
        website: details.website,
        phone: details.phone,
        address: details.location?.formatted_address,
        amenities: details.amenities,
        opening_hours: details.opening_hours,
        categories: details.categories.map((c) => c.name),
      });
    }

    // Validate name and geographic coordinates before any external lookup
    const parsedQuery = enrichQuerySchema.safeParse({
      name: rawName,
      lat: rawLat,
      lng: rawLng,
    });

    if (!parsedQuery.success) {
      return NextResponse.json(
        formatValidationErrors(parsedQuery.error.issues),
        { status: 400 },
      );
    }

    const { name, lat, lng } = parsedQuery.data;

    // Search for matching venue using OSM + Unsplash
    console.log("[Enrich] Searching for:", { name, lat, lng });
    const venues = await searchAndEnrichVenues(lat, lng, {
      query: name === "cafe" ? undefined : name, // Don't filter by 'cafe' since we already search cafes
      radius: 2000, // 2km radius
      limit: 10,
    });
    console.log("[Enrich] Found venues:", venues.length);

    if (venues.length === 0) {
      console.log("[Enrich] No venues found, returning fallback");
      // Return fallback photos even if no venue found
      const fallbackPhotos = [
        `https://picsum.photos/seed/cafe-workspace/800/600`,
        `https://picsum.photos/seed/coffee-laptop/800/600`,
      ];
      return NextResponse.json({
        found: false,
        photos: fallbackPhotos, // Still provide photos for UI
      });
    }

    // Find best match by name similarity
    const lowerName = name.toLowerCase();
    const bestMatch =
      venues.find(
        (v) =>
          v.name.toLowerCase().includes(lowerName) ||
          lowerName.includes(v.name.toLowerCase()),
      ) || venues[0];

    return NextResponse.json({
      found: true,
      venueId: bestMatch.id,
      fsqId: bestMatch.id, // Backward compat
      name: bestMatch.name,
      distance: bestMatch.distance,
      address: bestMatch.location?.formatted_address,
      categories: bestMatch.categories?.map((c) => c.name),
      photos: bestMatch.photos,
      amenities: bestMatch.amenities,
      opening_hours: bestMatch.opening_hours,
      website: bestMatch.website,
      phone: bestMatch.phone,
    });
  } catch (error) {
    console.error("Venue enrich error:", error);
    return NextResponse.json(
      { error: "Failed to enrich venue" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/venues/enrich - Bulk enrich multiple venues
 */
export async function POST(req: NextRequest) {
  try {
    const limited = await enforceRateLimit(
      `venues-enrich-bulk:${clientIp(req)}`,
      10,
    );
    if (limited) return limited;

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request body" },
        { status: 400 },
      );
    }

    const parsedBody = bulkEnrichBodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return NextResponse.json(
        formatValidationErrors(parsedBody.error.issues),
        { status: 400 },
      );
    }

    const { venues } = parsedBody.data;

    const enrichedVenues = await Promise.all(
      venues.map(async (venue) => {
        const results = await searchAndEnrichVenues(venue.lat, venue.lng, {
          query: venue.name,
          radius: 300,
          limit: 1,
        });

        if (results.length === 0) {
          // Still return fallback photos
          return {
            ...venue,
            enriched: false,
            photos: [`https://picsum.photos/seed/workspace/800/600`],
          };
        }

        const match = results[0];
        return {
          ...venue,
          enriched: true,
          venueId: match.id,
          fsqId: match.id,
          photos: match.photos,
          amenities: match.amenities,
          opening_hours: match.opening_hours,
        };
      }),
    );

    return NextResponse.json({ venues: enrichedVenues });
  } catch (error) {
    console.error("Bulk enrich error:", error);
    return NextResponse.json(
      { error: "Failed to bulk enrich venues" },
      { status: 500 },
    );
  }
}
