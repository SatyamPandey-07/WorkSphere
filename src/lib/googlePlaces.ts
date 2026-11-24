/**
 * Pexels API - Venue Photo Enrichment
 *
 * Uses the Pexels photo search API (free tier: 20,000 req/month).
 * Searches by venue name to return a relevant high-quality photo.
 * Requires env: PEXELS_API_KEY
 */

import { prisma } from "@/lib/prisma";

function getApiKey(): string | undefined {
  return process.env.PEXELS_API_KEY;
}

interface PexelsSearchResponse {
  photos?: Array<{
    src: {
      large2x: string;
      large: string;
    };
  }>;
}

export async function searchPhoto(query: string): Promise<string | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn("[Pexels] PEXELS_API_KEY not set");
    return null;
  }

  try {
    const url = new URL("https://api.pexels.com/v1/search");
    url.searchParams.set("query", query);
    url.searchParams.set("per_page", "1");
    url.searchParams.set("orientation", "landscape");

    const res = await fetch(url.toString(), {
      headers: { Authorization: apiKey },
    });

    if (!res.ok) {
      const text = typeof res.text === "function" ? await res.text() : "";
      console.error("[Pexels] search failed:", res.status, text);
      return null;
    }

    const data: PexelsSearchResponse = await res.json();
    return (
      data.photos?.[0]?.src?.large2x ?? data.photos?.[0]?.src?.large ?? null
    );
  } catch (err) {
    console.error("[Pexels] searchPhoto error:", err);
    return null;
  }
}

export async function getVenuePhotoUrl(
  osmId: string,
  name: string,
  lat: number,
  lng: number,
): Promise<string | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    // Resolve canonical venue from DB if it exists (by id or placeId)
    const canonicalVenue = await prisma.venue.findFirst({
      where: {
        OR: [{ id: osmId }, { placeId: osmId }],
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

    // 1. If photoReference already cached in DB, return it immediately
    if (canonicalVenue?.photoReference) {
      return canonicalVenue.photoReference;
    }

    // 2. If venue exists in DB, use canonical name rather than caller-supplied metadata
    const searchName = canonicalVenue?.name ?? name?.trim();
    if (!searchName) return null;

    const photoUrl = await searchPhoto(searchName);
    if (!photoUrl) return null;

    // 3. Persist photoReference to database
    if (canonicalVenue) {
      try {
        await prisma.venue.update({
          where: { id: canonicalVenue.id },
          data: { photoReference: photoUrl },
        });
      } catch (err: unknown) {
        console.warn("[Pexels] DB cache update failed:", err);
      }
    } else {
      if (
        typeof lat === "number" &&
        Number.isFinite(lat) &&
        lat >= -90 &&
        lat <= 90 &&
        typeof lng === "number" &&
        Number.isFinite(lng) &&
        lng >= -180 &&
        lng <= 180
      ) {
        try {
          await prisma.venue.upsert({
            where: { placeId: osmId },
            update: { photoReference: photoUrl },
            create: {
              placeId: osmId,
              name: searchName,
              latitude: lat,
              longitude: lng,
              category: "cafe",
              photoReference: photoUrl,
            },
          });
        } catch (err: unknown) {
          console.warn("[Pexels] DB cache write failed:", err);
        }
      }
    }

    return photoUrl;
  } catch (err) {
    console.error("[Pexels] getVenuePhotoUrl error:", err);
    return null;
  }
}
