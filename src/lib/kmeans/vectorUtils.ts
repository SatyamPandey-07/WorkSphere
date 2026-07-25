/**
 * Venue-to-AmenityVector conversion utilities (#1127)
 */

import { type AmenityVector, KMEANS_DIMENSIONS } from "./types";
import { clamp01, createNeutralVector } from "./mathUtils";

export interface VenueLike {
  wifiQuality?: number | null;
  hasOutlets?: boolean | null;
  outletDensity?: string | null;
  noiseLevel?: string | null;
  hasErgonomic?: boolean | null;
  hasPhoneBooths?: boolean | null;
  hasNoMusic?: boolean | null;
  hasQuietZone?: boolean | null;
  hasAncHeadsetRental?: boolean | null;
  lighting?: string | null;
  currentOccupancy?: number | null;
  rating?: number | null;
}

const OUTLET_DENSITY_MAP: Record<string, number> = {
  every_table: 1.0,
  some_tables: 0.66,
  wall_seats: 0.33,
  none: 0,
};

const NOISE_LEVEL_MAP: Record<string, number> = {
  quiet: 1.0,
  moderate: 0.5,
  loud: 0,
};

const LIGHTING_MAP: Record<string, number> = {
  bright: 1.0,
  natural: 0.5,
  dim: 0,
};

function boolToNumber(val: boolean | null | undefined): number {
  return val === true ? 1 : 0;
}

function normalizeEnum(
  val: string | null | undefined,
  mapping: Record<string, number>,
  fallback: number = 0.5,
): number {
  if (val === null || val === undefined) return fallback;
  return mapping[val.toLowerCase()] ?? fallback;
}

export function venueToVector(venue: VenueLike): AmenityVector {
  return {
    wifiQuality: clamp01((venue.wifiQuality ?? 5) / 10),
    hasOutlets: boolToNumber(venue.hasOutlets),
    outletDensity: normalizeEnum(venue.outletDensity, OUTLET_DENSITY_MAP, 0.5),
    noiseLevel: normalizeEnum(venue.noiseLevel, NOISE_LEVEL_MAP, 0.5),
    hasErgonomic: boolToNumber(venue.hasErgonomic),
    hasPhoneBooths: boolToNumber(venue.hasPhoneBooths),
    hasNoMusic: boolToNumber(venue.hasNoMusic),
    hasQuietZone: boolToNumber(venue.hasQuietZone),
    hasAncHeadsetRental: boolToNumber(venue.hasAncHeadsetRental),
    lighting: normalizeEnum(venue.lighting, LIGHTING_MAP, 0.5),
    currentOccupancy: clamp01((venue.currentOccupancy ?? 50) / 100),
    rating: clamp01((venue.rating ?? 3) / 5),
  };
}

export function venuesToVectors(
  venues: Array<VenueLike & { id: string }>,
): Array<{ id: string; vector: AmenityVector }> {
  const result: Array<{ id: string; vector: AmenityVector }> = [];
  for (const venue of venues) {
    if (!venue.id) continue;
    result.push({ id: venue.id, vector: venueToVector(venue) });
  }
  return result;
}

export function deduplicateVectors(
  items: Array<{ id: string; vector: AmenityVector }>,
): Array<{ id: string; vector: AmenityVector }> {
  const seen = new Set<string>();
  const unique: Array<{ id: string; vector: AmenityVector }> = [];
  for (const item of items) {
    const key = KMEANS_DIMENSIONS.map((d) => item.vector[d].toFixed(4)).join(
      ",",
    );
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }
  return unique;
}

export function padWithNeutralVectors(
  existingVectors: AmenityVector[],
  targetCount: number,
): AmenityVector[] {
  const result = [...existingVectors];
  let seed = 42;
  const seededRandom = (): number => {
    seed = (seed * 16807 + 0) % 2147483647;
    return seed / 2147483647;
  };
  while (result.length < targetCount) {
    result.push(createNeutralVector(0.05, seededRandom));
  }
  return result;
}
