/**
 * Pexels API - Venue Photo Enrichment
 *
 * Uses the Pexels photo search API (free tier: 20,000 req/month).
 * Searches by venue name to return a relevant high-quality photo.
 * Requires env: PEXELS_API_KEY
 */

const API_KEY = process.env.PEXELS_API_KEY;

interface PexelsSearchResponse {
    photos?: Array<{
        src: {
            large2x: string;
            large: string;
        };
    }>;
}

async function searchPhoto(query: string): Promise<string | null> {
    if (!API_KEY) {
        console.warn("[Pexels] PEXELS_API_KEY not set");
        return null;
    }

    try {
        const url = new URL("https://api.pexels.com/v1/search");
        url.searchParams.set("query", query);
        url.searchParams.set("per_page", "1");
        url.searchParams.set("orientation", "landscape");

        const res = await fetch(url.toString(), {
            headers: { Authorization: API_KEY },
        });

        if (!res.ok) {
            const text = await res.text();
            console.error("[Pexels] search failed:", res.status, text);
            return null;
        }

        const data: PexelsSearchResponse = await res.json();
        return data.photos?.[0]?.src?.large2x ?? data.photos?.[0]?.src?.large ?? null;
    } catch (err) {
        console.error("[Pexels] searchPhoto error:", err);
        return null;
    }
}

export async function getVenuePhotoUrl(
    osmId: string,
    name: string,
    lat: number,
    lng: number
): Promise<string | null> {
    if (!API_KEY) return null;

    try {
        const { prisma } = await import("@/lib/prisma");

        const cached = await prisma.venue.findUnique({
            where: { placeId: osmId },
            select: { photoReference: true },
        });

        if (cached?.photoReference) {
            return cached.photoReference;
        }

        const photoUrl = await searchPhoto(name);
        if (!photoUrl) return null;

        await prisma.venue
            .upsert({
                where: { placeId: osmId },
                update: { photoReference: photoUrl },
                create: {
                    placeId: osmId,
                    name,
                    latitude: lat,
                    longitude: lng,
                    category: "cafe",
                    photoReference: photoUrl,
                },
            })
            .catch((err: unknown) => {
                console.warn("[Pexels] DB cache write failed:", err);
            });

        return photoUrl;
    } catch (err) {
        console.error("[Pexels] getVenuePhotoUrl error:", err);
        return null;
    }
}