/**
 * circadianLighting.ts
 * Astronomical circadian rhythm calculation engine for WorkSphere venues.
 * Evaluates local solar phase from latitude and timestamp, mapping to automated
 * lighting modes ("Bright Daylight Work" vs. "Warm Sunset Focus") for remote workers.
 */

import { calculateSolarPosition } from "./solarPosition";

export type CircadianLightingMode =
  "Bright Daylight Work" | "Warm Sunset Focus";

export type SolarPhase =
  "daylight" | "golden_hour" | "sunset" | "twilight" | "night";

export interface CircadianLightingStatus {
  mode: CircadianLightingMode;
  solarPhase: SolarPhase;
  solarElevation: number;
  colorTemperature: number;
  tooltip: string;
}

/**
 * Calculates the venue's local solar phase and current automated circadian lighting mode
 * based on latitude and timestamp.
 *
 * @param latitude Venue latitude in degrees (-90 to 90)
 * @param timestamp Local or UTC timestamp (Date, number epoch, or ISO string)
 * @param longitude Optional longitude in degrees (-180 to 180)
 */
export function calculateVenueSolarPhase(
  latitude: number,
  timestamp: Date | number | string = new Date(),
  longitude?: number,
): CircadianLightingStatus {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const validDate = isNaN(date.getTime()) ? new Date() : date;

  // If longitude is omitted, derive approximate local solar meridian from timezone offset
  // so local venue time calculations accurately reflect solar noon/sunset.
  const resolvedLng =
    typeof longitude === "number" && !isNaN(longitude)
      ? longitude
      : validDate.getTimezoneOffset
        ? -validDate.getTimezoneOffset() / 4
        : 0;

  const solar = calculateSolarPosition(latitude, resolvedLng, validDate);
  const elevation = solar.elevationDeg;

  // Determine solar phase
  let solarPhase: SolarPhase;
  if (elevation > 10) {
    solarPhase = "daylight";
  } else if (elevation > 0) {
    solarPhase = "golden_hour";
  } else if (elevation > -6) {
    solarPhase = "twilight";
  } else {
    solarPhase = "night";
  }

  // Circadian lighting mode:
  // - High solar angle (> 10 deg): Bright Daylight Work (~5500K) maximizes alertness & cognitive focus
  // - Low solar angle / night (<= 10 deg): Warm Sunset Focus (~2700K) minimizes blue-light melatonin disruption
  const isDaylightMode = elevation > 10;
  const mode: CircadianLightingMode = isDaylightMode
    ? "Bright Daylight Work"
    : "Warm Sunset Focus";
  const colorTemperature = isDaylightMode ? 5500 : 2700;

  const tooltip = isDaylightMode
    ? "Automated Circadian Lighting: Currently in Bright Daylight Work mode (~5500K). High-lux daylight spectrum tuned to maximize alertness and focus."
    : "Automated Circadian Lighting: Currently in Warm Sunset Focus mode (~2700K). Soft, warm amber spectrum designed to reduce eye strain and support evening melatonin production.";

  return {
    mode,
    solarPhase,
    solarElevation: elevation,
    colorTemperature,
    tooltip,
  };
}

export const calculateSolarPhase = calculateVenueSolarPhase;

/**
 * Checks if a venue supports automated circadian lighting adjustments.
 */
export function supportsCircadianLighting(
  venue?: {
    lighting?: string | null;
    hasCircadianLighting?: boolean;
    supportsCircadianLighting?: boolean;
    circadianLighting?: boolean;
    amenities?: {
      circadianLighting?: boolean;
      circadian?: boolean;
      lighting?: string | null;
      [key: string]: unknown;
    } | null;
    [key: string]: unknown;
  } | null,
): boolean {
  if (!venue) return false;
  if (venue.hasCircadianLighting === true) return true;
  if (venue.supportsCircadianLighting === true) return true;
  if (venue.circadianLighting === true) return true;
  if (typeof venue.lighting === "string" && /circadian/i.test(venue.lighting))
    return true;
  if (venue.amenities) {
    if (
      venue.amenities.circadianLighting === true ||
      venue.amenities.circadian === true
    )
      return true;
    if (
      typeof venue.amenities.lighting === "string" &&
      /circadian/i.test(venue.amenities.lighting)
    )
      return true;
  }
  return false;
}
