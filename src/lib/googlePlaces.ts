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

export interface PexelsPhotoResult {
  url: string;
  photographer?: string;
  photographerUrl?: string;
  photoPageUrl?: string;
  source: "pexels";
}

interface PexelsPhotoItem {
  url?: string;
  photographer?: string;
  photographer_url?: string;
  src?: {
    large2x?: string;
    large?: string;
  };
}

interface PexelsSearchResponse {
  photos?: PexelsPhotoItem[];
}

const attributionCache = new Map<string, PexelsPhotoResult>();

export function clearAttributionCacheForTest() {
  attributionCache.clear();
}

export async function searchPhotoDetails(
  query: string,
): Promise<PexelsPhotoResult | null> {
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
      const text = await res.text();
      console.error("[Pexels] search failed:", res.status, text);
      return null;
    }

    const data: PexelsSearchResponse = await res.json();
    const first = data.photos?.[0];
    const imageUrl = first?.src?.large2x ?? first?.src?.large ?? null;

    if (!imageUrl) return null;

    return {
      url: imageUrl,
      photographer: first.photographer?.trim() || undefined,
      photographerUrl: first.photographer_url?.trim() || undefined,
      photoPageUrl: first.url?.trim() || undefined,
      source: "pexels",
    };
  } catch (err) {
    console.error("[Pexels] searchPhoto error:", err);
    return null;
  }
}

export async function searchPhoto(query: string): Promise<string | null> {
  const details = await searchPhotoDetails(query);
  return details?.url ?? null;
}

export async function getVenuePhotoDetails(
  osmId: string,
  name: string,
  lat: number,
  lng: number,
): Promise<PexelsPhotoResult | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const cached = await prisma.venue.findUnique({
      where: { placeId: osmId },
      select: { photoReference: true },
    });

    if (cached?.photoReference) {
      const cachedAttribution = attributionCache.get(osmId);
      if (cachedAttribution) {
        return cachedAttribution;
      }
      return {
        url: cached.photoReference,
        source: "pexels",
      };
    }

    const details = await searchPhotoDetails(name);
    if (!details) return null;

    attributionCache.set(osmId, details);

    await prisma.venue
      .upsert({
        where: { placeId: osmId },
        update: { photoReference: details.url },
        create: {
          placeId: osmId,
          name,
          latitude: lat,
          longitude: lng,
          category: "cafe",
          photoReference: details.url,
        },
      })
      .catch((err: unknown) => {
        console.warn("[Pexels] DB cache write failed:", err);
      });

    return details;
  } catch (err) {
    console.error("[Pexels] getVenuePhotoDetails error:", err);
    return null;
  }
}

export async function getVenuePhotoUrl(
  osmId: string,
  name: string,
  lat: number,
  lng: number,
): Promise<string | null> {
  const details = await getVenuePhotoDetails(osmId, name, lat, lng);
  return details?.url ?? null;
}
