/**
 * Google Places API — Venue Photo Enrichment
 *
 * Uses the Places API (New) to fetch real photos for venues.
 * photo_reference is cached in the Venue DB row so each venue
 * only ever makes 2 Google API calls (find + details) — ever.
 *
 * Cost: ~$0.034 per unique venue (first lookup only), then $0 forever.
 */

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;

// ─── Types ────────────────────────────────────────────────────────────────────

interface FindPlaceResult {
    candidates: Array<{ place_id: string }>;
    status: string;
}

interface PlaceDetailsResult {
    result: {
        photos?: Array<{
            photo_reference: string;
            width: number;
            height: number;
        }>;
    };
    status: string;
}

// ─── Core API calls ───────────────────────────────────────────────────────────

/**
 * Step 1: Find Google's place_id for a venue by name + location.
 */
export async function findGooglePlaceId(
    name: string,
    lat: number,
    lng: number
): Promise<string | null> {
    if (!API_KEY) {
        console.warn("[GooglePlaces] GOOGLE_PLACES_API_KEY not set");
        return null;
    }

    try {
        const url = new URL(
            "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
        );
        url.searchParams.set("input", name);
        url.searchParams.set("inputtype", "textquery");
        // Bias results within 200m of the OSM coordinate
        url.searchParams.set("locationbias", `circle:200@${lat},${lng}`);
        url.searchParams.set("fields", "place_id");
        url.searchParams.set("key", API_KEY);

        const res = await fetch(url.toString(), {
            next: { revalidate: 86400 }, // cache for 24h at edge
        });

        if (!res.ok) {
            console.error("[GooglePlaces] findplacefromtext failed:", res.status);
            return null;
        }

        const data: FindPlaceResult = await res.json();

        if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
            console.error("[GooglePlaces] findplacefromtext status:", data.status);
            return null;
        }

        return data.candidates?.[0]?.place_id ?? null;
    } catch (err) {
        console.error("[GooglePlaces] findGooglePlaceId error:", err);
        return null;
    }
}

/**
 * Step 2: Get the first photo_reference for a place_id.
 * Only requests the "photos" field to minimize cost.
 */
export async function getPhotoReference(
    placeId: string
): Promise<string | null> {
    if (!API_KEY) return null;

    try {
        const url = new URL(
            "https://maps.googleapis.com/maps/api/place/details/json"
        );
        url.searchParams.set("place_id", placeId);
        url.searchParams.set("fields", "photos"); // ← only pay for photos field
        url.searchParams.set("key", API_KEY);

        const res = await fetch(url.toString(), {
            next: { revalidate: 86400 },
        });

        if (!res.ok) {
            console.error("[GooglePlaces] place details failed:", res.status);
            return null;
        }

        const data: PlaceDetailsResult = await res.json();

        if (data.status !== "OK") {
            console.error("[GooglePlaces] place details status:", data.status);
            return null;
        }

        return data.result?.photos?.[0]?.photo_reference ?? null;
    } catch (err) {
        console.error("[GooglePlaces] getPhotoReference error:", err);
        return null;
    }
}

/**
 * Step 3: Build the photo URL from a photo_reference.
 * This is just a URL — no extra API call, no extra cost.
 */
export function buildPlacePhotoUrl(
    photoReference: string,
    maxWidth = 800
): string {
    return (
        `https://maps.googleapis.com/maps/api/place/photo` +
        `?maxwidth=${maxWidth}` +
        `&photoreference=${encodeURIComponent(photoReference)}` +
        `&key=${API_KEY}`
    );
}

// ─── High-level helper ────────────────────────────────────────────────────────

/**
 * Gets a real venue photo URL from Google Places.
 * Caches both googlePlaceId and photoReference in the DB so
 * each venue only costs money on the FIRST lookup.
 *
 * Returns null if the API key is missing or the venue has no photos.
 */
export async function getVenuePhotoUrl(
    osmId: string,      // The OSM id (used as placeId in our DB)
    name: string,
    lat: number,
    lng: number
): Promise<string | null> {
    if (!API_KEY) return null;

    try {
        const { prisma } = await import("@/lib/prisma");

        // 1. Check DB cache first — if we've already resolved this venue, use it
        const cached = await prisma.venue.findUnique({
            where: { placeId: osmId },
            select: { googlePlaceId: true, photoReference: true },
        });

        if (cached?.photoReference) {
            return buildPlacePhotoUrl(cached.photoReference);
        }

        // 2. Find Google's place_id for the venue
        const googlePlaceId =
            cached?.googlePlaceId ?? (await findGooglePlaceId(name, lat, lng));

        if (!googlePlaceId) return null;

        // 3. Get a photo_reference
        const photoReference = await getPhotoReference(googlePlaceId);
        if (!photoReference) return null;

        // 4. Cache in DB — upsert so it works whether the venue row exists or not
        await prisma.venue
            .upsert({
                where: { placeId: osmId },
                update: { googlePlaceId, photoReference },
                create: {
                    placeId: osmId,
                    name,
                    latitude: lat,
                    longitude: lng,
                    category: "cafe", // default — will be corrected if venue exists
                    googlePlaceId,
                    photoReference,
                },
            })
            .catch((err: unknown) => {
                // Non-fatal — just means the photo won't be cached this request
                console.warn("[GooglePlaces] DB cache write failed:", err);
            });

        return buildPlacePhotoUrl(photoReference);
    } catch (err) {
        console.error("[GooglePlaces] getVenuePhotoUrl error:", err);
        return null;
    }
}

/**
 * Batch-fetch photos for multiple venues.
 * Runs in parallel (max 5 concurrent) to stay within rate limits.
 */
export async function batchGetVenuePhotos(
    venues: Array<{ id: string; name: string; lat: number; lng: number }>
): Promise<Map<string, string>> {
    const photoMap = new Map<string, string>();

    if (!API_KEY || venues.length === 0) return photoMap;

    // Process in chunks of 5 to avoid hammering the API
    const CHUNK = 5;
    for (let i = 0; i < venues.length; i += CHUNK) {
        const chunk = venues.slice(i, i + CHUNK);
        const results = await Promise.allSettled(
            chunk.map(async (v) => {
                const url = await getVenuePhotoUrl(v.id, v.name, v.lat, v.lng);
                return { id: v.id, url };
            })
        );

        for (const result of results) {
            if (result.status === "fulfilled" && result.value.url) {
                photoMap.set(result.value.id, result.value.url);
            }
        }
    }

    return photoMap;
}
