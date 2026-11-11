 feature/solana-optimistic-escrow-simulation
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getLatestVenueTimestamp,
  generateETag,
  BoundingBox,
} from "@/lib/cache/venueCache";
import { searchVenuesPhonetic } from "@/lib/search/phoneticVenueSearch";
import { getFuzzyThreshold, isFuzzyMatch } from "@/lib/search/fuzzySearch";
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

    const results = await searchVenuesPhonetic(q, limit);
    return NextResponse.json({ results });
  } catch (error: any) {
    console.error("Phonetic Venue Search Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });


 main
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getLatestVenueTimestamp,
  generateETag,
  BoundingBox,
} from "@/lib/cache/venueCache";
import { searchVenuesPhonetic } from "@/lib/search/phoneticVenueSearch";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const q = searchParams.get("q");

    if (q) {
      const limitParam = searchParams.get("limit");
      const limit = limitParam ? parseInt(limitParam, 10) : 20;
      const results = await searchVenuesPhonetic(q, limit);
      return NextResponse.json({
        success: true,
        count: results.length,
        data: results,
        results,
      });
    }
    if (parsed > MAX_SEARCH_RADIUS_METERS) {
      return {
        error: `'radiusMeters' must not exceed ${MAX_SEARCH_RADIUS_METERS}`,
      };
    }
    radiusMeters = parsed;
  }

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
    let suggestedQuery: string | undefined;
    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
          ETag: etag,
        },
      });
    }

    // 3. Fetch venues from database (simulate data fetching here)
    const venues: Record<string, unknown>[] = [];

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
          const normalizedQuery = q.trim().toLocaleLowerCase();
          const exactMatchExists = phoneticResults.some((venue) =>
            venue.name.toLocaleLowerCase().includes(normalizedQuery),
          );
          const threshold = getFuzzyThreshold(normalizedQuery.length);
          if (!exactMatchExists && threshold > 0) {
            suggestedQuery = phoneticResults
              .map((venue) => {
                const match = isFuzzyMatch(normalizedQuery, venue.name, threshold);
                return match.matched && match.distance > 0
                  ? { name: venue.name, distance: match.distance, score: venue.score }
                  : null;
              })
              .filter(
                (candidate): candidate is { name: string; distance: number; score: number } =>
                  candidate !== null,
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
        ...(suggestedQuery
          ? {
              suggestedQuery,
              notice: `Did you mean: ${suggestedQuery}?`,
            }
          : {}),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
          ETag: etag,
        },
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
