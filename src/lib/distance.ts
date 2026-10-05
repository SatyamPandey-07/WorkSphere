import {
  calculateHaversineDistance,
  clampLatitude,
  clampLongitude,
  isValidCoordinate,
} from "@/lib/utils";

/**
 * Great-circle distance between two points on the Earth's surface, in kilometers.
 *
 * Coordinates outside valid ranges ([-90, 90] for latitude, [-180, 180] for longitude)
 * are clamped to prevent NaN and ensure numeric stability.
 *
 * Delegates to `calculateHaversineDistance`, which applies the haversine formula:
 *
 *   dLat = (lat2 - lat1) in radians
 *   dLon = (lon2 - lon1) in radians
 *   a    = sin²(dLat / 2) + cos(lat1) * cos(lat2) * sin²(dLon / 2)
 *   c    = 2 * atan2(sqrt(a), sqrt(1 - a))
 *   d    = R * c
 *
 * with R = 6371 km (mean Earth radius).
 *
 * @param lat1 Latitude of the first point, in degrees (-90 to 90).
 * @param lon1 Longitude of the first point, in degrees (-180 to 180).
 * @param lat2 Latitude of the second point, in degrees (-90 to 90).
 * @param lon2 Longitude of the second point, in degrees (-180 to 180).
 * @returns Distance in kilometers. Identical points return 0; antipodal points
 *   return roughly 20015 km. A non-numeric argument propagates as NaN.
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
 * The same great-circle distance as {@link haversineKm}, expressed in miles.
 *
 * Uses the international mile (1 mile = 1.609344 km), so the conversion factor is
 * 1 / 1.609344 = 0.621371.
 *
 * @param lat1 Latitude of the first point, in degrees (-90 to 90).
 * @param lon1 Longitude of the first point, in degrees (-180 to 180).
 * @param lat2 Latitude of the second point, in degrees (-90 to 90).
 * @param lon2 Longitude of the second point, in degrees (-180 to 180).
 * @returns Distance in statute miles (not nautical miles).
 */
export function haversineMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const km = haversineKm(lat1, lon1, lat2, lon2);
  if (isNaN(km)) return NaN;
  return km * 0.621371;
}

export {
  calculateHaversineDistance,
  clampLatitude,
  clampLongitude,
  isValidCoordinate,
};

/**
 * Estimated walking time for a distance, rounded up to the next whole minute.
 *
 * Assumes a flat walking speed of 4.8 km/h, which is 0.08 km per minute. The
 * result is rounded up so that a short walk is never reported as zero minutes.
 *
 * @param km Distance in kilometers.
 * @returns Whole minutes of walking.
 */
export function getWalkingMinutes(km: number): number {
  // 4.8 km/h = 4.8 / 60 km/min = 0.08 km/min
  if (!Number.isFinite(km) || km <= 0) return 0;
  return Math.ceil(km / 0.08);
}

import { type DistanceUnit } from "./geo/formatDistance";

/**
 * Formats a walking-time badge for a distance, combining the minutes from
 * {@link getWalkingMinutes} with a human-readable distance label.
 *
 * Supports optional distanceUnit parameter ("METRIC" | "IMPERIAL") or defaults to metric.
 *
 * @param km Distance in kilometers.
 * @param unit Optional "METRIC" | "IMPERIAL" unit preference
 * @returns A badge string such as "15 min walk · 1.2km" or "15 min walk · 0.8mi".
 */
export function formatWalkingTimeBadge(
  km: number,
  unit?: DistanceUnit,
): string {
  if (km == null || !Number.isFinite(km) || isNaN(km) || km < 0) return "--";
  const mins = getWalkingMinutes(km);
  if (unit === "IMPERIAL") {
    const miles = km * 0.621371;
    return `${mins} min walk · ${miles.toFixed(1)}mi`;
  }
  const distance = km >= 1 ? `${km.toFixed(1)}km` : `${Math.round(km * 1000)}m`;
  return `${mins} min walk · ${distance}`;
}
