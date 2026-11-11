// src/app/api/venues/search/route.ts

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getLatestVenueTimestamp,
  generateETag,
  BoundingBox,
} from "@/lib/cache/venueCache";
import { searchVenuesPhonetic } from "@/lib/search/phoneticVenueSearch";
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

/**
 * Checks whether the incoming request should bypass caching.
 * Bypasses cache if an Authorization header is present or if personalized
 * location cookies are detected.
 */
export function shouldBypassCache(request: NextRequest): boolean {
  // 1. Check for Authorization header
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.trim().length > 0) {
    return true;
  }

  // 2. Check for personalized location cookies via NextRequest cookies API
  if (request.cookies) {
    for (const name of LOCATION_COOKIE_NAMES) {
      if (request.cookies.has(name)) {
        return true;
      }
    }

    const allCookies =
      typeof request.cookies.getAll === "function"
        ? request.cookies.getAll()
        : [];
    for (const cookie of allCookies) {
      const lower = cookie.name.toLowerCase();
      if (
        lower.includes("location") ||
        lower.includes("geo") ||
        lower.includes("coord")
      ) {
        return true;
      }
    }
  }

  // 3. Fallback check on raw Cookie header string
  const rawCookieHeader = request.headers.get("cookie");
  if (rawCookieHeader) {
    const cookiePairs = rawCookieHeader.split(";").map((c) => c.trim());
    for (const pair of cookiePairs) {
      const [key] = pair.split("=");
      const lowerKey = key.trim().toLowerCase();
      if (
        LOCATION_COOKIE_NAMES.includes(lowerKey) ||
        lowerKey.includes("location") ||
        lowerKey.includes("geo") ||
        lowerKey.includes("coord")
      ) {
        return true;
      }
    }
  }

  return false;
}

function parseLimit(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Validates and parses the geospatial proximity search parameters.
 * Returns an error message string when the inputs are invalid.
 */
function parseSpatialParams(searchParams: URLSearchParams): {
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  error?: string;
} {
  const latRaw = searchParams.get("lat");
  const lngRaw = searchParams.get("lng");

  if (latRaw === null && lngRaw === null) return {};

  if (latRaw === null || lngRaw === null) {
    return { error: "Both 'lat' and 'lng' parameters are required together" };
  }

  const lat = parseFloat(latRaw);
  const lng = parseFloat(lngRaw);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { error: "'lat' must be a number between -90 and 90" };
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { error: "'lng' must be a number between -180 and 180" };
  }

  const radiusRaw = searchParams.get("radiusMeters");
  let radiusMeters = DEFAULT_SEARCH_RADIUS_METERS;
  if (radiusRaw !== null) {
    const parsed = parseFloat(radiusRaw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { error: "'radiusMeters' must be a positive number" };
    }
    if (parsed > MAX_SEARCH_RADIUS_METERS) {
      return {
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
    const q = searchParams.get("q") || searchParams.get("query");
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
        }
      );
    }

    let venues: Record<string, unknown>[] = [];

    if (spatial.lat !== undefined && spatial.lng !== undefined) {
      const limit = Math.min(
        parseLimit(searchParams.get("limit"), 20),
        MAX_SPATIAL_RESULT_LIMIT
      );
      venues = (await searchVenuesNearby(
        spatial.lat,
        spatial.lng,
        spatial.radiusMeters,
        limit
      )) as unknown as Record<string, unknown>[];
    } else if (q) {
      const limit = parseLimit(searchParams.get("limit"), 20);
      try {
        const phoneticResults = await searchVenuesPhonetic(q, limit);
        if (phoneticResults && Array.isArray(phoneticResults)) {
          venues = phoneticResults as unknown as Record<string, unknown>[];
        }
      } catch (err) {
        console.warn("Phonetic venue search fallback:", err);
      }
    } else if (id) {
      venues = [{ id, name: "Workspace Venue", address: "Sample Address" }];
    }

    // 4. Return response with caching headers
    return NextResponse.json(
      {
        success: true,
        count: venues.length,
        venues,
        results: venues,
        data: venues,
      },
      {
        status: 200,
        headers: responseHeaders,
      }
    );
  } catch (error) {
    console.error("Venue search error:", error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      {
        status: 500,
        headers: {
          "Cache-Control": BYPASS_CACHE_CONTROL,
          Vary: VARY_HEADER,
        },
      }
    );
  }
}
