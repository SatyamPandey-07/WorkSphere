/**
 * Foursquare Places API — Venue Photo Enrichment
 *
 * Uses Foursquare Places API v3 (api.foursquare.com/v3).
 * Free tier: 1,000 API calls/day, no billing required.
 *
 * Required env: FOURSQUARE_API_KEY
 */

const API_KEY = process.env.FOURSQUARE_API_KEY;
const BASE_URL = "https://places.foursquare.com/v3";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FoursquareSearchResponse {
    results?: Array<{ fsq_id: string }>;
}

interface FoursquarePhoto {
    prefix: string;
    suffix: string;
}

// ─── Core API calls ───────────────────────────────────────────────────────────

/** Finds a Foursquare place ID by name + coordinates. */
async function searchPlace(
    name: string,
    lat: number,
    lng: number
): Promise<string | null> {
    if (!API_KEY) {
        console.warn("[Foursquare] FOURSQUARE_API_KEY not set");
        return null;
    }

    try {
        const url = new URL(`${BASE_URL}/places/search`);
        url.searchParams.set("query", name);
        url.searchParams.set("ll", `${lat},${lng}`);
        url.searchParams.set("radius", "500");
        url.searchParams.set("limit", "1");

        const res = await fetch(url.toString(), {
            headers: { Authorization: API_KEY, Accept: "application/json" },
        });

        if (!res.ok) {
            const text = await res.text();
            console.error("[Foursquare] search failed:", res.status, text);
            return null;
        }

        const data: FoursquareSearchResponse = await res.json();
        return data.results?.[0]?.fsq_id ?? null;
    } catch (err) {
        console.error("[Foursquare] searchPlace error:", err);
        return null;
    }
}

/** Fetches the most popular photo URL for a given Foursquare place ID. */
async function getPlacePhoto(fsqId: string): Promise<string | null> {
    if (!API_KEY) return null;

    try {
        const res = await fetch(
            `${BASE_URL}/places/${encodeURIComponent(fsqId)}/photos?limit=1&sort=POPULAR`,
            { headers: { Authorization: API_KEY, Accept: "application/json" } }
        );

        if (!res.ok) {
            const text = await res.text();
            console.error("[Foursquare] photos failed:", res.status, text);
            return null;
        }

        const photos: FoursquarePhoto[] = await res.json();
        const photo = photos[0];
        if (!photo) return null;

        // Foursquare photo URL format: prefix + size + suffix
        return `${photo.prefix}800x600${photo.suffix}`;
    } catch (err) {
        console.error("[Foursquare] getPlacePhoto error:", err);
        return null;
    }
}

// ─── High-level helper ────────────────────────────────────────────────────────

/**
 * Gets a real venue photo URL from Foursquare.
 * Caches the fsq_id and photo URL in the DB so each venue only
 * calls the API on the FIRST request — all subsequent calls are free.
 *
 * Returns null if the API key is missing or the venue has no photos.
 */
export async function getVenuePhotoUrl(
    osmId: string,
    name: string,
    lat: number,
    lng: number
): Promise<string | null> {
    if (!API_KEY) return null;

    try {
        const { prisma } = await import("@/lib/prisma");

        // 1. Return cached photo URL from DB (costs 0 API calls)
        const cached = await prisma.venue.findUnique({
            where: { placeId: osmId },
            select: { photoReference: true },
        });

        if (cached?.photoReference) {
            return cached.photoReference;
        }

        // 2. Search Foursquare for the place
        const fsqId = await searchPlace(name, lat, lng);
        if (!fsqId) return null;

        // 3. Fetch the top photo for that place
        const photoUrl = await getPlacePhoto(fsqId);
        if (!photoUrl) return null;

        // 4. Cache in DB — upsert handles both new and existing venue rows
        await prisma.venue
            .upsert({
                where: { placeId: osmId },
                update: { googlePlaceId: fsqId, photoReference: photoUrl },
                create: {
                    placeId: osmId,
                    name,
                    latitude: lat,
                    longitude: lng,
                    category: "cafe",
                    googlePlaceId: fsqId,
                    photoReference: photoUrl,
                },
            })
            .catch((err: unknown) => {
                console.warn("[Foursquare] DB cache write failed:", err);
            });

        return photoUrl;
    } catch (err) {
        console.error("[Foursquare] getVenuePhotoUrl error:", err);
        return null;
    }
}

