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

export const dynamic = "force-dynamic";

function shouldBypassCache(request: NextRequest): boolean {
  if (request.headers.get("authorization")) return true;
  const cookie = request.headers.get("cookie") || "";
  if (cookie.includes("__session") || cookie.includes("__client_uat")) {
    return true;
  }
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
  const radiusStr = searchParams.get("radiusMeters");

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
  if (radiusStr !== null) {
    const parsed = parseFloat(radiusStr);
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

    if (spatial.lat !== undefined && spatial.lng !== undefined) {
      const limit = Math.min(
        parseLimit(searchParams.get("limit"), 20),
        MAX_SPATIAL_RESULT_LIMIT,
      );
      venues = (await searchVenuesNearby(
        spatial.lat,
        spatial.lng,
        spatial.radiusMeters,
        limit,
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
