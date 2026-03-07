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
        return Response.json({ error: "FOURSQUARE_API_KEY is NOT set on this server" }, { status: 500 });
    }

    const maskedKey = `${API_KEY.slice(0, 8)}...${API_KEY.slice(-4)}`;

    // Step 1: Search for place
    const searchUrl = new URL("https://places.foursquare.com/v3/places/search");
    searchUrl.searchParams.set("query", name);
    searchUrl.searchParams.set("ll", `${lat},${lng}`);
    searchUrl.searchParams.set("radius", "500");
    searchUrl.searchParams.set("limit", "1");

    const searchRes = await fetch(searchUrl.toString(), {
        headers: { Authorization: API_KEY, Accept: "application/json" },
    });

    const searchBody = await searchRes.json();

    if (!searchRes.ok || !searchBody.results?.length) {
        return Response.json({
            keyPresent: true,
            maskedKey,
            searchStatus: searchRes.status,
            searchResponse: searchBody,
            error: "No results from Foursquare place search",
        });
    }

    const fsqId = searchBody.results[0].fsq_id;

    // Step 2: Fetch photos for the place
    const photoRes = await fetch(
        `https://places.foursquare.com/v3/places/${encodeURIComponent(fsqId)}/photos?limit=1&sort=POPULAR`,
        { headers: { Authorization: API_KEY, Accept: "application/json" } }
    );

    const photoBody = await photoRes.json();

    return Response.json({
        keyPresent: true,
        maskedKey,
        searchStatus: searchRes.status,
        fsqId,
        venueName: searchBody.results[0].name,
        photoStatus: photoRes.status,
        photoResponse: photoBody,
        photoUrl: photoBody[0] ? `${photoBody[0].prefix}800x600${photoBody[0].suffix}` : null,
    });
}
