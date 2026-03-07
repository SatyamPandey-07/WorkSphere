import { NextRequest } from "next/server";

/**
 * Temporary debug endpoint — remove after Foursquare is confirmed working.
 * GET /api/debug/foursquare?name=Cafe+Coffee+Day&lat=19.1766&lng=72.9527
 */
export async function GET(req: NextRequest) {
    const { searchParams } = req.nextUrl;
    const name = searchParams.get("name") ?? "Cafe Coffee Day";
    const lat = searchParams.get("lat") ?? "19.1766";
    const lng = searchParams.get("lng") ?? "72.9527";

    const API_KEY = process.env.FOURSQUARE_API_KEY;

    if (!API_KEY) {
        return Response.json({ error: "FOURSQUARE_API_KEY is NOT set on this server" });
    }

    const maskedKey = `${API_KEY.slice(0, 8)}...${API_KEY.slice(-4)}`;

    // Step 1: Search for place
    try {
        const searchUrl = new URL("https://places.foursquare.com/v3/places/search");
        searchUrl.searchParams.set("query", name);
        searchUrl.searchParams.set("ll", `${lat},${lng}`);
        searchUrl.searchParams.set("radius", "500");
        searchUrl.searchParams.set("limit", "1");

        const searchRes = await fetch(searchUrl.toString(), {
            headers: { Authorization: API_KEY, Accept: "application/json" },
        });

        const searchText = await searchRes.text();
        let searchBody: unknown;
        try { searchBody = JSON.parse(searchText); } catch { searchBody = searchText; }

        if (!searchRes.ok) {
            return Response.json({
                keyPresent: true, maskedKey,
                searchStatus: searchRes.status,
                searchResponse: searchBody,
                error: "Foursquare search call failed",
            });
        }

        const results = (searchBody as { results?: Array<{ fsq_id: string; name: string }> }).results;
        if (!results?.length) {
            return Response.json({
                keyPresent: true, maskedKey,
                searchStatus: searchRes.status,
                searchResponse: searchBody,
                error: "No venues found near those coordinates",
            });
        }

        const fsqId = results[0].fsq_id;
        const venueName = results[0].name;

        // Step 2: Fetch photos
        const photoRes = await fetch(
            `https://places.foursquare.com/v3/places/${encodeURIComponent(fsqId)}/photos?limit=1`,
            { headers: { Authorization: API_KEY, Accept: "application/json" } }
        );

        const photoText = await photoRes.text();
        let photoBody: unknown;
        try { photoBody = JSON.parse(photoText); } catch { photoBody = photoText; }

        const photos = photoBody as Array<{ prefix: string; suffix: string }>;
        const photoUrl = Array.isArray(photos) && photos[0]
            ? `${photos[0].prefix}800x600${photos[0].suffix}`
            : null;

        return Response.json({
            keyPresent: true, maskedKey,
            searchStatus: searchRes.status,
            fsqId, venueName,
            photoStatus: photoRes.status,
            photoResponse: photoBody,
            photoUrl,
        });
    } catch (err) {
        return Response.json({
            keyPresent: true, maskedKey,
            error: "Unexpected exception",
            message: String(err),
        });
    }
}
