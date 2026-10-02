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
