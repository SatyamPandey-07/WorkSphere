import {
  calculateHaversineDistance,
  clampLatitude,
  clampLongitude,
  isValidCoordinate,
} from "@/lib/utils";
import { type DistanceUnit } from "./geo/formatDistance";

export type DistanceCalculationUnit =
  | "km"
  | "kilometers"
  | "miles"
  | "mi"
  | "meters"
  | "m"
  | "walking_minutes";

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
 * @returns Distance in kilometers.
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

/**
 * Calculates great-circle distance with multi-unit conversion support:
 * - kilometers ("km" or "kilometers")
 * - miles ("miles" or "mi")
 * - meters ("meters" or "m")
 * - walking minutes at 4.8 km/h ("walking_minutes")
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  unit: DistanceCalculationUnit = "km",
): number {
  const km = haversineKm(lat1, lon1, lat2, lon2);
  if (isNaN(km)) return NaN;

  switch (unit) {
    case "miles":
    case "mi":
      return haversineMiles(lat1, lon1, lat2, lon2);
    case "meters":
    case "m":
      return km * 1000;
    case "walking_minutes":
      return getWalkingMinutes(km);
    case "km":
    case "kilometers":
    default:
      return km;
  }
}

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
  const meters = Math.round(km * 1000);
  const distance =
    meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${meters}m`;
  return `${mins} min walk · ${distance}`;
}

export interface LocationCoordinates {
  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;
}

/**
 * Sorts venues by proximity to the user's GPS coordinates using the Haversine formula.
 */
export function sortVenuesByProximity<T extends LocationCoordinates>(
  venues: T[],
  userLocation: { lat: number; lng: number } | null | undefined,
): T[] {
  if (!userLocation || !isValidCoordinate(userLocation.lat, userLocation.lng)) {
    return venues;
  }

  return [...venues].sort((a, b) => {
    const aLat = a.latitude ?? a.lat;
    const aLon = a.longitude ?? a.lng;
    const bLat = b.latitude ?? b.lat;
    const bLon = b.longitude ?? b.lng;

    const distA =
      aLat != null && aLon != null
        ? haversineKm(userLocation.lat, userLocation.lng, aLat, aLon)
        : Infinity;
    const distB =
      bLat != null && bLon != null
        ? haversineKm(userLocation.lat, userLocation.lng, bLat, bLon)
        : Infinity;

    return distA - distB;
  });
}

/**
 * Filters venues within a maximum radius (in kilometers) from the user's location.
 */
export function filterVenuesByRadius<T extends LocationCoordinates>(
  venues: T[],
  userLocation: { lat: number; lng: number } | null | undefined,
  maxDistanceKm: number,
): T[] {
  if (!maxDistanceKm || maxDistanceKm <= 0 || !userLocation) {
    return venues;
  }

  return venues.filter((venue) => {
    const vLat = venue.latitude ?? venue.lat;
    const vLon = venue.longitude ?? venue.lng;
    if (vLat == null || vLon == null) return false;

    const dist = haversineKm(userLocation.lat, userLocation.lng, vLat, vLon);
    return dist <= maxDistanceKm;
  });
}

export {
  calculateHaversineDistance,
  clampLatitude,
  clampLongitude,
  isValidCoordinate,
};
