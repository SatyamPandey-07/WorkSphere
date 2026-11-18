/**
 * CircadianFilter.ts
 *
 * Astronomical circadian rhythm and blue-light attenuation engine for remote workers.
 * Calculates exact local sunrise, sunset, and solar noon times from GPS coordinates
 * using solar declination and NOAA astronomical algorithms.
 *
 * Dynamically adjusts screen color temperature (6500K -> 2700K) and applies the
 * `--screen-amber-tint` CSS variable smoothly during twilight hours to preserve
 * healthy melatonin sleep rhythms.
 */

export interface SolarTimes {
  sunrise: Date;
  sunset: Date;
  solarNoon: Date;
  solarDeclinationDeg: number;
  solarElevationDeg: number;
  solarHourAngleDeg: number;
  isDaylight: boolean;
  isTwilight: boolean;
  solarPhase: "daylight" | "golden_hour" | "sunset" | "twilight" | "night";
  daylightDurationMinutes: number;
}

export interface CircadianFilterConfig {
  latitude: number;
  longitude: number;
  minColorTemperatureK?: number; // default 2700 (warm amber)
  maxColorTemperatureK?: number; // default 6500 (crisp daylight)
  targetElement?: HTMLElement | null; // element to set CSS variable on (default: document.documentElement)
  onUpdate?: (state: CircadianState) => void;
}

export interface CircadianState {
  timestamp: Date;
  latitude: number;
  longitude: number;
  solarTimes: SolarTimes;
  colorTemperatureK: number;
  amberTintLevel: number; // 0.0 (clear daylight) to 1.0 (deep warm amber)
  cssAmberTint: string; // CSS value for --screen-amber-tint
}

export const DEFAULT_MIN_COLOR_TEMP = 2700; // 2700K (warm incandescent/amber)
export const DEFAULT_MAX_COLOR_TEMP = 6500; // 6500K (D65 daylight)
export const DEFAULT_CIVIL_TWILIGHT_ANGLE = 6.0; // degrees below horizon

/**
 * Calculates solar declination, equation of time, solar noon, sunrise, sunset,
 * and current solar elevation for given GPS coordinates and date.
 */
export function calculateSolarTimes(
  latitude: number,
  longitude: number,
  date: Date = new Date()
): SolarTimes {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;

  const validDate =
    date instanceof Date && !isNaN(date.getTime())
      ? date
      : typeof date === "string" || typeof date === "number"
      ? (!isNaN(new Date(date).getTime()) ? new Date(date) : new Date())
      : new Date();

  // Sanitize coordinates to valid geographic bounds
  const safeLat = Number.isFinite(latitude)
    ? Math.max(-90, Math.min(90, latitude))
    : 0;
  const rawLng = Number.isFinite(longitude) ? longitude : 0;
  const safeLng = ((((rawLng + 180) % 360) + 360) % 360) - 180;

  // Day of the year (1 - 365)
  const startOfYear = new Date(Date.UTC(validDate.getUTCFullYear(), 0, 1));
  const dayOfYear =
    Math.floor(
      (validDate.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1;

  // Fractional year in radians
  const gamma =
    ((2 * Math.PI) / 365) *
    (dayOfYear - 1 + (validDate.getUTCHours() - 12) / 24);

  // Equation of Time in minutes (NOAA formulation)
  const eqtime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  // Solar declination angle in radians
  const declRad =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const declDeg = declRad * deg;

  // Solar Noon in UTC minutes from midnight: 720 - 4*longitude - eqtime
  const solarNoonUtcMinutes = 720 - 4 * safeLng - eqtime;

  // Standard zenith angle for sunrise/sunset taking atmospheric refraction into account: 90.833 degrees
  const zenithRad = 90.833 * rad;
  const latRad = safeLat * rad;

  // Hour angle calculation: cos(omega) = (cos(zenith) - sin(lat)*sin(decl)) / (cos(lat)*cos(decl))
  const cosLat = Math.cos(latRad);
  const cosDecl = Math.cos(declRad);
  const denom = cosLat * cosDecl;

  let cosHourAngle = 0;
  if (Math.abs(denom) < 1e-12) {
    // At exact poles, determine polar day vs polar night based on latitude and declination sign
    cosHourAngle = safeLat * declRad >= 0 ? -1.0 : 1.0;
  } else {
    cosHourAngle =
      (Math.cos(zenithRad) - Math.sin(latRad) * Math.sin(declRad)) / denom;
  }

  let halfDayMinutes = 0;
  let isPolarDay = false;
  let isPolarNight = false;

  if (cosHourAngle >= 1.0) {
    // Sun never rises (polar night)
    isPolarNight = true;
    halfDayMinutes = 0;
  } else if (cosHourAngle <= -1.0) {
    // Sun never sets (midnight sun / polar day)
    isPolarDay = true;
    halfDayMinutes = 720;
  } else {
    const hourAngleDeg = Math.acos(cosHourAngle) * deg;
    halfDayMinutes = hourAngleDeg * 4; // 1 degree = 4 minutes
  }

  // Construct Sunrise, Sunset, and Solar Noon Date objects on the same UTC day
  const baseUtcMidnight = Date.UTC(
    validDate.getUTCFullYear(),
    validDate.getUTCMonth(),
    validDate.getUTCDate()
  );

  const solarNoon = new Date(baseUtcMidnight + solarNoonUtcMinutes * 60 * 1000);
  const sunrise = isPolarNight
    ? new Date(baseUtcMidnight)
    : isPolarDay
    ? new Date(baseUtcMidnight)
    : new Date(baseUtcMidnight + (solarNoonUtcMinutes - halfDayMinutes) * 60 * 1000);

  const sunset = isPolarNight
    ? new Date(baseUtcMidnight)
    : isPolarDay
    ? new Date(baseUtcMidnight + 24 * 60 * 60 * 1000)
    : new Date(baseUtcMidnight + (solarNoonUtcMinutes + halfDayMinutes) * 60 * 1000);

  // True solar time for current instant
  const timeOffset = eqtime + 4 * safeLng;
  const tstMinutes =
    validDate.getUTCHours() * 60 +
    validDate.getUTCMinutes() +
    validDate.getUTCSeconds() / 60 +
    timeOffset;

  let currentHaDeg = tstMinutes / 4 - 180;
  if (currentHaDeg < -180) currentHaDeg += 360;
  if (currentHaDeg > 180) currentHaDeg -= 360;
  const currentHaRad = currentHaDeg * rad;

  // Solar elevation angle
  const cosZenith =
    Math.sin(latRad) * Math.sin(declRad) +
    Math.cos(latRad) * Math.cos(declRad) * Math.cos(currentHaRad);
  const currentZenithRad = Math.acos(Math.max(-1, Math.min(1, cosZenith)));
  const elevation = 90 - currentZenithRad * deg;
  const solarElevationDeg = Number(Number.isFinite(elevation) ? elevation.toFixed(2) : 0);

  // Determine Solar Phase & Twilight
  let solarPhase: "daylight" | "golden_hour" | "sunset" | "twilight" | "night";
  const isTwilight =
    solarElevationDeg <= 0 && solarElevationDeg >= -DEFAULT_CIVIL_TWILIGHT_ANGLE;
  const isDaylight = solarElevationDeg > 0;

  if (solarElevationDeg > 10) {
    solarPhase = "daylight";
  } else if (solarElevationDeg > 0) {
    solarPhase = "golden_hour";
  } else if (solarElevationDeg >= -1) {
    solarPhase = "sunset";
  } else if (isTwilight) {
    solarPhase = "twilight";
  } else {
    solarPhase = "night";
  }

  const daylightDurationMinutes = Math.round(halfDayMinutes * 2);

  return {
    sunrise,
    sunset,
    solarNoon,
    solarDeclinationDeg: Number(declDeg.toFixed(2)),
    solarElevationDeg,
    solarHourAngleDeg: Number(currentHaDeg.toFixed(2)),
    isDaylight,
    isTwilight,
    solarPhase,
    daylightDurationMinutes,
  };
}

/**
 * Calculates current circadian color temperature in Kelvin (default 2700K - 6500K)
 * based on solar elevation angle.
 */
export function calculateCircadianColorTemperature(
  latitude: number,
  longitude: number,
  date: Date = new Date(),
  minTemp: number = DEFAULT_MIN_COLOR_TEMP,
  maxTemp: number = DEFAULT_MAX_COLOR_TEMP
): number {
  const parsedMin = Number(minTemp);
  const parsedMax = Number(maxTemp);

  const rawMin = Number.isFinite(parsedMin) && parsedMin >= 1000 ? parsedMin : DEFAULT_MIN_COLOR_TEMP;
  const rawMax = Number.isFinite(parsedMax) && parsedMax >= 1000 ? parsedMax : DEFAULT_MAX_COLOR_TEMP;

  const safeMin = Math.min(rawMin, rawMax);
  const safeMax = Math.max(rawMin, rawMax);

  const { solarElevationDeg } = calculateSolarTimes(latitude, longitude, date);

  // Full daylight (> 10 degrees elevation): Max color temperature (alertness)
  if (solarElevationDeg >= 10) {
    return safeMax;
  }

  // Deep night (elevation < -6 degrees civil twilight): Warm amber / melatonin protection
  if (solarElevationDeg <= -DEFAULT_CIVIL_TWILIGHT_ANGLE) {
    return safeMin;
  }

  // Smooth cosine/linear interpolation during golden hour and twilight [-6 deg, 10 deg]
  // Range is 16 degrees total
  const factor = (solarElevationDeg - -DEFAULT_CIVIL_TWILIGHT_ANGLE) / 16.0;
  const clampedFactor = Math.max(0, Math.min(1, factor));

  // Smooth s-curve transition
  const smoothFactor = (1 - Math.cos(clampedFactor * Math.PI)) / 2;

  const temp = safeMin + smoothFactor * (safeMax - safeMin);
  return Math.round(temp);
}

/**
 * Calculates screen amber tint level from 0.0 (daylight clear) to 1.0 (warm amber 2700K).
 * Transitions smoothly during twilight and evening hours.
 */
export function calculateCircadianAmberTint(
  latitude: number,
  longitude: number,
  date: Date = new Date()
): number {
  const { solarElevationDeg } = calculateSolarTimes(latitude, longitude, date);

  if (!Number.isFinite(solarElevationDeg)) {
    return 0;
  }

  // High sun: 0 amber tint
  if (solarElevationDeg >= 8) {
    return 0;
  }

  // Past civil twilight: full amber tint
  if (solarElevationDeg <= -DEFAULT_CIVIL_TWILIGHT_ANGLE) {
    return 1;
  }

  // Transition band: 8 deg down to -6 deg (14 degrees total span)
  const progress = (8 - solarElevationDeg) / 14.0;
  const clamped = Math.max(0, Math.min(1, progress));

  // Smoothstep interpolation: 3x^2 - 2x^3
  const smooth = clamped * clamped * (3 - 2 * clamped);
  return Number(smooth.toFixed(3));
}

/**
 * Formats amber tint value for CSS variable `--screen-amber-tint`.
 */
export function formatCssAmberTint(tintLevel: number): string {
  const val = Number(tintLevel);
  if (!Number.isFinite(val)) {
    return val > 0 ? "1" : "0";
  }
  const clamped = Math.max(0, Math.min(1, val));
  return `${Number(clamped.toFixed(3))}`;
}

/**
 * Applies the CSS variable `--screen-amber-tint` and `--screen-color-temp`
 * to the target HTML element (defaults to `document.documentElement`).
 */
export function applyCircadianAmberTint(
  tintLevel: number,
  element?: HTMLElement | null,
  colorTemperatureK?: number
): void {
  const target =
    element ||
    (typeof document !== "undefined" ? document.documentElement : null);

  if (!target || !target.style) {
    return;
  }

  const cssValue = formatCssAmberTint(tintLevel);
  target.style.setProperty("--screen-amber-tint", cssValue);

  if (Number.isFinite(colorTemperatureK) && (colorTemperatureK as number) > 0) {
    target.style.setProperty("--screen-color-temp", `${Math.round(colorTemperatureK as number)}K`);
  }
}

/**
 * CircadianFilterManager
 *
 * Automated service that coordinates solar position tracking, amber tinting,
 * and CSS variable updates at periodic intervals.
 */
export class CircadianFilterManager {
  private config: CircadianFilterConfig;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private currentState: CircadianState | null = null;

  constructor(config: CircadianFilterConfig) {
    this.config = {
      minColorTemperatureK: DEFAULT_MIN_COLOR_TEMP,
      maxColorTemperatureK: DEFAULT_MAX_COLOR_TEMP,
      ...config,
    };
  }

  /**
   * Updates configuration coordinates or settings.
   */
  public updateConfig(newConfig: Partial<CircadianFilterConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.apply();
  }

  /**
   * Calculates and applies current circadian state.
   */
  public apply(date: Date = new Date()): CircadianState {
    const {
      latitude,
      longitude,
      minColorTemperatureK = DEFAULT_MIN_COLOR_TEMP,
      maxColorTemperatureK = DEFAULT_MAX_COLOR_TEMP,
      targetElement,
      onUpdate,
    } = this.config;

    const solarTimes = calculateSolarTimes(latitude, longitude, date);
    const colorTemperatureK = calculateCircadianColorTemperature(
      latitude,
      longitude,
      date,
      minColorTemperatureK,
      maxColorTemperatureK
    );
    const amberTintLevel = calculateCircadianAmberTint(latitude, longitude, date);
    const cssAmberTint = formatCssAmberTint(amberTintLevel);

    // Apply CSS variable smoothly
    applyCircadianAmberTint(amberTintLevel, targetElement, colorTemperatureK);

    const state: CircadianState = {
      timestamp: date,
      latitude,
      longitude,
      solarTimes,
      colorTemperatureK,
      amberTintLevel,
      cssAmberTint,
    };

    this.currentState = state;
    if (onUpdate) {
      onUpdate(state);
    }

    return state;
  }

  /**
   * Starts periodic evaluation of circadian lighting (default interval: 60,000ms / 1 min).
   */
  public start(intervalMs: number = 60000): void {
    this.stop();
    this.apply();
    const safeInterval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 60000;
    this.timerId = setInterval(() => {
      this.apply();
    }, safeInterval);
  }

  /**
   * Stops periodic evaluation.
   */
  public stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Retrieves the latest computed circadian state.
   */
  public getState(): CircadianState | null {
    return this.currentState;
  }
}

export default CircadianFilterManager;
