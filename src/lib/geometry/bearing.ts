/**
 * Bearing and Angle Normalization Utilities (#4373)
 *
 * Provides angular calculations and shortest-arc interpolation for AR pointers and compass navigation.
 */

/**
 * Normalizes any angle in degrees to the standard [0, 360) range.
 *
 * Examples:
 *   normalizeAngle(-45) -> 315
 *   normalizeAngle(370) -> 10
 *   normalizeAngle(720) -> 0
 *
 * @param angle Angle in degrees
 * @returns Normalized angle in degrees in [0, 360)
 */
export function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle) || isNaN(angle)) return 0;
  return ((angle % 360) + 360) % 360;
}

/**
 * Calculates the shortest angular difference (delta) from one angle to another in degrees [-180, 180].
 * Positive means clockwise rotation, negative means counter-clockwise rotation.
 *
 * Examples:
 *   shortestArcDelta(350, 10) -> 20 (rotate +20° CW across 0/360 boundary)
 *   shortestArcDelta(10, 350) -> -20 (rotate -20° CCW across 0/360 boundary)
 *   shortestArcDelta(0, 180)  -> 180
 *
 * @param fromAngle Starting angle in degrees
 * @param toAngle Destination angle in degrees
 * @returns Shortest rotation delta in degrees [-180, 180]
 */
export function shortestArcDelta(fromAngle: number, toAngle: number): number {
  const normFrom = normalizeAngle(fromAngle);
  const normTo = normalizeAngle(toAngle);
  let diff = (normTo - normFrom) % 360;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return diff;
}

/**
 * Interpolates smoothly between two angles along the shortest arc.
 *
 * @param fromAngle Starting angle in degrees
 * @param toAngle Destination angle in degrees
 * @param t Interpolation factor (0 = fromAngle, 1 = toAngle)
 * @returns Interpolated angle in degrees in [0, 360)
 */
export function interpolateAngleShortestArc(
  fromAngle: number,
  toAngle: number,
  t: number,
): number {
  const delta = shortestArcDelta(fromAngle, toAngle);
  if (Number.isNaN(t)) return normalizeAngle(fromAngle);
  const clampedT = Math.max(0, Math.min(1, t));
  return normalizeAngle(fromAngle + delta * clampedT);
}

/**
 * Calculates relative bearing angle from target bearing and device compass heading.
 *
 * @param targetBearing Destination bearing in degrees [0, 360)
 * @param deviceHeading Current compass heading in degrees [0, 360)
 * @returns Relative azimuth angle in degrees [0, 360)
 */
export function calculateRelativeAzimuth(
  targetBearing: number,
  deviceHeading: number,
): number {
  if (!Number.isFinite(targetBearing) || !Number.isFinite(deviceHeading))
    return 0;
  return normalizeAngle(targetBearing - deviceHeading);
}
