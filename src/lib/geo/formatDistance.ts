/**
 * Distance Unit and Locale Formatting Utilities (#3775)
 */

export type DistanceUnit = "METRIC" | "IMPERIAL";

export const KM_TO_MILES = 0.621371;
export const MILES_TO_KM = 1.609344;
export const METERS_TO_FEET = 3.28084;

export const DISTANCE_UNIT_STORAGE_KEY = "worksphere_distance_unit";

/**
 * Countries/locales that predominantly use imperial units (miles).
 * US, UK, Myanmar (MM), Liberia (LR).
 */
const IMPERIAL_REGIONS = new Set([
  "US", // United States
  "GB", // United Kingdom
  "LR", // Liberia
  "MM", // Myanmar
]);

/**
 * Auto-detects default distance unit preference based on user locale / language.
 * Defaults to "IMPERIAL" for US/GB locales and "METRIC" everywhere else.
 *
 * @param locale Optional locale string (e.g. "en-US", "en-GB", "fr-FR", "de")
 * @returns "METRIC" | "IMPERIAL"
 */
export function detectDefaultDistanceUnit(locale?: string): DistanceUnit {
  let lang = locale;
  if (!lang && typeof navigator !== "undefined" && navigator.language) {
    lang = navigator.language;
  }

  if (!lang) {
    return "METRIC";
  }

  const parts = lang.split(/[-_]/);
  const regionCandidate = parts
    .slice(1)
    .find((p) => /^[A-Za-z]{2}$/.test(p) || /^\d{3}$/.test(p));
  const region = (regionCandidate ?? parts[parts.length - 1]).toUpperCase();

  if (IMPERIAL_REGIONS.has(region) || lang.toUpperCase() === "EN-US" || lang.toUpperCase() === "EN-GB") {
    return "IMPERIAL";
  }

  return "METRIC";
}

/**
 * Retrieves the user's distance unit preference from localStorage with locale auto-detection on first visit.
 */
export function getStoredDistanceUnit(): DistanceUnit {
  if (typeof window === "undefined") {
    return "METRIC";
  }

  try {
    const stored = localStorage.getItem(DISTANCE_UNIT_STORAGE_KEY);
    if (stored === "METRIC" || stored === "IMPERIAL") {
      return stored;
    }

    // First visit: Auto-detect and save
    const detected = detectDefaultDistanceUnit();
    localStorage.setItem(DISTANCE_UNIT_STORAGE_KEY, detected);
    return detected;
  } catch {
    return detectDefaultDistanceUnit();
  }
}

/**
 * Stores the user's distance unit preference to localStorage and dispatches a storage event.
 */
export function setStoredDistanceUnit(unit: DistanceUnit): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DISTANCE_UNIT_STORAGE_KEY, unit);
    window.dispatchEvent(new CustomEvent("worksphere_distance_unit_change", { detail: unit }));
  } catch {
    // Ignore storage errors in private browsing
  }
}

/**
 * Formats a distance into a human-readable string based on the selected unit.
 *
 * Examples:
 *   formatDistance(1.2, "METRIC") -> "1.2 km"
 *   formatDistance(0.5, "METRIC") -> "500 m"
 *   formatDistance(0.045, "METRIC") -> "45 m"
 *   formatDistance(1.2, "IMPERIAL") -> "0.7 mi" (or "0.8 mi" if converted)
 *   formatDistance(0.1, "IMPERIAL") -> "328 ft" (or "0.1 mi" depending on options)
 *
 * @param distanceKm Distance in kilometers
 * @param unit "METRIC" | "IMPERIAL" (defaults to getStoredDistanceUnit())
 * @param options.fractionDigits Number of decimal places (default 1)
 * @param options.useSubUnits Whether to show meters/feet for short distances (<1km or <0.1mi)
 */
export function formatDistance(
  distanceKm: number,
  unit?: DistanceUnit,
  options: {
    fractionDigits?: number;
    useSubUnits?: boolean;
  } = {},
): string {
  if (isNaN(distanceKm) || !Number.isFinite(distanceKm) || distanceKm < 0) {
    return "--";
  }

  const activeUnit = unit ?? (typeof window !== "undefined" ? getStoredDistanceUnit() : "METRIC");
  const fractionDigits = options.fractionDigits ?? 1;
  const useSubUnits = options.useSubUnits ?? true;

  if (activeUnit === "IMPERIAL") {
    const miles = distanceKm * KM_TO_MILES;
    if (useSubUnits && miles < 0.1) {
      const feet = Math.round(distanceKm * 1000 * METERS_TO_FEET);
      return `${feet} ft`;
    }
    return `${miles.toFixed(fractionDigits)} mi`;
  }

  // Metric
  const meters = distanceKm * 1000;
  if (useSubUnits && meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${distanceKm.toFixed(fractionDigits)} km`;
}

/**
 * Formats walking time badge respecting user's distance unit preference.
 * e.g. "15 min walk · 1.2 km" or "15 min walk · 0.8 mi"
 */
export function formatWalkingBadgeWithUnit(
  distanceKm: number,
  unit?: DistanceUnit,
): string {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return "--";

  // 4.8 km/h = 0.08 km/min
  const mins = Math.max(1, Math.ceil(distanceKm / 0.08));
  const formattedDist = formatDistance(distanceKm, unit);
  return `${mins} min walk · ${formattedDist}`;
}
