 feature/webxr-ar-wayfinding-overlay

 fix/venue-card-skeleton-cls-snap
 main
import { NextResponse } from "next/server";
import { searchVenuesPhonetic } from "@/lib/search/phoneticVenueSearch";

 feature/hybrid-venue-search
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q");
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 20;

    if (!q) {
      return NextResponse.json({ results: [] });
    }

    const results = await searchVenuesPhonetic(q, limit);
    return NextResponse.json({ results });
  } catch (error: any) {
    console.error("Phonetic Venue Search Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });

 main
import { NextResponse } from "next/server";
import { searchVenuesPhonetic } from "@/lib/search/phoneticVenueSearch";

 feature/hybrid-venue-search
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q");
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 20;

    if (!q) {
      return NextResponse.json({ results: [] });
    }

    const results = await searchVenuesPhonetic(q, limit);
    return NextResponse.json({ results });
  } catch (error: any) {
    console.error("Phonetic Venue Search Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getLatestVenueTimestamp, generateETag, BoundingBox } from '@/lib/cache/venueCache';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const bbox: BoundingBox = {
      minLat: parseFloat(searchParams.get('minLat') || '0'),
      maxLat: parseFloat(searchParams.get('maxLat') || '0'),
      minLng: parseFloat(searchParams.get('minLng') || '0'),
      maxLng: parseFloat(searchParams.get('maxLng') || '0'),
    };

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
main
  }
}
