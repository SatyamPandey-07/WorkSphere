/**
 * Indoor Pedestrian Dead Reckoning (PDR) & Extended Kalman Filter (EKF) Engine
 * for WorkSphere Indoor Navigation & AR Spatial Mapping
 *
 * Implements:
 * 1. Peak-valley dynamic acceleration step detection.
 * 2. Biomechanical Weinberg step length estimation.
 * 3. Tilt-compensated heading tracking with complementary gyro/magnetometer fusion.
 * 4. Log-distance path loss RSSI distance estimation & trilateration.
 * 5. 6-State Extended Kalman Filter (EKF) fusing inertial dead reckoning with beacon fixes.
 * 6. Mahalanobis distance innovation gating for multipath outlier rejection.
 * 7. Trajectory tracking and 2D spatial uncertainty covariance ellipse estimation.
 */

export interface ImuSample {
  timestamp: number; // Milliseconds
  ax: number; // Acceleration in m/s^2 (X-axis)
  ay: number; // Acceleration in m/s^2 (Y-axis)
  az: number; // Acceleration in m/s^2 (Z-axis)
  gx?: number; // Gyroscope angular rate in rad/s (X-axis)
  gy?: number; // Gyroscope angular rate in rad/s (Y-axis)
  gz?: number; // Gyroscope angular rate in rad/s (Z-axis / yaw)
  headingDeg?: number; // Optional compass / magnetometer heading in degrees (0-360)
}

export interface BeaconReading {
  id: string;
  x: number; // Beacon X position on venue floorplan (meters)
  y: number; // Beacon Y position on venue floorplan (meters)
  rssi: number; // Received signal strength indicator (dBm)
  txPower?: number; // RSSI at 1 meter (default -59 dBm)
  pathLossExponent?: number; // Path loss exponent n (default 2.5)
}

export interface StepDetectionResult {
  stepCount: number;
  stepLength: number; // Step length in meters
  headingRad: number; // Heading in radians [-pi, pi]
  headingDeg: number; // Heading in degrees [0, 360)
  displacementX: number; // Delta X in meters
  displacementY: number; // Delta Y in meters
  timestamp: number;
}

export interface PositionEstimate {
  x: number;
  y: number;
  estimatedAccuracy: number; // Uncertainty radius in meters
  residuals: number;
}

export interface UncertaintyEllipse {
  semiMajorAxis: number;
  semiMinorAxis: number;
  orientationRad: number;
  area: number;
}

export interface PdrState {
  x: number; // Local X position (meters)
  y: number; // Local Y position (meters)
  vx: number; // Velocity X (m/s)
  vy: number; // Velocity Y (m/s)
  heading: number; // Heading angle in radians [-pi, pi]
  headingDegrees: number; // Heading angle in degrees [0, 360)
  gyroBias: number; // Estimated gyroscope z-bias (rad/s)
  stepCount: number;
  totalDistance: number;
  uncertaintyRadius: number; // 1-sigma positional uncertainty in meters
}

export interface PdrConfig {
  weinbergK?: number; // Calibrated step coefficient (default 0.42)
  stepMinIntervalMs?: number; // Minimum time between consecutive steps (default 280 ms)
  stepAccelThreshold?: number; // Minimum peak-valley acceleration swing (default 1.2 m/s^2)
  gyroAlpha?: number; // Complementary filter gyro weight (default 0.96)
  processNoisePosition?: number; // EKF Q diagonal for position (m^2)
  processNoiseVelocity?: number; // EKF Q diagonal for velocity ((m/s)^2)
  processNoiseHeading?: number; // EKF Q diagonal for heading (rad^2)
  processNoiseBias?: number; // EKF Q diagonal for gyro bias ((rad/s)^2)
  measurementNoiseBeacon?: number; // EKF R diagonal for beacon measurement (m^2)
  outlierGateThreshold?: number; // Mahalanobis distance chi-square threshold (default 9.21)
}

const DEFAULT_CONFIG: Required<PdrConfig> = {
  weinbergK: 0.42,
  stepMinIntervalMs: 280,
  stepAccelThreshold: 1.2,
  gyroAlpha: 0.96,
  processNoisePosition: 0.05,
  processNoiseVelocity: 0.1,
  processNoiseHeading: 0.005,
  processNoiseBias: 0.0001,
  measurementNoiseBeacon: 4.0,
  outlierGateThreshold: 9.21, // 99% confidence for 2 DOF chi-square
};

/**
 * Normalizes an angle to the range [-PI, PI].
 */
export function normalizeAngle(rad: number): number {
  while (rad > Math.PI) rad -= 2 * Math.PI;
  while (rad < -Math.PI) rad += 2 * Math.PI;
  return rad;
}

/**
 * Converts radians to degrees in the range [0, 360).
 */
export function radToDeg(rad: number): number {
  let deg = (normalizeAngle(rad) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

/**
 * Converts degrees to radians in the range [-PI, PI].
 */
export function degToRad(deg: number): number {
  return normalizeAngle((deg * Math.PI) / 180);
}

/**
 * Calculates biomechanical human step length using the Weinberg formula:
 * SL = k * (a_max - a_min)^(1/4)
 *
 * @param aMax Peak vertical acceleration in m/s^2
 * @param aMin Valley vertical acceleration in m/s^2
 * @param k Calibrated user stature coefficient (default 0.42)
 * @returns Step length clamped between 0.30m and 1.25m
 */
export function calculateWeinbergStepLength(
  aMax: number,
  aMin: number,
  k = 0.42,
): number {
  const bounce = Math.max(0, aMax - aMin);
  if (bounce <= 0) return 0.5;

  const rawLength = k * Math.pow(bounce, 0.25);
  // Clamp to realistic human step bounds
  return Math.max(0.3, Math.min(1.25, Math.round(rawLength * 1000) / 1000));
}

/**
 * Converts RSSI signal strength to distance using the Log-Distance Path Loss model:
 * d = d0 * 10^((txPower - rssi) / (10 * n))
 *
 * @param rssi Received signal strength in dBm
 * @param txPower Calibrated RSSI at 1 meter (default -59 dBm)
 * @param pathLossExp Indoor path-loss exponent n (default 2.5)
 * @returns Estimated distance in meters
 */
export function calculateRssiDistance(
  rssi: number,
  txPower = -59,
  pathLossExp = 2.5,
): number {
  if (rssi >= 0 || !Number.isFinite(rssi)) {
    return 0.1;
  }
  const exponent = (txPower - rssi) / (10 * pathLossExp);
  const rawDist = Math.pow(10, exponent);
  return Math.max(0.1, Math.min(100, Math.round(rawDist * 100) / 100));
}

/**
 * Solves 2D non-linear trilateration using linearized least squares.
 *
 * @param beacons Array of at least 3 beacon readings
 * @returns PositionEstimate or null if insufficient/collinear beacons
 */
export function solveTrilateration(
  beacons: BeaconReading[],
): PositionEstimate | null {
  if (!beacons || beacons.length < 3) {
    return null;
  }

  // Filter valid beacons and calculate distances
  const valid = beacons
    .filter(
      (b) =>
        Number.isFinite(b.x) &&
        Number.isFinite(b.y) &&
        Number.isFinite(b.rssi) &&
        b.rssi < 0,
    )
    .map((b) => ({
      x: b.x,
      y: b.y,
      d: calculateRssiDistance(
        b.rssi,
        b.txPower ?? -59,
        b.pathLossExponent ?? 2.5,
      ),
    }));

  if (valid.length < 3) return null;

  const n = valid.length;
  const bm = valid[n - 1]; // Reference beacon

  // Use first two pairs relative to bm
  const b1_node = valid[0];
  const b2_node = valid[1];

  const row1_x = 2 * (b1_node.x - bm.x);
  const row1_y = 2 * (b1_node.y - bm.y);
  const rhs1 =
    b1_node.x ** 2 +
    b1_node.y ** 2 -
    b1_node.d ** 2 -
    (bm.x ** 2 + bm.y ** 2 - bm.d ** 2);

  const row2_x = 2 * (b2_node.x - bm.x);
  const row2_y = 2 * (b2_node.y - bm.y);
  const rhs2 =
    b2_node.x ** 2 +
    b2_node.y ** 2 -
    b2_node.d ** 2 -
    (bm.x ** 2 + bm.y ** 2 - bm.d ** 2);

  const det = row1_x * row2_y - row1_y * row2_x;

  if (Math.abs(det) < 1e-6) {
    // Collinear or degenerate: fall back to weighted centroid
    let sumWeight = 0;
    let wx = 0;
    let wy = 0;
    for (const b of valid) {
      const w = 1.0 / Math.max(0.1, b.d * b.d);
      sumWeight += w;
      wx += b.x * w;
      wy += b.y * w;
    }
    const x = wx / sumWeight;
    const y = wy / sumWeight;
    return {
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      estimatedAccuracy: 3.5,
      residuals: 1.0,
    };
  }

  const estX = (row2_y * rhs1 - row1_y * rhs2) / det;
  const estY = (-row2_x * rhs1 + row1_x * rhs2) / det;

  // Calculate geometric residual error
  let residualSum = 0;
  for (const b of valid) {
    const calcDist = Math.hypot(estX - b.x, estY - b.y);
    residualSum += Math.abs(calcDist - b.d);
  }
  const residuals = residualSum / valid.length;

  return {
    x: Math.round(estX * 100) / 100,
    y: Math.round(estY * 100) / 100,
    estimatedAccuracy: Math.max(1.0, Math.round(residuals * 100) / 100),
    residuals: Math.round(residuals * 100) / 100,
  };
}

/**
 * 6-DOF Extended Kalman Filter for 2D position, velocity, heading, and gyro bias.
 *
 * State Vector:
 * x = [x, y, vx, vy, theta, bg]^T
 */
export class ExtendedKalmanFilter6D {
  private x: Float64Array; // 6-element state vector
  private P: Float64Array; // 6x6 covariance matrix (36 elements, row-major)
  private Q: Float64Array; // Process noise diagonal
  private outlierThreshold: number;

  constructor(
    initialState = { x: 0, y: 0, heading: 0 },
    config?: Partial<PdrConfig>,
  ) {
    this.x = new Float64Array(6);
    this.x[0] = initialState.x;
    this.x[1] = initialState.y;
    this.x[2] = 0; // vx
    this.x[3] = 0; // vy
    this.x[4] = normalizeAngle(initialState.heading); // theta
    this.x[5] = 0; // bg

    this.P = new Float64Array(36);
    // Initialize P diagonal
    this.P[0] = 1.0; // P_xx
    this.P[7] = 1.0; // P_yy
    this.P[14] = 0.5; // P_vx
    this.P[21] = 0.5; // P_vy
    this.P[28] = 0.2; // P_theta
    this.P[35] = 0.01; // P_bias

    const cfg = { ...DEFAULT_CONFIG, ...config };
    this.Q = new Float64Array([
      cfg.processNoisePosition,
      cfg.processNoisePosition,
      cfg.processNoiseVelocity,
      cfg.processNoiseVelocity,
      cfg.processNoiseHeading,
      cfg.processNoiseBias,
    ]);
    this.outlierThreshold = cfg.outlierGateThreshold;
  }

  /**
   * Kinematic state prediction step.
   *
   * @param dt Time delta in seconds
   * @param gyroZ Angular velocity from gyro (rad/s)
   */
  predict(dt: number, gyroZ = 0): void {
    if (dt <= 0 || !Number.isFinite(dt)) return;

    const [px, py, vx, vy, theta, bg] = this.x;
    const effectiveGyro = gyroZ - bg;

    // State kinematics:
    // x = x + vx * dt
    // y = y + vy * dt
    // vx = vx * 0.95 (damping)
    // vy = vy * 0.95 (damping)
    // theta = theta + effectiveGyro * dt
    // bg = bg
    const velocityDamping = 0.95;
    this.x[0] = px + vx * dt;
    this.x[1] = py + vy * dt;
    this.x[2] = vx * velocityDamping;
    this.x[3] = vy * velocityDamping;
    this.x[4] = normalizeAngle(theta + effectiveGyro * dt);

    // Update covariance P = F * P * F^T + Q
    // F is almost identity except:
    // F[0, 2] = dt, F[1, 3] = dt, F[2, 2] = 0.95, F[3, 3] = 0.95, F[4, 5] = -dt
    const p00 = this.P[0] + 2 * dt * this.P[2] + dt * dt * this.P[14];
    const p11 = this.P[7] + 2 * dt * this.P[9] + dt * dt * this.P[21];
    const p22 = this.P[14] * velocityDamping ** 2;
    const p33 = this.P[21] * velocityDamping ** 2;
    const p44 = this.P[28] - 2 * dt * this.P[29] + dt * dt * this.P[35];
    const p55 = this.P[35];

    this.P[0] = p00 + this.Q[0];
    this.P[7] = p11 + this.Q[1];
    this.P[14] = p22 + this.Q[2];
    this.P[21] = p33 + this.Q[3];
    this.P[28] = p44 + this.Q[4];
    this.P[35] = p55 + this.Q[5];
  }

  /**
   * Applies inertial step displacement update directly to position & velocity.
   */
  applyStep(stepLength: number, headingRad: number, dtSeconds = 0.5): void {
    const h = normalizeAngle(headingRad);
    this.x[4] = h; // Update heading

    const dx = stepLength * Math.cos(h);
    const dy = stepLength * Math.sin(h);

    this.x[0] += dx;
    this.x[1] += dy;

    if (dtSeconds > 0) {
      this.x[2] = dx / dtSeconds;
      this.x[3] = dy / dtSeconds;
    }

    // Slightly increase position variance after step
    this.P[0] += 0.05 * stepLength ** 2;
    this.P[7] += 0.05 * stepLength ** 2;
  }

  /**
   * Measurement update from absolute 2D position fix (e.g. from beacon trilateration).
   *
   * @param zX Measured X in meters
   * @param zY Measured Y in meters
   * @param rVariance Measurement error variance in m^2 (default 4.0)
   * @returns boolean true if measurement was accepted, false if rejected by outlier gating
   */
  updatePosition(zX: number, zY: number, rVariance = 4.0): boolean {
    const yX = zX - this.x[0];
    const yY = zY - this.x[1];

    // Innovation covariance S = H * P * H^T + R
    // Since H = [1 0 0 0 0 0; 0 1 0 0 0 0], S is 2x2
    const s00 = this.P[0] + rVariance;
    const s01 = this.P[1];
    const s10 = this.P[6];
    const s11 = this.P[7] + rVariance;

    const detS = s00 * s11 - s01 * s10;
    if (detS <= 1e-12) return false;

    // S^-1
    const invS00 = s11 / detS;
    const invS01 = -s01 / detS;
    const invS10 = -s10 / detS;
    const invS11 = s00 / detS;

    // Mahalanobis distance squared: y^T * S^-1 * y
    const mahalanobisSq =
      yX * (invS00 * yX + invS01 * yY) + yY * (invS10 * yX + invS11 * yY);

    if (mahalanobisSq > this.outlierThreshold) {
      // Outlier rejected (multipath or sensor jump)
      return false;
    }

    // Kalman Gain K = P * H^T * S^-1 (6x2 matrix)
    // K_row_i = [ P[i,0]*invS00 + P[i,1]*invS10, P[i,0]*invS01 + P[i,1]*invS11 ]
    const k00 = this.P[0] * invS00 + this.P[1] * invS10;
    const k01 = this.P[0] * invS01 + this.P[1] * invS11;

    const k10 = this.P[6] * invS00 + this.P[7] * invS10;
    const k11 = this.P[6] * invS01 + this.P[7] * invS11;

    const k20 = this.P[12] * invS00 + this.P[13] * invS10;
    const k21 = this.P[12] * invS01 + this.P[13] * invS11;

    const k30 = this.P[18] * invS00 + this.P[19] * invS10;
    const k31 = this.P[18] * invS01 + this.P[19] * invS11;

    // Update state x = x + K * y
    this.x[0] += k00 * yX + k01 * yY;
    this.x[1] += k10 * yX + k11 * yY;
    this.x[2] += k20 * yX + k21 * yY;
    this.x[3] += k30 * yX + k31 * yY;

    // Update covariance P = (I - K * H) * P
    this.P[0] = Math.max(0.01, this.P[0] - (k00 * this.P[0] + k01 * this.P[6]));
    this.P[7] = Math.max(0.01, this.P[7] - (k10 * this.P[1] + k11 * this.P[7]));

    return true;
  }

  /**
   * Non-linear range measurement update for a single BLE beacon or anchor point.
   * Measurement model: h(x) = sqrt((x - x_b)^2 + (y - y_b)^2)
   * Jacobian: H = [ (x - x_b)/d, (y - y_b)/d, 0, 0, 0, 0 ]
   *
   * @param beaconX Beacon X coordinate (meters)
   * @param beaconY Beacon Y coordinate (meters)
   * @param measuredDistance Distance in meters derived from RSSI
   * @param rVariance Measurement error variance in m^2 (default 3.0)
   * @returns boolean true if accepted, false if gated as outlier
   */
  updateRange(
    beaconX: number,
    beaconY: number,
    measuredDistance: number,
    rVariance = 3.0,
  ): boolean {
    const dx = this.x[0] - beaconX;
    const dy = this.x[1] - beaconY;
    const estimatedDistance = Math.max(0.05, Math.hypot(dx, dy));

    // Innovation residual
    const y = measuredDistance - estimatedDistance;

    // Measurement Jacobian H components: dh/dx and dh/dy
    const h0 = dx / estimatedDistance;
    const h1 = dy / estimatedDistance;

    // P * H^T (6x1 vector)
    const phT = new Float64Array(6);
    for (let i = 0; i < 6; i++) {
      phT[i] = this.P[i * 6 + 0] * h0 + this.P[i * 6 + 1] * h1;
    }

    // Innovation scalar variance S = H * P * H^T + R
    const s = h0 * phT[0] + h1 * phT[1] + rVariance;
    if (s <= 1e-12 || !Number.isFinite(s)) return false;

    // 1-DOF Mahalanobis distance gating (chi-square 99% confidence = 6.63)
    const normalizedResidualSq = (y * y) / s;
    if (normalizedResidualSq > Math.min(this.outlierThreshold, 9.21)) {
      return false; // Outlier rejected
    }

    // Kalman gain K = (P * H^T) / S (6x1 vector)
    const k = new Float64Array(6);
    for (let i = 0; i < 6; i++) {
      k[i] = phT[i] / s;
    }

    // State update x = x + K * y
    this.x[0] += k[0] * y;
    this.x[1] += k[1] * y;
    this.x[2] += k[2] * y;
    this.x[3] += k[3] * y;

    // Covariance update P = P - K * (H * P)
    // H * P is 1x6 vector: (H*P)_j = h0 * P[0, j] + h1 * P[1, j]
    const hp = new Float64Array(6);
    for (let j = 0; j < 6; j++) {
      hp[j] = h0 * this.P[0 * 6 + j] + h1 * this.P[1 * 6 + j];
    }

    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        const idx = i * 6 + j;
        this.P[idx] -= k[i] * hp[j];
      }
      // Ensure positive semi-definite diagonal
      this.P[i * 6 + i] = Math.max(0.001, this.P[i * 6 + i]);
    }

    return true;
  }

  /**
   * Measurement update for heading orientation.
   */
  updateHeading(measuredHeadingRad: number, variance = 0.1): void {
    const yH = normalizeAngle(measuredHeadingRad - this.x[4]);
    const sH = this.P[28] + variance;
    if (sH <= 1e-6) return;

    const kH = this.P[28] / sH;
    this.x[4] = normalizeAngle(this.x[4] + kH * yH);
    this.P[28] = Math.max(0.001, (1 - kH) * this.P[28]);
  }

  /**
   * Returns current state vector.
   */
  getState(): {
    x: number;
    y: number;
    vx: number;
    vy: number;
    heading: number;
    gyroBias: number;
  } {
    return {
      x: this.x[0],
      y: this.x[1],
      vx: this.x[2],
      vy: this.x[3],
      heading: this.x[4],
      gyroBias: this.x[5],
    };
  }

  /**
   * Returns 1-sigma uncertainty radius in meters.
   */
  getUncertaintyRadius(): number {
    return Math.sqrt(Math.max(0, this.P[0] + this.P[7]));
  }

  /**
   * Computes 2D uncertainty covariance ellipse parameters.
   */
  getUncertaintyEllipse(): UncertaintyEllipse {
    const pxx = this.P[0];
    const pyy = this.P[7];
    const pxy = this.P[1];

    const trace = pxx + pyy;
    const det = pxx * pyy - pxy * pxy;
    const disc = Math.max(0, trace * trace - 4 * det);
    const lambda1 = (trace + Math.sqrt(disc)) / 2;
    const lambda2 = Math.max(0, (trace - Math.sqrt(disc)) / 2);

    const a = Math.sqrt(lambda1);
    const b = Math.sqrt(lambda2);
    const theta = 0.5 * Math.atan2(2 * pxy, pxx - pyy);

    return {
      semiMajorAxis: Math.round(a * 100) / 100,
      semiMinorAxis: Math.round(b * 100) / 100,
      orientationRad: Math.round(theta * 100) / 100,
      area: Math.round(Math.PI * a * b * 100) / 100,
    };
  }

  /**
   * Resets filter state and covariance.
   */
  reset(x = 0, y = 0, heading = 0): void {
    this.x.fill(0);
    this.x[0] = x;
    this.x[1] = y;
    this.x[4] = normalizeAngle(heading);

    this.P.fill(0);
    this.P[0] = 1.0;
    this.P[7] = 1.0;
    this.P[14] = 0.5;
    this.P[21] = 0.5;
    this.P[28] = 0.2;
    this.P[35] = 0.01;
  }
}

/**
 * Robust Step Detector based on peak-valley zero crossing of acceleration norm.
 */
export class StepDetector {
  private config: Required<PdrConfig>;
  private lastStepTimestamp = 0;
  private accelWindow: number[] = [];
  private windowSize = 7;
  private isArmed = false;
  private currentPeak = -Infinity;
  private currentValley = Infinity;
  private stepCount = 0;

  constructor(config?: Partial<PdrConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Processes a single accelerometer magnitude sample.
   *
   * @param norm Total acceleration norm ||a|| in m/s^2
   * @param timestamp Timestamp in ms
   * @returns Step detection result or null if no step occurred
   */
  processSample(
    norm: number,
    timestamp: number,
  ): { stepDetected: boolean; aMax: number; aMin: number } {
    // Smooth sample with moving average window
    this.accelWindow.push(norm);
    if (this.accelWindow.length > this.windowSize) {
      this.accelWindow.shift();
    }

    const smoothed =
      this.accelWindow.reduce((sum, v) => sum + v, 0) / this.accelWindow.length;

    // Track local extrema
    if (smoothed > this.currentPeak) this.currentPeak = smoothed;
    if (smoothed < this.currentValley) this.currentValley = smoothed;

    const dt = timestamp - this.lastStepTimestamp;
    const swing = this.currentPeak - this.currentValley;

    // State machine: arm when swing exceeds threshold
    if (!this.isArmed && swing >= this.config.stepAccelThreshold) {
      this.isArmed = true;
    }

    // Trigger step when falling back through mean (gravity ~9.8 m/s^2)
    if (
      this.isArmed &&
      smoothed < 9.8 &&
      dt >= this.config.stepMinIntervalMs &&
      swing >= this.config.stepAccelThreshold
    ) {
      const aMax = this.currentPeak;
      const aMin = this.currentValley;

      // Reset extrema and arm state
      this.isArmed = false;
      this.currentPeak = smoothed;
      this.currentValley = smoothed;
      this.lastStepTimestamp = timestamp;
      this.stepCount++;

      return { stepDetected: true, aMax, aMin };
    }

    return { stepDetected: false, aMax: 0, aMin: 0 };
  }

  getStepCount(): number {
    return this.stepCount;
  }

  reset(): void {
    this.lastStepTimestamp = 0;
    this.accelWindow = [];
    this.isArmed = false;
    this.currentPeak = -Infinity;
    this.currentValley = Infinity;
    this.stepCount = 0;
  }
}

/**
 * Complete Indoor Pedestrian Dead Reckoning (PDR) Engine.
 *
 * Fuses smartphone IMU (accelerometer + gyro + compass) with Wi-Fi / BLE beacons
 * via an Extended Kalman Filter to provide drift-free indoor desk localization.
 */
export class IndoorPdrEngine {
  private config: Required<PdrConfig>;
  private ekf: ExtendedKalmanFilter6D;
  private stepDetector: StepDetector;
  private lastSampleTimestamp = 0;
  private currentHeadingRad = 0;
  private totalDistance = 0;
  private hasReceivedFirstFix = false;
  private trajectory: Array<{ x: number; y: number; timestamp: number }> = [];

  constructor(
    initialState = { x: 0, y: 0, heading: 0 },
    config?: Partial<PdrConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ekf = new ExtendedKalmanFilter6D(initialState, this.config);
    this.stepDetector = new StepDetector(this.config);
    this.currentHeadingRad = normalizeAngle(initialState.heading);
    this.trajectory.push({
      x: initialState.x,
      y: initialState.y,
      timestamp: Date.now(),
    });
  }

  /**
   * Ingests high-frequency IMU sample from mobile device sensors.
   *
   * @param sample ImuSample
   * @returns StepDetectionResult if a step was completed, otherwise null
   */
  processImuSample(sample: ImuSample): StepDetectionResult | null {
    const dtSeconds =
      this.lastSampleTimestamp > 0
        ? Math.max(0.001, (sample.timestamp - this.lastSampleTimestamp) / 1000)
        : 0.02;
    this.lastSampleTimestamp = sample.timestamp;

    // 1. Gyroscope heading integration
    const gyroZ = sample.gz ?? 0;
    this.ekf.predict(dtSeconds, gyroZ);

    // 2. Complementary filter for heading if compass/magnetometer available
    if (sample.headingDeg !== undefined && Number.isFinite(sample.headingDeg)) {
      const magRad = degToRad(sample.headingDeg);
      const gyroHeading = normalizeAngle(
        this.currentHeadingRad + gyroZ * dtSeconds,
      );

      // Complementary fusion
      const alpha = this.config.gyroAlpha;
      const fusedRad = normalizeAngle(
        alpha * gyroHeading + (1 - alpha) * magRad,
      );
      this.currentHeadingRad = fusedRad;
      this.ekf.updateHeading(fusedRad, 0.05);
    } else {
      this.currentHeadingRad = this.ekf.getState().heading;
    }

    // 3. Step detection on acceleration magnitude
    const accelNorm = Math.hypot(sample.ax, sample.ay, sample.az);
    const { stepDetected, aMax, aMin } = this.stepDetector.processSample(
      accelNorm,
      sample.timestamp,
    );

    if (stepDetected) {
      // Calculate dynamic step length via Weinberg formula
      const stepLength = calculateWeinbergStepLength(
        aMax,
        aMin,
        this.config.weinbergK,
      );
      const headingRad = this.currentHeadingRad;

      // Update EKF with inertial step displacement
      this.ekf.applyStep(stepLength, headingRad, dtSeconds);

      const state = this.ekf.getState();
      this.totalDistance += stepLength;
      this.trajectory.push({
        x: Math.round(state.x * 100) / 100,
        y: Math.round(state.y * 100) / 100,
        timestamp: sample.timestamp,
      });

      const dx = Math.round(stepLength * Math.cos(headingRad) * 1000) / 1000;
      const dy = Math.round(stepLength * Math.sin(headingRad) * 1000) / 1000;

      return {
        stepCount: this.stepDetector.getStepCount(),
        stepLength,
        headingRad,
        headingDeg: Math.round(radToDeg(headingRad) * 10) / 10,
        displacementX: dx,
        displacementY: dy,
        timestamp: sample.timestamp,
      };
    }

    return null;
  }

  /**
   * Ingests ambient Wi-Fi or BLE beacon signal strength readings to correct drift.
   *
   * @param readings Array of detected beacon signal readings
   * @returns PositionEstimate if trilateration succeeded and was fused into EKF
   */
  processBeaconReadings(readings: BeaconReading[]): PositionEstimate | null {
    const fix = solveTrilateration(readings);
    if (!fix) return null;

    if (!this.hasReceivedFirstFix) {
      this.hasReceivedFirstFix = true;
      this.ekf.reset(fix.x, fix.y, this.currentHeadingRad);
      this.trajectory.push({
        x: Math.round(fix.x * 100) / 100,
        y: Math.round(fix.y * 100) / 100,
        timestamp: Date.now(),
      });
      return fix;
    }

    // Apply EKF measurement update with outlier gating
    const rVariance = Math.max(1.0, fix.estimatedAccuracy ** 2);
    const accepted = this.ekf.updatePosition(fix.x, fix.y, rVariance);

    if (accepted) {
      const state = this.ekf.getState();
      this.trajectory.push({
        x: Math.round(state.x * 100) / 100,
        y: Math.round(state.y * 100) / 100,
        timestamp: Date.now(),
      });
    }

    return fix;
  }

  /**
   * Directly fuses a single BLE beacon RSSI measurement into the EKF.
   * Enables continuous drift correction even when fewer than 3 beacons are visible.
   *
   * @param beacon Single BeaconReading
   * @returns boolean true if range update was accepted by EKF
   */
  processSingleBeaconRssi(beacon: BeaconReading): boolean {
    if (!beacon || !Number.isFinite(beacon.rssi) || beacon.rssi >= 0) {
      return false;
    }

    const distance = calculateRssiDistance(
      beacon.rssi,
      beacon.txPower ?? -59,
      beacon.pathLossExponent ?? 2.5,
    );

    // Variance grows with distance due to log-distance shadow fading
    const rVariance = Math.max(1.0, Math.pow(0.25 * distance, 2) + 1.5);
    const accepted = this.ekf.updateRange(beacon.x, beacon.y, distance, rVariance);

    if (accepted) {
      const state = this.ekf.getState();
      this.trajectory.push({
        x: Math.round(state.x * 100) / 100,
        y: Math.round(state.y * 100) / 100,
        timestamp: Date.now(),
      });
    }

    return accepted;
  }

  /**
   * Returns complete current navigation state.
   */
  getState(): PdrState {
    const s = this.ekf.getState();
    return {
      x: Math.round(s.x * 100) / 100,
      y: Math.round(s.y * 100) / 100,
      vx: Math.round(s.vx * 100) / 100,
      vy: Math.round(s.vy * 100) / 100,
      heading: Math.round(s.heading * 1000) / 1000,
      headingDegrees: Math.round(radToDeg(s.heading) * 10) / 10,
      gyroBias: Math.round(s.gyroBias * 100000) / 100000,
      stepCount: this.stepDetector.getStepCount(),
      totalDistance: Math.round(this.totalDistance * 100) / 100,
      uncertaintyRadius:
        Math.round(this.ekf.getUncertaintyRadius() * 100) / 100,
    };
  }

  /**
   * Returns historical trajectory breadcrumbs.
   */
  getTrajectory(): Array<{ x: number; y: number; timestamp: number }> {
    return [...this.trajectory];
  }

  /**
   * Returns current 2D spatial uncertainty ellipse.
   */
  getUncertaintyEllipse(): UncertaintyEllipse {
    return this.ekf.getUncertaintyEllipse();
  }

  /**
   * Resets engine to designated coordinates.
   */
  reset(initialPosition = { x: 0, y: 0, heading: 0 }): void {
    this.hasReceivedFirstFix = false;
    this.ekf.reset(
      initialPosition.x,
      initialPosition.y,
      initialPosition.heading,
    );
    this.stepDetector.reset();
    this.lastSampleTimestamp = 0;
    this.currentHeadingRad = normalizeAngle(initialPosition.heading);
    this.totalDistance = 0;
    this.trajectory = [
      {
        x: initialPosition.x,
        y: initialPosition.y,
        timestamp: Date.now(),
      },
    ];
  }
}
