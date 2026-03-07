import { NextRequest } from "next/server";
import { getVenuePhotoUrl } from "@/lib/googlePlaces";

/**
 * GET /api/venues/[venueId]/photo?name=...&lat=...&lng=...
 *
 * Returns a Google Places photo URL for a venue.
 * The result is cached in the DB after the first call.
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
        return Response.json(
            { error: "name, lat, lng query params are required" },
            { status: 400 }
        );
    }

    try {
        const photoUrl = await getVenuePhotoUrl(venueId, name, lat, lng);

        return Response.json(
            { photoUrl },
            {
                headers: {
                    // Cache at CDN edge for 24 hours — the photo_reference is stable
                    "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
                },
            }
        );
    } catch (err) {
        console.error("[/api/venues/photo] Error:", err);
        return Response.json({ photoUrl: null }, { status: 200 }); // graceful — never 500 the client
    }
}
