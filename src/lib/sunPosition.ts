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
  /** Solar zenith angle in degrees clamped between 0 and 180 */
  zenith: number;
  /** Whether the sun is currently above the horizon */
  isAboveHorizon: boolean;
  /** Altitude normalized to [0, 1] against a 90° zenith (clamped at 0 when below horizon) */
  normalizedAltitude: number;
}

export interface PatioShadeResult {
  shadePercentage: number;
  sunAltitude: number;
  sunAzimuth: number;
}

export type SunExposureLabel =
  "Direct Sun" | "Partial Sun" | "Shaded" | "Night";

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

/**
 * Clamps a solar zenith angle to the physically valid range [0, 180] degrees.
 */
export function clampZenith(zenithDeg: number): number {
  if (isNaN(zenithDeg) || !isFinite(zenithDeg)) return 90;
  return Math.min(180, Math.max(0, zenithDeg));
}

/**
 * Normalizes an azimuth angle to the range [0, 360) degrees.
 */
export function normalizeAzimuth(azimuthDeg: number): number {
  if (isNaN(azimuthDeg) || !isFinite(azimuthDeg)) return 0;
  return ((azimuthDeg % 360) + 360) % 360;
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
  const seconds = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813));
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
  const utcMinutes =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60 +
    date.getUTCMilliseconds() / 60000;
  const eot = equationOfTimeMinutes(t);
  const trueSolarTime =
    (((utcMinutes + eot + 4 * longitude) % 1440) + 1440) % 1440;

  // Hour angle
  const hourAngleDeg =
    trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180;
  const ha = toRad(hourAngleDeg);

  const latRad = toRad(latitude);
  const decl = toRad(sunDeclinationDeg(t));

  // Solar zenith
  const cosZenith =
    Math.sin(latRad) * Math.sin(decl) +
    Math.cos(latRad) * Math.cos(decl) * Math.cos(ha);
  const rawZenithRad = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  const rawZenithDeg = toDeg(rawZenithRad);
  const zenith = clampZenith(rawZenithDeg);
  const zenithRad = toRad(zenith);
  const altitude = 90 - zenith;

  // Azimuth (0–360, clockwise from North)
  const sinZenith = Math.sin(zenithRad);
  let azimuth: number;

  if (sinZenith === 0) {
    azimuth = latitude < 0 ? 0 : 180;
  } else {
    const cosAz =
      (Math.sin(latRad) * Math.cos(zenithRad) - Math.sin(decl)) /
      (Math.cos(latRad) * sinZenith);
    const gamma = toDeg(Math.acos(Math.min(1, Math.max(-1, cosAz))));

    if (hourAngleDeg > 0) {
      azimuth = (gamma + 180) % 360;
    } else {
      azimuth = (540 - gamma) % 360;
    }
  }

  // Normalize azimuth within [0, 360)
  azimuth = normalizeAzimuth(azimuth);

  return {
    altitude,
    azimuth,
    zenith,
    isAboveHorizon: altitude > 0,
    normalizedAltitude: Math.max(0, Math.min(1, altitude / 90)),
  };
}

/**
 * Estimate how shaded an outdoor patio is, given its orientation (the
 * compass direction, in degrees, the patio faces) relative to the sun.
 *
 * A patio facing directly toward the sun's azimuth gets the most direct
 * light (least shade); one facing away gets the most shade. Full shade
 * (100%) is returned whenever the sun is below the horizon.
 *
 * @param latitude       Venue latitude in decimal degrees
 * @param longitude      Venue longitude in decimal degrees
 * @param date           Observation time (defaults to now)
 * @param patioAzimuth   Compass direction the patio faces, in degrees (0–360)
 */
export function getPatioShadePercentage(
  latitude: number,
  longitude: number,
  date: Date = new Date(),
  patioAzimuth: number = 0,
): PatioShadeResult {
  const { altitude, azimuth, isAboveHorizon, normalizedAltitude } =
    calculateSunPosition(latitude, longitude, date);

  if (!isAboveHorizon) {
    return { shadePercentage: 100, sunAltitude: altitude, sunAzimuth: azimuth };
  }

  const angleDiff = Math.abs(
    ((((azimuth - patioAzimuth + 180) % 360) + 360) % 360) - 180,
  );
  // 1 when the patio faces the sun head-on, 0 when facing directly away
  const orientationFactor = (1 + Math.cos(toRad(angleDiff))) / 2;

  const shadePercentage = Math.max(
    0,
    Math.min(100, 100 - orientationFactor * normalizedAltitude * 100),
  );

  return { shadePercentage, sunAltitude: altitude, sunAzimuth: azimuth };
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
      ? month >= 4 && month <= 8 // Northern summer: May–Sep
      : month >= 10 || month <= 2; // Southern summer: Nov–Mar

  const isPeakUvSummer = isSummerHemisphere && altitude > 40;

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

// ---------------------------------------------------------------------------
// Optimal Natural Light Seating & Glare Avoidance Recommendation (#5064)
// ---------------------------------------------------------------------------

export const BEST_NATURAL_LIGHT_BADGE = "Best Natural Light";

export interface NaturalLightDeskInput {
  id: string;
  label?: string;
  /** Distance from perimeter window in meters or floor plan units (default: inferred from coordinates or row) */
  windowDistance?: number;
  /** Direction the desk or closest window faces in degrees (0–360, default: uses venueCompassOrientation) */
  facingOrientationDeg?: number;
  /** Normalized or spatial coordinate (0-indexed or meters) */
  x?: number;
  y?: number;
  row?: number;
  col?: number;
}

export interface NaturalLightRecommendationOptions {
  latitude: number;
  longitude: number;
  /** Compass orientation of venue window perimeter in degrees (0=N, 90=E, 180=S, 270=W). Default: 180 (South-facing) */
  venueCompassOrientation?: number;
  date?: Date;
  /** Glare threshold angle in degrees: solar angles narrower than this cause direct screen glare (default: 25) */
  glareAngleThresholdDeg?: number;
  /** Minimum sun altitude in degrees for usable natural daylight (default: 10) */
  minDaylightAltitudeDeg?: number;
}

export interface NaturalLightDeskRecommendation {
  deskId: string;
  isOptimalNaturalLight: boolean;
  badgeLabel?: typeof BEST_NATURAL_LIGHT_BADGE;
  relativeSunAngle: number; // Angle difference between sun azimuth and window orientation [0, 180]
  sunAltitude: number;
  sunAzimuth: number;
  daylightQuality: "optimal" | "glare" | "dim" | "shaded" | "night";
  score: number; // 0 to 1 daylight comfort score
  reason: string;
}

/**
 * Computes current sun angle relative to venue compass orientation in degrees [0, 180].
 * 0° means the sun is directly aligned with the venue orientation; 180° means directly opposite.
 */
export function computeRelativeSunAngle(
  sunAzimuth: number,
  venueOrientationDeg: number,
): number {
  return Math.abs(
    ((((sunAzimuth - venueOrientationDeg + 180) % 360) + 360) % 360) - 180,
  );
}

/**
 * Recommends desks offering optimal natural daylight while avoiding direct solar glare
 * based on current solar geometry and venue compass orientation (#5064).
 */
export function recommendNaturalLightDesks(
  desks: NaturalLightDeskInput[],
  options: NaturalLightRecommendationOptions,
): NaturalLightDeskRecommendation[] {
  const {
    latitude,
    longitude,
    venueCompassOrientation = 180,
    date = new Date(),
    glareAngleThresholdDeg = 25,
    minDaylightAltitudeDeg = 10,
  } = options;

  const sun = calculateSunPosition(latitude, longitude, date);
  const relativeSunAngle = computeRelativeSunAngle(
    sun.azimuth,
    venueCompassOrientation,
  );

  return desks.map((desk) => {
    // If sun is below horizon or altitude too low for daylight
    if (!sun.isAboveHorizon || sun.altitude < minDaylightAltitudeDeg) {
      return {
        deskId: desk.id,
        isOptimalNaturalLight: false,
        relativeSunAngle,
        sunAltitude: sun.altitude,
        sunAzimuth: sun.azimuth,
        daylightQuality: sun.isAboveHorizon ? "dim" : "night",
        score: 0,
        reason: sun.isAboveHorizon
          ? "Sun altitude is too low for significant natural daylight."
          : "Sun is below horizon (night/dusk).",
      };
    }

    // Determine desk window distance (normalized or meters, default ~3m)
    const windowDist =
      desk.windowDistance !== undefined
        ? desk.windowDistance
        : desk.row !== undefined
          ? Math.max(1, desk.row * 1.5 + 1)
          : 3.0;

    const deskOrientation = desk.facingOrientationDeg ?? venueCompassOrientation;
    const deskRelativeAngle = computeRelativeSunAngle(sun.azimuth, deskOrientation);

    // Sun is illuminating the window facade if relative angle <= 90°
    const isFacadeIlluminated = deskRelativeAngle <= 90;

    if (!isFacadeIlluminated) {
      // Shaded facade: ambient indirect light without glare
      // Desks close to window get soft diffuse daylight (optimal if windowDist between 1 and 4.5m)
      const isOptimal = windowDist >= 1 && windowDist <= 4.5;
      return {
        deskId: desk.id,
        isOptimalNaturalLight: isOptimal,
        badgeLabel: isOptimal ? BEST_NATURAL_LIGHT_BADGE : undefined,
        relativeSunAngle: deskRelativeAngle,
        sunAltitude: sun.altitude,
        sunAzimuth: sun.azimuth,
        daylightQuality: isOptimal ? "optimal" : "shaded",
        score: isOptimal ? 0.85 : 0.4,
        reason: isOptimal
          ? "Receives pleasant soft, indirect natural light from shaded facade without solar glare."
          : "In shaded zone away from direct windows.",
      };
    }

    // Facade is directly illuminated by sun
    // If sun enters at an acute direct angle (< glareAngleThresholdDeg) and desk is immediately at window, direct glare occurs
    const isDirectGlare =
      deskRelativeAngle < glareAngleThresholdDeg && windowDist < 2.0 && sun.altitude < 50;

    if (isDirectGlare) {
      return {
        deskId: desk.id,
        isOptimalNaturalLight: false,
        relativeSunAngle: deskRelativeAngle,
        sunAltitude: sun.altitude,
        sunAzimuth: sun.azimuth,
        daylightQuality: "glare",
        score: 0.25,
        reason: "Subject to direct solar glare on screens from low-angle direct sunlight.",
      };
    }

    // Optimal daylight zone:
    // Either oblique sun illumination (relative angle between glare threshold and 85°),
    // OR desk is slightly recessed (e.g. 2m-5.5m) buffering direct beam while capturing generous daylight.
    const isOptimalAngle = deskRelativeAngle >= glareAngleThresholdDeg && deskRelativeAngle <= 85;
    const isOptimalDistance = windowDist >= 1.5 && windowDist <= 5.5;
    const isOptimal = (isOptimalAngle && isOptimalDistance) || (isOptimalDistance && sun.altitude >= 30);

    return {
      deskId: desk.id,
      isOptimalNaturalLight: isOptimal,
      badgeLabel: isOptimal ? BEST_NATURAL_LIGHT_BADGE : undefined,
      relativeSunAngle: deskRelativeAngle,
      sunAltitude: sun.altitude,
      sunAzimuth: sun.azimuth,
      daylightQuality: isOptimal ? "optimal" : "shaded",
      score: isOptimal ? 0.95 : 0.5,
      reason: isOptimal
        ? "Optimal natural daylight with comfortable illumination and no direct screen glare."
        : "Moderate daylight; positioned deeper in venue floorplan.",
    };
  });
}

