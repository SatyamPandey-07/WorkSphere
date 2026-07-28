/**
 * sunPosition.ts — Pure-math sun position calculations for outdoor seating.
 *
 * No external dependencies — implements the same core algorithm as the
 * `suncalc` npm package using NOAA solar geometry equations, so the bundle
 * stays lightweight and edge-runtime compatible.
 *
 * Reference: https://gml.noaa.gov/grad/solcalc/calcdetails.html
 */

export interface SunPosition {
  /** Altitude above the horizon in degrees (negative = below horizon) */
  altitude: number;
  /** True azimuth in degrees clockwise from North (0–360) */
  azimuth: number;
}

export type SunExposureLabel =
  | "Direct Sun"
  | "Partial Sun"
  | "Shaded"
  | "Night";

export interface SunExposureResult {
  label: SunExposureLabel;
  altitude: number;
  azimuth: number;
  uvRisk: "none" | "low" | "moderate" | "high" | "very-high";
  description: string;
  /** Whether this is considered peak UV hours in summer (used by ReasoningAgent) */
  isPeakUvSummer: boolean;
}

// ---------------------------------------------------------------------------
// Internal math helpers
// ---------------------------------------------------------------------------

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Julian Day Number from a UTC Date */
function julianDay(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Julian century from J2000.0 */
function julianCentury(jd: number): number {
  return (jd - 2451545.0) / 36525.0;
}

/** Geometric mean longitude of the sun in degrees */
function sunGeomMeanLongDeg(t: number): number {
  return (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
}

/** Geometric mean anomaly of the sun in degrees */
function sunGeomMeanAnomDeg(t: number): number {
  return 357.52911 + t * (35999.05029 - 0.0001537 * t);
}

/** Eccentricity of earth's orbit */
function earthOrbitEccentricity(t: number): number {
  return 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
}

/** Sun equation of centre in degrees */
function sunEqOfCentre(t: number): number {
  const m = toRad(sunGeomMeanAnomDeg(t));
  return (
    Math.sin(m) * (1.9146 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.00029
  );
}

/** Sun true longitude in degrees */
function sunTrueLongDeg(t: number): number {
  return sunGeomMeanLongDeg(t) + sunEqOfCentre(t);
}

/** Sun apparent longitude in degrees */
function sunApparentLongDeg(t: number): number {
  const o = sunTrueLongDeg(t);
  const omega = 125.04 - 1934.136 * t;
  return o - 0.00569 - 0.00478 * Math.sin(toRad(omega));
}

/** Mean obliquity of the ecliptic in degrees */
function meanObliquityOfEcliptic(t: number): number {
  const seconds =
    21.448 -
    t * (46.815 + t * (0.00059 - t * 0.001813));
  return 23.0 + (26.0 + seconds / 60.0) / 60.0;
}

/** Corrected obliquity in degrees */
function obliquityCorrection(t: number): number {
  const e0 = meanObliquityOfEcliptic(t);
  const omega = 125.04 - 1934.136 * t;
  return e0 + 0.00256 * Math.cos(toRad(omega));
}

/** Sun declination in degrees */
function sunDeclinationDeg(t: number): number {
  const e = toRad(obliquityCorrection(t));
  const lambda = toRad(sunApparentLongDeg(t));
  return toDeg(Math.asin(Math.sin(e) * Math.sin(lambda)));
}

/** Equation of time in minutes */
function equationOfTimeMinutes(t: number): number {
  const e = earthOrbitEccentricity(t);
  const epsilon = toRad(obliquityCorrection(t));
  const l0 = toRad(sunGeomMeanLongDeg(t));
  const m = toRad(sunGeomMeanAnomDeg(t));
  const y = Math.tan(epsilon / 2) ** 2;
  return (
    4 *
    toDeg(
      y * Math.sin(2 * l0) -
        2 * e * Math.sin(m) +
        4 * e * y * Math.sin(m) * Math.cos(2 * l0) -
        0.5 * y * y * Math.sin(4 * l0) -
        1.25 * e * e * Math.sin(2 * m),
    )
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calculate the sun's altitude and azimuth for a given location and time.
 *
 * @param latitude  Venue latitude in decimal degrees
 * @param longitude Venue longitude in decimal degrees
 * @param date      Moment to calculate for (defaults to now)
 */
export function calculateSunPosition(
  latitude: number,
  longitude: number,
  date: Date = new Date(),
): SunPosition {
  const jd = julianDay(date);
  const t = julianCentury(jd);

  // True solar time in minutes
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const eot = equationOfTimeMinutes(t);
  const trueSolarTime =
    ((utcMinutes + eot + 4 * longitude) % 1440) + (utcMinutes < 0 ? 1440 : 0);

  // Hour angle
  const hourAngleDeg =
    trueSolarTime / 4 < 0
      ? trueSolarTime / 4 + 180
      : trueSolarTime / 4 - 180;
  const ha = toRad(hourAngleDeg);

  const latRad = toRad(latitude);
  const decl = toRad(sunDeclinationDeg(t));

  // Solar zenith
  const cosZenith =
    Math.sin(latRad) * Math.sin(decl) +
    Math.cos(latRad) * Math.cos(decl) * Math.cos(ha);
  const zenithRad = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  const altitude = 90 - toDeg(zenithRad);

  // Azimuth (0–360, clockwise from North)
  const cosAz =
    (Math.sin(latRad) * Math.cos(zenithRad) - Math.sin(decl)) /
    (Math.cos(latRad) * Math.sin(zenithRad));
  let azimuth = toDeg(Math.acos(Math.min(1, Math.max(-1, cosAz))));
  if (hourAngleDeg > 0) {
    azimuth = 360 - azimuth;
  }

  return { altitude, azimuth };
}

/**
 * Estimate UV risk level from sun altitude (rough NOAA model).
 * Returns "none" at night and scales up through "very-high" at solar noon.
 */
export function estimateUvRisk(
  altitude: number,
): "none" | "low" | "moderate" | "high" | "very-high" {
  if (altitude <= 0) return "none";
  if (altitude < 15) return "low";
  if (altitude < 35) return "moderate";
  if (altitude < 55) return "high";
  return "very-high";
}

/**
 * Returns a human-readable sun exposure label and description for a venue
 * patio, given the venue's coordinates and an optional time.
 *
 * @param latitude   Venue latitude in decimal degrees
 * @param longitude  Venue longitude in decimal degrees
 * @param date       Observation time (defaults to now)
 */
export function getSunExposure(
  latitude: number,
  longitude: number,
  date: Date = new Date(),
): SunExposureResult {
  const { altitude, azimuth } = calculateSunPosition(latitude, longitude, date);
  const uvRisk = estimateUvRisk(altitude);

  const month = date.getUTCMonth(); // 0 = Jan, 11 = Dec
  const isSummerHemisphere =
    latitude >= 0
      ? month >= 4 && month <= 8   // Northern summer: May–Sep
      : month >= 10 || month <= 2; // Southern summer: Nov–Mar

  const isPeakUvSummer =
    isSummerHemisphere && altitude > 40;

  let label: SunExposureLabel;
  let description: string;

  if (altitude <= 0) {
    label = "Night";
    description = "Sun is below the horizon. Outdoor seating is in darkness.";
  } else if (altitude < 10) {
    label = "Partial Sun";
    description =
      "Sun is low on the horizon — expect dappled light or long shadows.";
  } else if (altitude < 35) {
    label = "Partial Sun";
    description = `Sun at ${altitude.toFixed(0)}° — outdoor patio will have morning/evening light but not harsh glare.`;
  } else {
    label = "Direct Sun";
    description = `Sun at ${altitude.toFixed(0)}° — outdoor seating is in full direct sun. UV risk: ${uvRisk}.${isPeakUvSummer ? " Peak UV hours — consider an umbrella." : ""}`;
  }

  return { label, altitude, azimuth, uvRisk, description, isPeakUvSummer };
}

/**
 * Returns a CSS-friendly colour token for the sun exposure badge.
 */
export function sunExposureColour(label: SunExposureLabel): {
  bg: string;
  text: string;
  darkBg: string;
  darkText: string;
} {
  switch (label) {
    case "Direct Sun":
      return {
        bg: "bg-amber-100",
        text: "text-amber-800",
        darkBg: "dark:bg-amber-900/30",
        darkText: "dark:text-amber-300",
      };
    case "Partial Sun":
      return {
        bg: "bg-yellow-50",
        text: "text-yellow-700",
        darkBg: "dark:bg-yellow-900/20",
        darkText: "dark:text-yellow-400",
      };
    case "Shaded":
      return {
        bg: "bg-blue-50",
        text: "text-blue-700",
        darkBg: "dark:bg-blue-900/20",
        darkText: "dark:text-blue-400",
      };
    case "Night":
    default:
      return {
        bg: "bg-zinc-100",
        text: "text-zinc-500",
        darkBg: "dark:bg-zinc-800",
        darkText: "dark:text-zinc-400",
      };
  }
}
