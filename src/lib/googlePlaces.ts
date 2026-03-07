/**
 * Google Places API (New / v1) — Venue Photo Enrichment
 *
 * Uses the NEW Places API (places.googleapis.com/v1) — one combined
 * searchText call returns both the place ID and photos in one shot.
 *
 * Cost: ~$0.032 per unique venue (first lookup only), then $0 from DB cache.
 *
 * Required: Enable "Places API (New)" in Google Cloud Console.
 */

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlacesSearchResponse {
    places?: Array<{
        id: string; // The new place ID format
        photos?: Array<{
            name: string; // e.g. "places/ChIJ.../photos/AelY..."
            widthPx: number;
            heightPx: number;
        }>;
    }>;
}

// ─── Core API call (New Places API — single request) ─────────────────────────

/**
 * Searches for a venue by name + location using Places API (New).
 * Returns { googlePlaceId, photoName } in one call.
 */
async function searchPlace(
    name: string,
    lat: number,
    lng: number
): Promise<{ googlePlaceId: string; photoName: string } | null> {
    if (!API_KEY) {
        console.warn("[GooglePlaces] GOOGLE_PLACES_API_KEY not set");
        return null;
    }

    try {
        const res = await fetch(
            "https://places.googleapis.com/v1/places:searchText",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": API_KEY,
                    // Only request the fields we need — minimises cost
                    "X-Goog-FieldMask": "places.id,places.photos",
                },
                body: JSON.stringify({
                    textQuery: name,
                    locationBias: {
                        circle: {
                            center: { latitude: lat, longitude: lng },
                            radius: 500.0,
                        },
                    },
                    maxResultCount: 1,
                }),
            }
        );

        if (!res.ok) {
            const text = await res.text();
            console.error("[GooglePlaces] searchText failed:", res.status, text);
            return null;
        }

        const data: PlacesSearchResponse = await res.json();
        const place = data.places?.[0];

        if (!place) return null;

        const photoName = place.photos?.[0]?.name ?? null;
        if (!photoName) return null;

        return { googlePlaceId: place.id, photoName };
    } catch (err) {
        console.error("[GooglePlaces] searchPlace error:", err);
        return null;
    }
}

// ─── Photo URL builder ────────────────────────────────────────────────────────

/**
 * Builds a photo media URL from a Places API (New) photo resource name.
 * Format: places/{place_id}/photos/{photo_id}
 * No extra API call — just a URL construction.
 */
export function buildPlacePhotoUrl(
    photoName: string,
    maxWidthPx = 800
): string {
    return (
        `https://places.googleapis.com/v1/${photoName}/media` +
        `?maxWidthPx=${maxWidthPx}&key=${API_KEY}`
    );
}

// ─── High-level helper ────────────────────────────────────────────────────────

/**
 * Gets a real venue photo URL from Google Places (New API).
 * Caches googlePlaceId and photoReference in the DB so each venue
 * only costs money on the FIRST lookup — all subsequent calls are free.
 *
 * Returns null if the API key is missing or the venue has no photos.
 */
export async function getVenuePhotoUrl(
    osmId: string,  // OSM node ID — used as placeId in our DB
    name: string,
    lat: number,
    lng: number
): Promise<string | null> {
    if (!API_KEY) return null;

    try {
        const { prisma } = await import("@/lib/prisma");

        // 1. Return cached photo_reference from DB (costs $0)
        const cached = await prisma.venue.findUnique({
            where: { placeId: osmId },
            select: { googlePlaceId: true, photoReference: true },
        });

        if (cached?.photoReference) {
            return buildPlacePhotoUrl(cached.photoReference);
        }

        // 2. Call Google Places API (New) — one request gets place ID + photo
        const result = await searchPlace(name, lat, lng);
        if (!result) return null;

        const { googlePlaceId, photoName } = result;

        // 3. Cache in DB — upsert so it works whether the venue row exists or not
        await prisma.venue
            .upsert({
                where: { placeId: osmId },
                update: { googlePlaceId, photoReference: photoName },
                create: {
                    placeId: osmId,
                    name,
                    latitude: lat,
                    longitude: lng,
                    category: "cafe",
                    googlePlaceId,
                    photoReference: photoName,
                },
            })
            .catch((err: unknown) => {
                console.warn("[GooglePlaces] DB cache write failed:", err);
            });

        return buildPlacePhotoUrl(photoName);
    } catch (err) {
        console.error("[GooglePlaces] getVenuePhotoUrl error:", err);
        return null;
    }
}

