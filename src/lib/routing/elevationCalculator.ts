/**
 * Elevation Gain & Active Calorie Calculation Engine
 * Issue #7152: feat(routing): add elevation gain and estimated calories burned
 *
 * Implements:
 * 1. Cumulative positive elevation gain calculation from route elevation profiles.
 * 2. Active calorie expenditure estimation using metabolic equivalent of task (MET):
 *    Active Calories = (MET - 1) × 3.5 × weightKg / 200 × durationMinutes
 *    with walking MET = 3.5 and cycling MET = 6.8.
 * 3. Scientifically documented ACSM walking metabolic equation when speed and grade
 *    telemetry inputs are within valid physiological boundaries.
 */

/**
 * Standard adult body mass in kilograms, recommended by WHO / public health standards
 * when a user weight profile is not configured in the application.
 */
export const DEFAULT_BODY_WEIGHT_KG = 70;

/**
 * Metabolic Equivalent of Task (MET) values (Compendium of Physical Activities):
 * - Walking (average pace ~4.8 km/h / 3.0 mph): 3.5 MET
 * - Cycling (moderate leisure/commute pace ~16-19 km/h / 10-12 mph): 6.8 MET
 */
export const WALKING_MET = 3.5;
export const CYCLING_MET = 6.8;

/**
 * Conversion constant from meters to feet.
 */
export const METERS_TO_FEET = 3.28084;

export type TransportationMode =
  | "walking"
  | "cycling"
  | "driving"
  | "walk"
  | "bike"
  | "drive"
  | "WALK"
  | "BIKE"
  | "DRIVE";

export type NormalizedTransportationMode = "walking" | "cycling" | "driving";

export type ElevationPoint =
  | number
  | [number, number, number?]
  | {
      elevation?: number | null;
      ele?: number | null;
      alt?: number | null;
      [key: string]: any;
    };

export type ElevationProfile = ElevationPoint[];

export interface CalorieCalculationOptions {
  mode: TransportationMode;
  durationMinutes?: number | null;
  durationSeconds?: number | null;
  weightKg?: number | null;
  elevationGainMeters?: number | null;
  distanceMeters?: number | null;
  includeGradientAdjustment?: boolean;
}

/**
 * Normalizes various transportation mode string variants into a standard mode.
 */
export function normalizeTransportationMode(
  mode?: TransportationMode | string | null,
): NormalizedTransportationMode {
  if (!mode) return "walking";
  const lower = mode.toString().toLowerCase().trim();
  if (lower === "walk" || lower === "walking" || lower === "foot") return "walking";
  if (
    lower === "bike" ||
    lower === "cycling" ||
    lower === "bicycle" ||
    lower === "biking"
  ) {
    return "cycling";
  }
  if (
    lower === "drive" ||
    lower === "driving" ||
    lower === "car" ||
    lower === "transit"
  ) {
    return "driving";
  }
  return "walking";
}

/**
 * Extracts an array of valid numerical elevation values (in meters) from diverse profile shapes.
 * Accepts arrays of numbers, 3D tuples [lng, lat, elevation], or coordinate objects.
 * Sanitizes and discards non-finite or non-numeric entries.
 *
 * For GeoJSON 2D coordinates [lng, lat] (length 2), no elevation value is extracted,
 * properly distinguishing 2D from 3D telemetry.
 */
export function extractElevationValues(
  profile?: ElevationProfile | null,
): number[] {
  if (!profile || !Array.isArray(profile)) return [];

  const values: number[] = [];

  for (const point of profile) {
    if (point === null || point === undefined) continue;

    if (typeof point === "number") {
      if (Number.isFinite(point)) {
        values.push(point);
      }
    } else if (Array.isArray(point)) {
      // 3D GeoJSON coordinates: [lng, lat, elevation]
      // 2D coordinates have length 2 and point[2] is undefined.
      if (
        point.length >= 3 &&
        typeof point[2] === "number" &&
        Number.isFinite(point[2])
      ) {
        values.push(point[2]);
      }
    } else if (typeof point === "object") {
      const candidate = point.elevation ?? point.ele ?? point.alt;
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        values.push(candidate);
      }
    }
  }

  return values;
}

/**
 * Calculates cumulative positive elevation gain in meters.
 * Requirements:
 * - Sums only positive changes between consecutive elevation sample points.
 * - Ignores negative changes (descents) entirely.
 * - Returns null if profile is missing, empty, or has fewer than 2 valid elevation points
 *   to avoid displaying fabricated 0m values when no elevation telemetry exists.
 * - Returns 0 if a valid profile exists with >= 2 points but has zero vertical climbing (flat terrain).
 */
export function calculateElevationGain(
  profile?: ElevationProfile | null,
): number | null {
  const elevations = extractElevationValues(profile);

  // Without at least two sample points, an elevation delta cannot be determined.
  if (elevations.length < 2) {
    return null;
  }

  let cumulativeGain = 0;

  for (let i = 1; i < elevations.length; i++) {
    const delta = elevations[i] - elevations[i - 1];
    if (delta > 0) {
      cumulativeGain += delta;
    }
  }

  // Ensure result is a valid non-negative finite number rounded to 1 decimal place
  return Math.round(cumulativeGain * 10) / 10;
}

/**
 * Converts elevation in meters to either meters or feet based on unit preference.
 */
export function convertElevation(
  meters: number | null,
  unit: "metric" | "imperial" = "metric",
): number | null {
  if (meters === null || !Number.isFinite(meters)) return null;
  if (unit === "imperial") {
    return Math.round(meters * METERS_TO_FEET);
  }
  return Math.round(meters);
}

/**
 * Formats elevation into a human-readable string with unit badge.
 */
export function formatElevation(
  meters: number | null,
  unit: "metric" | "imperial" = "metric",
): string {
  const converted = convertElevation(meters, unit);
  if (converted === null) return "N/A";
  return unit === "imperial" ? `${converted} ft` : `${converted} m`;
}

/**
 * Computes average positive route gradient (fractional slope, e.g. 0.05 for 5% grade).
 */
export function calculateGradient(
  elevationGainMeters?: number | null,
  distanceMeters?: number | null,
): number {
  if (
    typeof elevationGainMeters !== "number" ||
    !Number.isFinite(elevationGainMeters) ||
    elevationGainMeters <= 0 ||
    typeof distanceMeters !== "number" ||
    !Number.isFinite(distanceMeters) ||
    distanceMeters <= 0
  ) {
    return 0;
  }

  return elevationGainMeters / distanceMeters;
}

/**
 * Calculates estimated active calories burned using MET (Metabolic Equivalent of Task).
 *
 * ACTIVE CALORIES FORMULA:
 * Active Calories = (MET - 1) × 3.5 × weightKg / 200 × durationMinutes
 *
 * This subtracts baseline resting metabolism (1 MET) to estimate active energy expenditure.
 * Base METs: Walking = 3.5 (Active MET = 2.5), Cycling = 6.8 (Active MET = 5.8).
 *
 * GRADIENT ADJUSTMENT:
 * 1. Walking:
 * Grounded in the American College of Sports Medicine (ACSM) walking metabolic equation:
 *   Gross VO2 = 3.5 + (0.1 × S) + (1.8 × S × G)
 *   Net (active) VO2 = (0.1 × S) + (1.8 × S × G)
 * where S is speed in m/min (distance / minutes) and G is fractional grade (gain / distance).
 * This equation is validated for walking speeds between 50 and 100 m/min (approx. 3.0 to 6.0 km/h).
 * Substituting S and G into Net VO2:
 *   Active Calories = (0.1 × distanceMeters + 1.8 × elevationGainMeters) × weightKg / 200
 * If walking speed S is outside the validated ACSM range [50, 100] m/min or elevation data is
 * unavailable, the equation falls back to the base active MET formula with (3.5 - 1) = 2.5.
 *
 * 2. Cycling:
 * The ACSM cycling equation requires mechanical work rate in Watts (W = kg·m/min), which
 * depends on rolling resistance, aerodynamic drag, total cyclist + bicycle weight, and wind.
 * Because these parameters are unavailable from route telemetry alone, attempting an arbitrary
 * gradient adjustment is scientifically indefensible. Per specification, cycling uses the
 * base active MET (6.8 - 1 = 5.8).
 *
 * Returns null for DRIVE mode, missing/invalid durations, or invalid configurations.
 */
export function calculateActiveCalories(
  options: CalorieCalculationOptions,
): number | null {
  const {
    mode,
    durationMinutes,
    durationSeconds,
    weightKg,
    elevationGainMeters,
    distanceMeters,
    includeGradientAdjustment = true,
  } = options;

  const normalizedMode = normalizeTransportationMode(mode);

  // Driving is a passive mode; active locomotion calories do not apply
  if (normalizedMode === "driving") {
    return null;
  }

  // Resolve duration in minutes
  let minutes: number | null = null;
  if (typeof durationMinutes === "number" && Number.isFinite(durationMinutes)) {
    minutes = durationMinutes;
  } else if (
    typeof durationSeconds === "number" &&
    Number.isFinite(durationSeconds)
  ) {
    minutes = durationSeconds / 60;
  }

  if (minutes === null || minutes < 0 || !Number.isFinite(minutes)) {
    return null;
  }

  if (minutes === 0) {
    return 0;
  }

  // Validate or default weight
  const safeWeight =
    typeof weightKg === "number" && Number.isFinite(weightKg) && weightKg > 0
      ? weightKg
      : DEFAULT_BODY_WEIGHT_KG;

  // Walking Mode
  if (normalizedMode === "walking") {
    // If gradient adjustment is enabled and sufficient valid data is present:
    if (
      includeGradientAdjustment &&
      typeof distanceMeters === "number" &&
      distanceMeters > 0 &&
      typeof elevationGainMeters === "number" &&
      elevationGainMeters >= 0 &&
      Number.isFinite(elevationGainMeters)
    ) {
      // Horizontal walking speed S in meters per minute
      const speedMetersPerMinute = distanceMeters / minutes;

      // ACSM walking equation is validated for speeds between 50 and 100 m/min (3.0 - 6.0 km/h)
      if (speedMetersPerMinute >= 50 && speedMetersPerMinute <= 100) {
        // Net (active) VO2 = (0.1 * S) + (1.8 * S * G)
        // Multiplying by minutes gives: 0.1 * distanceMeters + 1.8 * elevationGainMeters
        const activeNetOxygenConsumption =
          0.1 * distanceMeters + 1.8 * elevationGainMeters;
        const calories = (activeNetOxygenConsumption * safeWeight) / 200;

        if (Number.isFinite(calories) && calories >= 0) {
          return Math.round(calories);
        }
      }
    }

    // Base active walking MET: (3.5 - 1) = 2.5
    const baseActiveMET = WALKING_MET - 1;
    const calories = (baseActiveMET * 3.5 * safeWeight / 200) * minutes;
    return Math.round(calories);
  }

  // Cycling Mode
  if (normalizedMode === "cycling") {
    // Required inputs for outdoor cycling metabolic equations (workload in Watts,
    // aerodynamic drag, bike mass, rolling resistance) are unavailable from GPS telemetry.
    // Scientifically documented base active MET: (6.8 - 1) = 5.8.
    const baseActiveMET = CYCLING_MET - 1;
    const calories = (baseActiveMET * 3.5 * safeWeight / 200) * minutes;
    return Math.round(calories);
  }

  return null;
}

/**
 * Formats active calories into a readable label (e.g. "~184 kcal").
 */
export function formatCalories(calories: number | null): string {
  if (calories === null || !Number.isFinite(calories)) return "N/A";
  return `~${Math.round(calories)} kcal`;
}
