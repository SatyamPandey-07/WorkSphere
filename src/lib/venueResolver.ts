import type { Venue } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * A venue reference sent by the client. Search results come from our DB
 * (cuid `id`) or from OpenStreetMap (numeric `id`, sometimes a `placeId`),
 * so both identifiers are tried before anything is created.
 */
export interface VenueRef {
  id?: string | null;
  placeId?: string | null;
  name?: string | null;
  address?: string | null;
  category?: string | null;
  lat?: number | null;
  lng?: number | null;
  latitude?: number | null;
  longitude?: number | null;
}

const KNOWN_CATEGORIES = new Set([
  "cafe",
  "coworking",
  "coworking_space",
  "library",
  "restaurant",
  "hotel",
  "other",
]);

function normalizeCategory(category?: string | null): string {
  const value = (category || "").toLowerCase().trim();
  if (value === "coworking_space") return "coworking";
  return KNOWN_CATEGORIES.has(value) ? value : "cafe";
}

function toCoordinate(value: unknown, limit: number): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= limit
    ? n
    : null;
}

/**
 * Finds the venue a client payload refers to, creating it only when the
 * payload carries a real name and coordinates. Existing venues are never
 * overwritten with placeholder data.
 */
export async function resolveVenue(ref: VenueRef): Promise<Venue | null> {
  const id = ref.id?.toString().trim();
  const placeId = (ref.placeId || id)?.toString().trim();

  if (id) {
    const byId = await prisma.venue.findUnique({ where: { id } });
    if (byId) return byId;
  }
  if (placeId) {
    const byPlace = await prisma.venue.findUnique({ where: { placeId } });
    if (byPlace) return byPlace;
  }

  const latitude = toCoordinate(ref.latitude ?? ref.lat, 90);
  const longitude = toCoordinate(ref.longitude ?? ref.lng, 180);
  const name = ref.name?.trim();
  if (!placeId || latitude === null || longitude === null || !name) {
    return null;
  }
  // (0, 0) is almost always a missing-coordinate default, not a real venue.
  if (latitude === 0 && longitude === 0) return null;

  try {
    return await prisma.venue.create({
      data: {
        placeId,
        name: name.slice(0, 200),
        latitude,
        longitude,
        category: normalizeCategory(ref.category),
        address: ref.address?.slice(0, 500) || null,
      },
    });
  } catch (err: any) {
    // Another request created it concurrently.
    if (err?.code === "P2002") {
      return prisma.venue.findUnique({ where: { placeId } });
    }
    throw err;
  }
}
