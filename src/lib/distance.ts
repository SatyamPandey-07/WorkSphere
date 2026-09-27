export type DistanceUnit = "mi" | "km";

export const DISTANCE_UNIT_KEY = "worksphere-distance-unit";

/**
 * Haversine formula — great-circle distance between two lat/lng points.
 * Returns distance in kilometres.
 */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Formats distance and estimated walking time for display on a venue badge.
 *
 * @param km - distance in kilometres
 * @param unit - "mi" or "km"
 * @returns e.g. "0.4 mi · 8 min walk"
 */
export function formatDistanceBadge(km: number, unit: DistanceUnit): string {
  const KM_PER_MI = 1.60934;
  const WALK_SPEED_KM_H = 5; // average walking speed

  const displayValue =
    unit === "mi"
      ? `${(km / KM_PER_MI).toFixed(1)} mi`
      : `${km.toFixed(1)} km`;

  const walkMinutes = Math.round((km / WALK_SPEED_KM_H) * 60);
  const timeLabel = walkMinutes < 1 ? "< 1 min walk" : `${walkMinutes} min walk`;

  return `${displayValue} · ${timeLabel}`;
}

export function getStoredDistanceUnit(): DistanceUnit {
  if (typeof window === "undefined") return "mi";
  const stored = window.localStorage.getItem(DISTANCE_UNIT_KEY);
  return stored === "km" ? "km" : "mi";
}

export function setStoredDistanceUnit(unit: DistanceUnit): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(DISTANCE_UNIT_KEY, unit);
  }
}
