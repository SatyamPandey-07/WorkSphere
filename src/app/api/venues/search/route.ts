// src/app/api/venues/search/route.ts

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getLatestVenueTimestamp, generateETag, BoundingBox } from '@/lib/cache/venueCache';
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getLatestVenueTimestamp,
  generateETag,
  BoundingBox,
} from "@/lib/cache/venueCache";
import { searchVenuesPhonetic } from "@/lib/search/phoneticVenueSearch";

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

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const bbox: BoundingBox = {
      minLat: parseFloat(searchParams.get('minLat') || '0'),
      maxLat: parseFloat(searchParams.get('maxLat') || '0'),
      minLng: parseFloat(searchParams.get('minLng') || '0'),
      maxLng: parseFloat(searchParams.get('maxLng') || '0'),
    };

    const q = searchParams.get("q") || searchParams.get("query");
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 20;
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
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
          'ETag': etag,
        },
      });
    }

    // 3. Fetch venues from database (simulate data fetching here)
    const venues = [
      // { id: '1', name: 'Coffee House', ... }
    ];

    // 4. Return successful response with Edge caching headers & ETag
    return NextResponse.json(
      { success: true, count: venues.length, data: venues },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
          'ETag': etag,
        },
      }
    );
  } catch (error) {
    console.error('Venue search caching error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
}
}
}
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

    // 3. Fetch venues (phonetic search if text query provided, otherwise fallback query)
    let venues: Record<string, unknown>[] = [];
    if (q) {
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
    const cacheControl = bypassCache
      ? BYPASS_CACHE_CONTROL
      : PUBLIC_CACHE_CONTROL;
    const headers: Record<string, string> = {
      "Cache-Control": cacheControl,
      Vary: VARY_HEADER,
    };

    if (!bypassCache && etag) {
      headers.ETag = etag;
    }

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
        headers,
      },
    );
  } catch (error) {
    console.error("Venue search caching error:", error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      {
        status: 500,
        headers: {
          "Cache-Control": BYPASS_CACHE_CONTROL,
          Vary: VARY_HEADER,
        },
      },
    );
  }
}
