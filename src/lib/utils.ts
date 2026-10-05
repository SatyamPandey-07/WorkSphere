import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Clamps latitude to valid geographic bounds [-90, 90].
 */
export function clampLatitude(lat: number): number {
  if (isNaN(lat)) return NaN;
  return Math.max(-90, Math.min(90, lat));
}

/**
 * Clamps longitude to valid geographic bounds [-180, 180].
 */
export function clampLongitude(lon: number): number {
  if (isNaN(lon)) return NaN;
  return Math.max(-180, Math.min(180, lon));
}

/**
 * Validates whether latitude and longitude are valid finite numbers within bounds.
 */
export function isValidCoordinate(lat: number, lon: number): boolean {
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    !isNaN(lat) &&
    !isNaN(lon) &&
    isFinite(lat) &&
    isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/**
 * Calculates the Haversine distance between two points on the Earth.
 * Coordinates outside valid ranges ([-90, 90] for latitude, [-180, 180] for longitude)
 * are clamped to avoid NaN or mathematical errors.
 *
 * @param lat1 Latitude of the first point in decimal degrees
 * @param lon1 Longitude of the first point in decimal degrees
 * @param lat2 Latitude of the second point in decimal degrees
 * @param lon2 Longitude of the second point in decimal degrees
 * @returns The distance between the two points in kilometers, or NaN if non-numeric/NaN is provided
 */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  if (
    lat1 === undefined ||
    lon1 === undefined ||
    lat2 === undefined ||
    lon2 === undefined ||
    isNaN(Number(lat1)) ||
    isNaN(Number(lon1)) ||
    isNaN(Number(lat2)) ||
    isNaN(Number(lon2))
  ) {
    return NaN;
  }

  const safeLat1 = clampLatitude(Number(lat1));
  const safeLon1 = clampLongitude(Number(lon1));
  const safeLat2 = clampLatitude(Number(lat2));
  const safeLon2 = clampLongitude(Number(lon2));

  const R = 6371; // Earth's radius in kilometers
  const dLat = ((safeLat2 - safeLat1) * Math.PI) / 180;
  const dLon = ((safeLon2 - safeLon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((safeLat1 * Math.PI) / 180) *
      Math.cos((safeLat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
