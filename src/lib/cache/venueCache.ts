// src/lib/cache/venueCache.ts

import { prisma } from "@/lib/prisma";

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * Checks if a bounding box specifies valid coordinate bounds.
 */
export function isValidBoundingBox(bbox?: BoundingBox | null): bbox is BoundingBox {
  if (!bbox) return false;
  const { minLat, maxLat, minLng, maxLng } = bbox;
  return (
    Number.isFinite(minLat) &&
    Number.isFinite(maxLat) &&
    Number.isFinite(minLng) &&
    Number.isFinite(maxLng) &&
    !(minLat === 0 && maxLat === 0 && minLng === 0 && maxLng === 0)
  );
}

/**
 * Normalizes bounding box coordinates to fixed decimal precision for deterministic cache keys.
 */
export function normalizeBoundingBox(bbox: BoundingBox): string {
  return `${bbox.minLat.toFixed(4)}:${bbox.maxLat.toFixed(4)}:${bbox.minLng.toFixed(4)}:${bbox.maxLng.toFixed(4)}`;
}

/**
 * Retrieves the latest updatedAt timestamp for venues within the given geographic bounding box.
 * If no venues match or the table is empty, returns a stable deterministic fallback (0)
 * rather than a shifting request-time Date.now().
 */
export async function getLatestVenueTimestamp(bbox?: BoundingBox | null): Promise<number> {
  try {
    const whereClause: Record<string, unknown> = {};

    if (isValidBoundingBox(bbox)) {
      whereClause.latitude = { gte: bbox.minLat, lte: bbox.maxLat };
      whereClause.longitude = { gte: bbox.minLng, lte: bbox.maxLng };
    }

    const latestVenue = await prisma.venue.findFirst({
      where: whereClause,
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });

    if (latestVenue?.updatedAt) {
      return new Date(latestVenue.updatedAt).getTime();
    }

    // Deterministic fallback when no venues exist in bbox or DB is empty
    return 0;
  } catch (error) {
    console.error("[venueCache] Error fetching latest venue timestamp:", error);
    // Deterministic fallback to prevent unstable ETags across repeated errors
    return 0;
  }
}

/**
 * Generates an ETag string based on the timestamp and optional bounding box.
 * If bbox is supplied, the ETag includes a deterministic spatial hash.
 */
export function generateETag(timestamp: number, bbox?: BoundingBox | null): string {
  if (isValidBoundingBox(bbox)) {
    const bboxKey = normalizeBoundingBox(bbox);
    return `"${timestamp}-${bboxKey}"`;
  }
  return `"${timestamp}"`;
}
