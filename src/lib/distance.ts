import { calculateHaversineDistance } from "@/lib/utils";

/**
 * Calculates the Haversine distance between two coordinates in kilometers.
 *
 * @param lat1 Latitude of point 1
 * @param lon1 Longitude of point 1
 * @param lat2 Latitude of point 2
 * @param lon2 Longitude of point 2
 * @returns Distance in kilometers
 */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  return calculateHaversineDistance(lat1, lon1, lat2, lon2);
}

/**
 * Calculates the Haversine distance between two coordinates in miles.
 */
export function haversineMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  return haversineKm(lat1, lon1, lat2, lon2) * 0.621371;
}

/**
 * Calculates estimated walking minutes for a given distance in kilometers,
 * assuming a standard walking speed of 4.8 km/h.
 */
export function getWalkingMinutes(km: number): number {
  // 4.8 km/h = 4.8 / 60 km/min = 0.08 km/min
  return Math.ceil(km / 0.08);
}

/**
 * Formats a walking time badge string (e.g. "8 min walk · 650m" or "15 min walk · 1.2km").
 */
export function formatWalkingTimeBadge(km: number): string {
  const mins = getWalkingMinutes(km);
  const distance = km >= 1 ? `${km.toFixed(1)}km` : `${Math.round(km * 1000)}m`;
  return `${mins} min walk · ${distance}`;
}
