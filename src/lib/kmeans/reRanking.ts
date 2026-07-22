/**
 * Venue re-ranking utilities (#1127)
 */

import type { AmenityVector } from "./types";
import { venueToVector, type VenueLike } from "./vectorUtils";

export function venuesToVectorArray(
  venues: Array<VenueLike & { id: string }>,
): Array<{ id: string; vector: AmenityVector }> {
  const result: Array<{ id: string; vector: AmenityVector }> = [];
  for (const venue of venues) {
    if (!venue.id) continue;
    result.push({ id: venue.id, vector: venueToVector(venue) });
  }
  return result;
}
