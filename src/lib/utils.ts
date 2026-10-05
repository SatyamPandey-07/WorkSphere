import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Clamps latitude to valid geographic bounds [-90, 90].
 */
export function clampLatitude(lat: number): number {
  if (
    lat === null ||
    lat === undefined ||
    typeof lat !== "number" ||
    isNaN(lat)
  ) {
    return NaN;
  }
  return Math.max(-90, Math.min(90, lat));
}

/**
 * Clamps longitude to valid geographic bounds [-180, 180].
 */
export function clampLongitude(lon: number): number {
  if (
    lon === null ||
    lon === undefined ||
    typeof lon !== "number" ||
    isNaN(lon)
  ) {
    return NaN;
  }
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
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
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
    lat1 === null ||
    lon1 === undefined ||
    lon1 === null ||
    lat2 === undefined ||
    lat2 === null ||
    lon2 === undefined ||
    lon2 === null ||
    typeof lat1 !== "number" ||
    typeof lon1 !== "number" ||
    typeof lat2 !== "number" ||
    typeof lon2 !== "number" ||
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    return NaN;
  }

  const safeLat1 = clampLatitude(lat1);
  const safeLon1 = clampLongitude(lon1);
  const safeLat2 = clampLatitude(lat2);
  const safeLon2 = clampLongitude(lon2);

  if (
    !Number.isFinite(safeLat1) ||
    !Number.isFinite(safeLon1) ||
    !Number.isFinite(safeLat2) ||
    !Number.isFinite(safeLon2)
  ) {
    return NaN;
  }

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
