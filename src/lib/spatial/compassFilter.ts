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
  const diff = ((toAngle - fromAngle + 180) % 360 + 360) % 360 - 180;
  return diff;
}

/**
 * Normalizes any degree value into the canonical [0, 360) range.
 */
export function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Circular 1D Kalman Filter for directional heading and orientation sensors.
 */
export class CompassKalmanFilter {
  private state: number | null = null;
  private p: number;
  private q: number;
  private r: number;

  constructor(options: CompassKalmanFilterOptions = {}) {
    this.q = options.q ?? 0.05;
    this.r = options.r ?? 0.5;
    this.p = options.p ?? 1.0;
  }

  /**
   * Updates the filter with a new raw compass measurement (in degrees).
   *
   * @param measurement Raw compass angle in degrees [0, 360)
   * @returns Smoothed and filtered compass angle in degrees [0, 360)
   */
  public update(measurement: number | null): number | null {
    if (measurement === null || isNaN(measurement)) {
      return this.state;
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

    // 3. Kalman Gain
    const innovationCov = pPred + this.r;
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
    this.p = 1.0;
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
 */
export function smoothCircularHeading(
  prevHeading: number | null,
  newHeading: number | null,
  alpha = 0.15,
): number | null {
  if (newHeading === null || isNaN(newHeading)) return prevHeading;
  if (prevHeading === null || isNaN(prevHeading)) return normalizeDegrees(newHeading);

  const delta = shortestAngularDifference(prevHeading, newHeading);
  return normalizeDegrees(prevHeading + alpha * delta);
}
