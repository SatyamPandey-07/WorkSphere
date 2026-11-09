/**
 * 1D Circular Kalman Filter for smoothing compass headings with 0°/360° modular wraparound handling.
 *
 * Prevents high-frequency sensor jitter while seamlessly handling the 0°/360° boundary
 * without artifact spinning or abrupt phase flips.
 */

export interface CompassKalmanFilterOptions {
  /** Process noise covariance Q (lower = smoother/slower, higher = more responsive, default: 0.05) */
  q?: number;
  /** Measurement noise covariance R (lower = trust measurement more, higher = filter more noise, default: 0.5) */
  r?: number;
  /** Initial error covariance P (default: 1.0) */
  p?: number;
}

/**
 * Calculates the shortest angular difference from angle `a` to angle `b` in degrees.
 * Returns a value in the range [-180, 180].
 */
export function shortestAngularDifference(fromAngle: number, toAngle: number): number {
  if (!Number.isFinite(fromAngle) || !Number.isFinite(toAngle)) return 0;
  const diff = ((toAngle - fromAngle + 180) % 360 + 360) % 360 - 180;
  return diff;
}

/**
 * Normalizes any degree value into the canonical [0, 360) range.
 */
export function normalizeDegrees(deg: number | null | undefined): number {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return 0;
  return ((deg % 360) + 360) % 360;
}

/**
 * Converts heading/azimuth degrees to radians [-PI, PI].
 * Validates null, undefined, or non-finite readings and falls back to a stationary 0 heading.
 *
 * @param deg Heading or azimuth angle in degrees, or null/undefined if sensor lacks hardware magnetometer
 * @param fallbackDeg Optional fallback heading if input is null or non-finite (default: 0)
 * @returns Heading angle in radians [-PI, PI]
 */
export function degreesToRadians(
  deg: number | null | undefined,
  fallbackDeg = 0,
): number {
  const safeDeg =
    deg !== null && deg !== undefined && Number.isFinite(deg)
      ? deg
      : Number.isFinite(fallbackDeg)
        ? fallbackDeg
        : 0;
  const normalized = normalizeDegrees(safeDeg);
  let rad = (normalized * Math.PI) / 180;
  while (rad > Math.PI) rad -= 2 * Math.PI;
  while (rad < -Math.PI) rad += 2 * Math.PI;
  return rad;
}

/**
 * Alias for degreesToRadians specifically for azimuth and orientation calculations.
 */
export const headingToRadians = degreesToRadians;

/**
 * Converts radians to degrees in the range [0, 360).
 */
export function radiansToDegrees(rad: number | null | undefined): number {
  if (rad === null || rad === undefined || !Number.isFinite(rad)) return 0;
  let deg = (rad * 180) / Math.PI;
  return normalizeDegrees(deg);
}

/**
 * Circular 1D Kalman Filter for directional heading and orientation sensors.
 */
export class CompassKalmanFilter {
  private state: number | null = null;
  private p: number;
  private q: number;
  private r: number;
  private initialP: number;

  constructor(options: CompassKalmanFilterOptions = {}) {
    this.q = options.q ?? 0.05;
    this.r = options.r ?? 0.5;
    this.p = options.p ?? 1.0;
    this.initialP = this.p;
  }

  /**
   * Updates the filter with a new raw compass measurement (in degrees).
   * Dynamically scales sensor covariance matrix (R) inversely with reported
   * sensor accuracy/confidence, relying more on prediction/dead reckoning when confidence drops.
   * If sensor returns null or non-finite values (e.g. device lacks hardware magnetometer),
   * returns the last known heading or optional fallback heading (defaulting to 0 if uninitialized),
   * preventing calculation state from degrading into NaN.
   *
   * @param measurement Raw compass angle in degrees [0, 360), or null/undefined
   * @param confidence Optional sensor accuracy or confidence in range (0, 1]
   * @param fallbackHeading Optional fallback heading in degrees if sensor is null and uninitialized (default: 0)
   * @returns Smoothed and filtered compass angle in degrees [0, 360)
   */
  public update(
    measurement: number | null | undefined,
    confidence?: number | null,
    fallbackHeading = 0,
  ): number | null {
    if (measurement === null || measurement === undefined || !Number.isFinite(measurement)) {
      return this.state !== null ? this.state : normalizeDegrees(fallbackHeading);
    }

    const normMeasurement = normalizeDegrees(measurement);

    // First measurement initialization
    if (this.state === null) {
      this.state = normMeasurement;
      return this.state;
    }

    // 1. Predict Step
    // For static/random-walk heading model, x_pred = x
    const xPred = this.state;
    const pPred = this.p + this.q;

    // 2. Innovation / Measurement Residual (using circular difference)
    const residual = shortestAngularDifference(xPred, normMeasurement);

    // Dynamically scale sensor covariance matrix (R) inversely with reported sensor accuracy
    let effectiveR = this.r;
    if (confidence !== undefined && confidence !== null && Number.isFinite(confidence)) {
      const clampedConfidence = Math.max(0.001, Math.min(1.0, confidence));
      effectiveR = this.r / clampedConfidence;
    }

    // 3. Kalman Gain
    const innovationCov = pPred + effectiveR;
    const kalmanGain = pPred / innovationCov;

    // 4. Update Step
    const updatedState = xPred + kalmanGain * residual;
    this.state = normalizeDegrees(updatedState);
    this.p = (1 - kalmanGain) * pPred;

    return this.state;
  }

  /**
   * Current filtered heading estimate, or null if uninitialized.
   */
  public getState(): number | null {
    return this.state;
  }

  /**
   * Resets the filter state and covariance.
   */
  public reset(initialState: number | null = null): void {
    this.state = initialState !== null ? normalizeDegrees(initialState) : null;
    this.p = this.initialP;
  }

  /**
   * Updates the filter covariance tuning parameters.
   */
  public setParameters(params: { q?: number; r?: number }): void {
    if (params.q !== undefined && params.q > 0) this.q = params.q;
    if (params.r !== undefined && params.r > 0) this.r = params.r;
  }
}

/**
 * Exponential moving average filter with circular wraparound for compass angles.
 *
 * @param prevHeading Previous filtered heading in degrees [0, 360)
 * @param newHeading New measurement in degrees [0, 360)
 * @param alpha Smoothing factor between 0 (keep prev) and 1 (instant update). Default 0.15
 * @param fallbackHeading Default heading in degrees if both inputs are null or invalid (default: 0)
 */
export function smoothCircularHeading(
  prevHeading: number | null | undefined,
  newHeading: number | null | undefined,
  alpha = 0.15,
  fallbackHeading = 0,
): number {
  const hasNew = newHeading !== null && newHeading !== undefined && Number.isFinite(newHeading);
  const hasPrev = prevHeading !== null && prevHeading !== undefined && Number.isFinite(prevHeading);

  if (!hasNew && !hasPrev) {
    return normalizeDegrees(fallbackHeading);
  }
  if (!hasNew) {
    return normalizeDegrees(prevHeading);
  }
  if (!hasPrev) {
    return normalizeDegrees(newHeading);
  }

  const normPrev = normalizeDegrees(prevHeading);
  const normNew = normalizeDegrees(newHeading);
  const delta = shortestAngularDifference(normPrev, normNew);
  const safeAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.15;
  return normalizeDegrees(normPrev + safeAlpha * delta);
}
