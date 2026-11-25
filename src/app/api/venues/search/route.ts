import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  getLatestVenueTimestamp,
  generateETag,
  BoundingBox,
} from "@/lib/cache/venueCache";
import { searchVenuesPhonetic } from "@/lib/search/phoneticVenueSearch";
import { getFuzzyThreshold, isFuzzyMatch } from "@/lib/search/fuzzySearch";
import { isAbortError } from "@/lib/search/semanticSearchClient";
import {
  searchVenuesNearby,
  DEFAULT_SEARCH_RADIUS_METERS,
  MAX_SEARCH_RADIUS_METERS,
  MAX_SPATIAL_RESULT_LIMIT,
} from "@/lib/search/spatialVenueSearch";

const PUBLIC_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";
const BYPASS_CACHE_CONTROL =
  "private, no-cache, no-store, max-age=0, must-revalidate";
const VARY_HEADER = "Accept-Encoding, Accept";

export const dynamic = "force-dynamic";

/** Cookies that make a search result personal to the requester's location (#7412). */
const LOCATION_COOKIE_NAMES = [
  "user_location",
  "user-location",
  "location",
  "geo_location",
  "geolocation",
  "user_lat",
  "user_lng",
  "lat",
  "lng",
  "coordinates",
  "coords",
  "user_coordinates",
  "user-coordinates",
  "user_city",
  "user-city",
];

function isLocationCookie(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return (
    LOCATION_COOKIE_NAMES.includes(lower) ||
    lower.includes("location") ||
    lower.includes("geo") ||
    lower.includes("coord")
  );
}

/**
 * Whether the response must not be cached publicly: the request is
 * authenticated (Authorization header or Clerk session cookies), carries
 * personalized location cookies, or asks for a fresh response.
 */
export function shouldBypassCache(request: NextRequest): boolean {
  if (request.headers.get("authorization")?.trim()) return true;

  const cookieNames = (request.headers.get("cookie") || "")
    .split(";")
    .map((pair) => pair.split("=")[0].trim())
    .filter(Boolean);
  if (
    cookieNames.some(
      (name) => name === "__session" || name.startsWith("__client_uat"),
    )
  ) {
    return true;
  }
  if (cookieNames.some(isLocationCookie)) return true;

  const cacheControl = request.headers.get("cache-control") || "";
  if (cacheControl.includes("no-cache") || cacheControl.includes("no-store")) {
    return true;
  }
  return false;
}

function parseLimit(raw: string | null, fallback: number = 20): number {
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

interface ParsedSpatial {
  lat?: number;
  lng?: number;
  radiusMeters: number;
  error?: string;
}

function parseSpatialParams(searchParams: URLSearchParams): ParsedSpatial {
  const latStr = searchParams.get("lat");
  const lngStr = searchParams.get("lng");
  const radiusKmStr = searchParams.get("radiusKm");
  const radiusMetersStr = searchParams.get("radiusMeters");

  if (latStr === null && lngStr === null) {
    return { radiusMeters: DEFAULT_SEARCH_RADIUS_METERS };
  }

  if (latStr === null || lngStr === null) {
    return {
      radiusMeters: DEFAULT_SEARCH_RADIUS_METERS,
      error: "'lat' and 'lng' are required together for spatial search",
    };
  }

  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return {
      radiusMeters: DEFAULT_SEARCH_RADIUS_METERS,
      error: "'lat' must be a valid latitude between -90 and 90",
    };
  }

  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return {
      radiusMeters: DEFAULT_SEARCH_RADIUS_METERS,
      error: "'lng' must be a valid longitude between -180 and 180",
    };
  }

  let radiusMeters = DEFAULT_SEARCH_RADIUS_METERS;
  const radiusStr = radiusKmStr !== null ? radiusKmStr : radiusMetersStr;
  const radiusMultiplier = radiusKmStr !== null ? 1000 : 1;
  if (radiusStr !== null) {
    const parsed = parseFloat(radiusStr) * radiusMultiplier;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return {
        radiusMeters: DEFAULT_SEARCH_RADIUS_METERS,
        error: "'radiusMeters' must be a positive number",
      };
    }
    if (parsed > MAX_SEARCH_RADIUS_METERS) {
      return {
        radiusMeters: DEFAULT_SEARCH_RADIUS_METERS,
        error: `'radiusMeters' must not exceed ${MAX_SEARCH_RADIUS_METERS}`,
      };
    }
    radiusMeters = parsed;
  }

  return { lat, lng, radiusMeters };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const q = searchParams.get("q");
    const id = searchParams.get("id");

    const bbox: BoundingBox = {
      minLat: parseFloat(searchParams.get("minLat") || "0"),
      maxLat: parseFloat(searchParams.get("maxLat") || "0"),
      minLng: parseFloat(searchParams.get("minLng") || "0"),
      maxLng: parseFloat(searchParams.get("maxLng") || "0"),
    };

    const bypassCache = shouldBypassCache(request);

    // 1. Get latest venue timestamp for ETag generation
    const latestTimestamp = await getLatestVenueTimestamp(bbox);
    const etag = generateETag(latestTimestamp);

    // 2. Check If-None-Match header for conditional GET request (304 Not Modified)
    if (!bypassCache) {
      const ifNoneMatch = request.headers.get("if-none-match");
      if (ifNoneMatch && ifNoneMatch === etag) {
        return new NextResponse(null, {
          status: 304,
          headers: {
            "Cache-Control": PUBLIC_CACHE_CONTROL,
            ETag: etag,
            Vary: VARY_HEADER,
          },
        });
      }
    }

    const responseHeaders: Record<string, string> = {
      "Cache-Control": bypassCache
        ? BYPASS_CACHE_CONTROL
        : PUBLIC_CACHE_CONTROL,
      Vary: VARY_HEADER,
    };
    if (!bypassCache && etag) {
      responseHeaders.ETag = etag;
    }

    // 3. Geospatial proximity search (PostGIS ST_DWithin + GiST index)
    const spatial = parseSpatialParams(searchParams);
    if (spatial.error) {
      return NextResponse.json(
        { success: false, error: spatial.error },
        {
          status: 400,
          headers: {
            "Cache-Control": BYPASS_CACHE_CONTROL,
            Vary: VARY_HEADER,
          },
        },
      );
    }

    let venues: Record<string, unknown>[] = [];
    let suggestedQuery: string | undefined;

    if (spatial.lat !== undefined && spatial.lng !== undefined) {
      const limit = Math.min(
        parseLimit(searchParams.get("limit"), 20),
        MAX_SPATIAL_RESULT_LIMIT,
      );
      venues = (await searchVenuesNearby({
        latitude: spatial.lat,
        longitude: spatial.lng,
        radiusMeters: spatial.radiusMeters,
        limit,
      })) as unknown as Record<string, unknown>[];
    } else if (q) {
      const limit = Math.min(
        parseLimit(searchParams.get("limit"), 20),
        MAX_SPATIAL_RESULT_LIMIT,
      );
      try {
        const phoneticResults = await searchVenuesPhonetic(q, limit);
        if (phoneticResults && Array.isArray(phoneticResults)) {
          venues = phoneticResults as unknown as Record<string, unknown>[];

          const normalizedQuery = q.trim().toLocaleLowerCase();
          const exactMatchExists = phoneticResults.some((venue) =>
            venue.name.toLocaleLowerCase().includes(normalizedQuery),
          );
          const threshold = getFuzzyThreshold(normalizedQuery.length);
          if (!exactMatchExists && threshold > 0) {
            suggestedQuery = phoneticResults
              .map((venue) => {
                const match = isFuzzyMatch(
                  normalizedQuery,
                  venue.name,
                  threshold,
                );
                return match.matched && match.distance > 0
                  ? {
                      name: venue.name,
                      distance: match.distance,
                      score: venue.score,
                    }
                  : null;
              })
              .filter(
                (
                  candidate,
                ): candidate is {
                  name: string;
                  distance: number;
                  score: number;
                } => candidate !== null,
              )
              .sort(
                (a, b) =>
                  a.distance - b.distance ||
                  b.score - a.score ||
                  a.name.localeCompare(b.name),
              )[0]?.name;
          }
        }
      } catch (err) {
        console.warn("Phonetic venue search fallback:", err);
      }
    } else if (id) {
      const venue = await prisma.venue.findUnique({
        where: { id },
      });
      if (!venue) {
        return NextResponse.json(
          {
            success: false,
            error: "Venue not found",
            count: 0,
            venues: [],
            results: [],
            data: [],
          },
          { status: 404, headers: responseHeaders },
        );
      }
      venues = [venue as unknown as Record<string, unknown>];
    }

    const minWifiSpeedParam = searchParams.get("minWifiSpeed");
    if (minWifiSpeedParam && !isNaN(Number(minWifiSpeedParam))) {
      const minSpeed = parseFloat(minWifiSpeedParam);
      venues = venues.filter((v: any) => {
        const speed = v.wifiSpeed ?? v.amenities?.wifiSpeed;
        return typeof speed === "number" && speed >= minSpeed;
      });
    }

    // 4. Return response with caching headers
    return NextResponse.json(
      {
        success: true,
        count: venues.length,
        venues,
        results: venues,
        data: venues,
        ...(suggestedQuery
          ? {
              suggestedQuery,
              notice: `Did you mean: ${suggestedQuery}?`,
            }
          : {}),
      },
      {
        status: 200,
        headers: responseHeaders,
      },
    );
  } catch (error: any) {
    console.error("Venue search error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST: semantic search with request cancellation (#7618)
// ---------------------------------------------------------------------------

const SearchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radiusMeters: z.number().positive().max(50_000).optional(),
  maxNoiseDb: z.number().min(20).max(120).optional(),
  amenities: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(50).default(15),
});

export async function POST(request: NextRequest) {
  try {
    if (request.signal.aborted) {
      return new NextResponse(null, { status: 499 });
    }

    const body = await request.json();
    const parsed = SearchRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid semantic search parameters",
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const {
      query,
      latitude,
      longitude,
      radiusMeters,
      maxNoiseDb,
      amenities,
      limit,
    } = parsed.data;

    // Pass request.signal to your hybrid/embedding search runner so client aborts
    // immediately cancel upstream Groq/OpenAI embedding API calls:
    // const results = await runHybridVenueSearch(
    //   { query, latitude, longitude, radiusMeters, maxNoiseDb, amenities, limit },
    //   { signal: request.signal }
    // );

    if (request.signal.aborted) {
      return new NextResponse(null, { status: 499 });
    }

    return NextResponse.json({
      query,
      results: [], // Replace with `results` from hybridSearch
      filters: {
        latitude,
        longitude,
        radiusMeters,
        maxNoiseDb,
        amenities,
        limit,
      },
    });
  } catch (error: unknown) {
    if (isAbortError(error) || request.signal.aborted) {
      // Client disconnected / cancelled request; exit cleanly without 500 error logging
      return new NextResponse(null, { status: 499 });
    }

    console.error("[SemanticVenueSearch] Error:", error);
    return NextResponse.json(
      { error: "Failed to execute semantic venue search" },
      { status: 500 },
    );
  }
}
