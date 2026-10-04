/**
 * Geographic utility functions for bearings, headings, and distance formatting.
 */

import { calculateHaversineDistance } from "@/lib/utils";

/**
 * Calculates the initial great-circle bearing (forward azimuth) from point 1 to point 2 in degrees (0 to 360).
 *
 * @param lat1 Latitude of point 1 in decimal degrees
 * @param lon1 Longitude of point 1 in decimal degrees
 * @param lat2 Latitude of point 2 in decimal degrees
 * @param lon2 Longitude of point 2 in decimal degrees
 * @returns Bearing in degrees (0 = North, 90 = East, 180 = South, 270 = West)
 */
export function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  const theta = Math.atan2(y, x);
  const bearing = ((theta * 180) / Math.PI + 360) % 360;
  return Number(bearing.toFixed(1));
}

/**
 * Calculates the relative bearing (clock-relative angle) to a target given the target's bearing
 * and the user's compass heading.
 *
 * Returns 0° if the user is facing directly toward the target,
 * 90° if the target is directly to the right,
 * 180° if behind, and 270° if directly to the left.
 *
 * @param targetBearing Absolute bearing to target in degrees (0 - 360)
 * @param deviceHeading Current compass heading of device in degrees (0 - 360)
 * @returns Relative angle in degrees (0 to 360)
 */
export function calculateRelativeBearing(
  targetBearing: number,
  deviceHeading: number,
): number {
  return ((targetBearing - deviceHeading) % 360 + 360) % 360;
}

export {
  formatDistance,
  formatWalkingBadgeWithUnit,
  detectDefaultDistanceUnit,
  getStoredDistanceUnit,
  setStoredDistanceUnit,
  type DistanceUnit,
} from "./geo/formatDistance";

/**
 * Converts a compass heading in degrees into a 16-point cardinal direction string.
 *
 * @param heading Heading in degrees (0 - 360)
 * @returns Cardinal direction string (e.g. "N", "NE", "E", "SW")
 */
export function getCompassDirection(heading: number | null): string {
  if (heading === null || !Number.isFinite(heading)) return "--";
  const directions = [
    "N", "NNE", "NE", "ENE",
    "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW",
    "W", "WNW", "NW", "NNW",
  ];
  const normalized = ((heading % 360) + 360) % 360;
  const index = Math.round(normalized / 22.5) % 16;
  return directions[index];
}

/**
 * Returns a human-friendly turn guidance description based on relative bearing.
 *
 * @param relativeBearing Relative bearing in degrees (0 - 360)
 * @returns Direction guidance string e.g. "Straight Ahead", "Turn Right", etc.
 */
export function getRelativeDirectionDescription(
  relativeBearing: number | null,
): string {
  if (relativeBearing === null || !Number.isFinite(relativeBearing)) return "";

  const norm = ((relativeBearing % 360) + 360) % 360;
  if (norm <= 22.5 || norm >= 337.5) {
    return "Straight Ahead";
  } else if (norm < 67.5) {
    return "Turn Slight Right";
  } else if (norm < 112.5) {
    return "Turn Right";
  } else if (norm < 157.5) {
    return "Turn Sharp Right";
  } else if (norm <= 202.5) {
    return "Behind You";
  } else if (norm < 247.5) {
    return "Turn Sharp Left";
  } else if (norm < 292.5) {
    return "Turn Left";
  } else {
    return "Turn Slight Left";
  }
}
