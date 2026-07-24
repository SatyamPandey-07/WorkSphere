/**
 * Solar position calculator for WebGL 2.0 God Rays rendering.
 * Computes sun altitude/azimuth from venue coordinates and UTC timestamp
 * using simplified astronomical algorithms (NOAA Solar Calculator).
 *
 * All latitude and longitude inputs are expected in **decimal degrees**
 * (positive north / east, negative south / west).
 */

/** Radian/degree conversion constants. */
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Result of a solar position computation. */
export interface SunPosition {
  /** Sun angle above the local horizon in degrees (negative = below horizon). */
  altitude: number;
  /** Compass bearing from true north in degrees [0, 360). */
  azimuth: number;
  /** `true` when the sun is above astronomical twilight (altitude > −6°). */
  isAboveHorizon: boolean;
  /** Altitude normalised to [0, 1] for WebGL uniform interpolation. */
  normalizedAltitude: number;
}

/**
 * Return the 1-based day-of-year for the given date.
 *
 * @param date - Any `Date` value; only the year, month, and day are used.
 * @returns Day number in [1, 365] (366 in leap years).
 */
function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

/**
 * Compute the solar declination angle (δ) for a given day of year.
 *
 * Uses the NOAA approximation:
 *   δ ≈ 23.45° × sin( 360/365 × (N − 81) )
 *
 * where N is the day-of-year and 81 corresponds to the March equinox
 * (~March 21).
 *
 * @param dayOfYear - 1-based day of year.
 * @returns Declination angle in degrees (range ≈ ±23.45°).
 */
function solarDeclination(dayOfYear: number): number {
  return 23.45 * Math.sin(DEG_TO_RAD * (360 / 365) * (dayOfYear - 81));
}

/**
 * Compute the Equation of Time (EoT) for a given day of year.
 *
 * The EoT accounts for the eccentricity of Earth's orbit and the obliquity
 * of the ecliptic, expressed as the difference (in minutes) between apparent
 * solar time and mean solar time.  Uses a four-term Fourier approximation:
 *
 *   EoT ≈ 9.87 sin(2B) − 7.53 cos(B) − 1.5 sin(B)
 *
 * where B = 360/365 × (N − 81) in radians.
 *
 * @param dayOfYear - 1-based day of year.
 * @returns Equation of time in minutes (range ≈ −17 to +16 min).
 */
function equationOfTime(dayOfYear: number): number {
  const B = DEG_TO_RAD * (360 / 365) * (dayOfYear - 81);
  return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
}

/**
 * Calculate the sun's altitude and azimuth for a given location and time.
 *
 * Implements the NOAA solar position algorithm:
 *   1. Determine the Equation of Time and solar declination.
 *   2. Convert UTC time to approximate solar time via longitude offset.
 *   3. Compute the local hour angle from true solar time.
 *   4. Solve the spherical astronomy triangle for altitude and azimuth.
 *
 * @param lat - Latitude in **decimal degrees** (positive = north).
 * @param lng - Longitude in **decimal degrees** (positive = east).
 * @param date - JS `Date` object (defaults to `new Date()`). UTC fields are
 *               read directly; the local time zone is **not** used.
 * @returns A {@link SunPosition} with altitude, azimuth, normalised altitude,
 *          and a convenience flag for above-horizon status.
 */
export function calculateSunPosition(
  lat: number,
  lng: number,
  date: Date = new Date(),
): SunPosition {
  const doy = dayOfYear(date);
  const decl = solarDeclination(doy);
  const eot = equationOfTime(doy);

  // Convert UTC clock time to fractional hours (e.g. 14:30 → 14.5).
  const utcHours =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600;

  // Approximate local solar time by adding the longitude correction
  // (4 min per degree of longitude) and the Equation of Time offset.
  const solarTimeFix = eot + 4 * lng;
  const trueSolarTime = utcHours * 60 + solarTimeFix;

  // Hour angle: 0° at solar noon, negative before noon, positive after.
  // Each degree of hour angle corresponds to 4 minutes of solar time.
  const hourAngle = trueSolarTime / 4 - 180;

  // Convert degrees to radians for trigonometric calculations.
  const latRad = lat * DEG_TO_RAD;
  const declRad = decl * DEG_TO_RAD;
  const haRad = hourAngle * DEG_TO_RAD;

  // Compute the sine of the solar altitude using the spherical law of cosines.
  // Clamp to [−1, 1] to guard against floating-point overshoot near ±90°.
  const sinAlt =
    Math.sin(latRad) * Math.sin(declRad) +
    Math.cos(latRad) * Math.cos(declRad) * Math.cos(haRad);

  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * RAD_TO_DEG;

  // Derive azimuth from the spherical triangle.
  // Clamp to [−1, 1] for acos domain safety; add a tiny epsilon to avoid
  // division by zero when the sun is near the zenith.
  const cosAzimuth =
    (Math.sin(declRad) - Math.sin(latRad) * sinAlt) /
    (Math.cos(latRad) * Math.cos(Math.asin(sinAlt)) + 1e-10);

  // acos returns [0, π]; we flip for afternoon (hour angle > 0) to get
  // a full [0, 360) bearing measured clockwise from north.
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAzimuth))) * RAD_TO_DEG;

  if (hourAngle > 0) {
    azimuth = 360 - azimuth;
  }

  // Map altitude from [−10°, 90°] → [0, 1] for smooth shader blending.
  // Values below −10° (deep twilight) clamp to 0; above 90° clamp to 1.
  const normalizedAltitude = Math.max(0, Math.min(1, (altitude + 10) / 100));

  return {
    altitude,
    azimuth,
    // Sun is considered visible once it rises above astronomical twilight.
    isAboveHorizon: altitude > -6,
    normalizedAltitude,
  };
}
