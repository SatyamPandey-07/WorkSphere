import { NextRequest } from "next/server";

/**
 * Temporary debug endpoint — remove after photos are working.
 * GET /api/debug/places?name=Cafe+Coffee+Day&lat=19.17&lng=72.95
 * Opens in browser to see raw Google Places API response.
 */
export async function GET(req: NextRequest) {
    const { searchParams } = req.nextUrl;
    const name = searchParams.get("name") ?? "Cafe Coffee Day";
    const lat = parseFloat(searchParams.get("lat") ?? "19.1766");
    const lng = parseFloat(searchParams.get("lng") ?? "72.9527");

    const API_KEY = process.env.GOOGLE_PLACES_API_KEY;

    if (!API_KEY) {
        return Response.json({ error: "GOOGLE_PLACES_API_KEY is not set on this server" });
    }

    // Mask the key for safe display
    const maskedKey = `${API_KEY.slice(0, 8)}...${API_KEY.slice(-4)}`;

    try {
        const body = {
            textQuery: name,
            locationBias: {
                circle: {
                    center: { latitude: lat, longitude: lng },
                    radius: 500.0,
                },
            },
            maxResultCount: 1,
        };

        const res = await fetch(
            "https://places.googleapis.com/v1/places:searchText",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": API_KEY,
                    "X-Goog-FieldMask": "places.id,places.photos,places.displayName",
                },
                body: JSON.stringify(body),
            }
        );

        const responseText = await res.text();
        let responseJson: unknown;
        try { responseJson = JSON.parse(responseText); } catch { responseJson = responseText; }

        return Response.json({
            debug: {
                apiKeyPresent: true,
                apiKeyMasked: maskedKey,
                requestBody: body,
                googleStatus: res.status,
                googleStatusText: res.statusText,
                googleResponse: responseJson,
            }
        });
    } catch (err) {
        return Response.json({
            debug: {
                apiKeyPresent: true,
                error: String(err),
            }
        });
    }
}
