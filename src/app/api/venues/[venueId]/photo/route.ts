import { NextRequest } from "next/server";
import { getVenuePhotoUrl } from "@/lib/googlePlaces";

/**
 * GET /api/venues/[venueId]/photo?name=...&lat=...&lng=...
 *
 * Resolves a Foursquare venue photo and proxies the image bytes back.
 * The API key never leaves the server — the browser just sees our URL.
 * Response is edge-cached for 24h so repeat renders cost 0 API calls.
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ venueId: string }> }
) {
    const { venueId } = await params;
    const { searchParams } = req.nextUrl;

    const name = searchParams.get("name");
    const lat = parseFloat(searchParams.get("lat") ?? "");
    const lng = parseFloat(searchParams.get("lng") ?? "");

    if (!name || isNaN(lat) || isNaN(lng)) {
        return new Response(null, { status: 400 });
    }

    try {
        // Returns a proxied Google Places photo URL
        const googleUrl = await getVenuePhotoUrl(venueId, name, lat, lng);

        if (!googleUrl) {
            console.warn(`[photo] No photo found for venue "${name}" (${venueId})`);
            return new Response(null, { status: 404 });
        }

        // Proxy the image — fetch follows Google's 302 redirect to the CDN URL
        const imageRes = await fetch(googleUrl, { redirect: "follow" });

        if (!imageRes.ok) {
            return new Response(null, { status: 502 });
        }

        return new Response(imageRes.body, {
            headers: {
                "Content-Type": imageRes.headers.get("Content-Type") || "image/jpeg",
                // Edge-cache for 24h — photo_reference is stable, cost = $0 on repeat
                "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
            },
        });
    } catch (err) {
        console.error("[/api/venues/photo] Error:", err);
        return new Response(null, { status: 500 });
    }
}

