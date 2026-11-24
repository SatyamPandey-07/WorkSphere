import { NextRequest } from "next/server";
import { getVenuePhotoUrl } from "@/lib/googlePlaces";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";

/**
 * GET /api/venues/[venueId]/photo?name=...&lat=...&lng=...
 *
 * Resolves a Pexels venue photo and proxies the image bytes back.
 * Prioritizes canonical venue metadata from the database over caller-supplied
 * query parameters when resolving and caching photos.
 * Implements rate limiting on cache misses to prevent external API exhaustion.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  const { venueId } = await params;
  if (!venueId || typeof venueId !== "string" || !venueId.trim()) {
    return new Response(null, { status: 400 });
  }

  const { searchParams } = req.nextUrl;
  const callerName = searchParams.get("name")?.trim();
  const latParam = searchParams.get("lat");
  const lngParam = searchParams.get("lng");
  const lat = latParam !== null && latParam !== "" ? parseFloat(latParam) : NaN;
  const lng = lngParam !== null && lngParam !== "" ? parseFloat(lngParam) : NaN;

  try {
    // 1. Resolve canonical venue record from database if it exists
    const canonicalVenue = await prisma.venue.findFirst({
      where: {
        OR: [{ id: venueId }, { placeId: venueId }],
      },
      select: {
        id: true,
        placeId: true,
        name: true,
        latitude: true,
        longitude: true,
        photoReference: true,
      },
    });

    // 2. Resolve metadata: prefer canonical DB metadata over caller-supplied parameters
    let searchName: string;
    let searchLat: number;
    let searchLng: number;

    if (canonicalVenue) {
      searchName = canonicalVenue.name;
      searchLat = canonicalVenue.latitude;
      searchLng = canonicalVenue.longitude;
    } else {
      // Unregistered / external venue: caller must provide valid metadata
      if (
        !callerName ||
        callerName.length > 200 ||
        isNaN(lat) ||
        isNaN(lng) ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
        return new Response(null, { status: 400 });
      }
      searchName = callerName;
      searchLat = lat;
      searchLng = lng;
    }

    // 3. If cache miss requires external search, enforce rate limiting
    const isCached = Boolean(canonicalVenue?.photoReference);
    if (!isCached) {
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "anonymous";
      const allowed = await rateLimit(`photo-miss:${ip}`, 30);
      if (!allowed) {
        return new Response(JSON.stringify({ error: "Too many requests" }), {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "60",
          },
        });
      }
    }

    // 4. Resolve photo URL using canonical or validated metadata
    const photoUrl = await getVenuePhotoUrl(
      canonicalVenue?.placeId ?? venueId,
      searchName,
      searchLat,
      searchLng,
    );

    if (!photoUrl) {
      console.warn(
        `[photo] No photo found for venue "${searchName}" (${venueId})`,
      );
      return new Response(null, { status: 404 });
    }

    // 5. Proxy the image bytes
    const imageRes = await fetch(photoUrl, { redirect: "follow" });

    if (!imageRes.ok) {
      return new Response(null, { status: 502 });
    }

    return new Response(imageRes.body, {
      headers: {
        "Content-Type": imageRes.headers.get("Content-Type") || "image/jpeg",
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
      },
    });
  } catch (err) {
    console.error("[/api/venues/photo] Error:", err);
    return new Response(null, { status: 500 });
  }
}
