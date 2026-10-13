/**
 * Quaternion and Rotation Matrix Sensor Fusion for Compass Heading
 *
 * Converts DeviceOrientationEvent Euler angles (alpha, beta, gamma) into a unit quaternion
 * and 3D rotation matrix, applying Spherical Linear Interpolation (SLERP) to eliminate
 * gimbal lock singularities near pitch angles of ±90° (which otherwise cause rapid 180°
 * needle spin flips).
 */

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export type RotationMatrix = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

/**
 * Normalizes a quaternion to unit length.
 * Returns identity quaternion if norm is near zero.
 */
export function normalizeQuaternion(q: Quaternion): Quaternion {
  const norm = Math.hypot(q.x, q.y, q.z, q.w);
  if (norm < 1e-12) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }
  return {
    x: q.x / norm,
    y: q.y / norm,
    z: q.z / norm,
    w: q.w / norm,
  };
}

/**
 * Computes the dot product of two quaternions.
 */
export function quaternionDot(q1: Quaternion, q2: Quaternion): number {
  return q1.x * q2.x + q1.y * q2.y + q1.z * q2.z + q1.w * q2.w;
}

/**
 * Converts device orientation Euler angles (alpha, beta, gamma in degrees)
 * to a unit quaternion following the W3C Device Orientation Specification
 * (intrinsic Tait-Bryan Z-X'-Y'' rotations).
 *
 * @param alphaDeg Rotation around Z axis (yaw / compass azimuth) in degrees [0, 360)
 * @param betaDeg  Rotation around X' axis (pitch) in degrees [-180, 180)
 * @param gammaDeg Rotation around Y'' axis (roll) in degrees [-90, 90)
 * @returns Normalized unit quaternion
 */
export function eulerToQuaternion(
  alphaDeg: number | null | undefined,
  betaDeg: number | null | undefined,
  gammaDeg: number | null | undefined,
): Quaternion {
  const alpha =
    alphaDeg !== null && alphaDeg !== undefined && Number.isFinite(alphaDeg)
      ? alphaDeg
      : 0;
  const beta =
    betaDeg !== null && betaDeg !== undefined && Number.isFinite(betaDeg)
      ? betaDeg
      : 0;
  const gamma =
    gammaDeg !== null && gammaDeg !== undefined && Number.isFinite(gammaDeg)
      ? gammaDeg
      : 0;

  const alphaRad = (alpha * Math.PI) / 180;
  const betaRad = (beta * Math.PI) / 180;
  const gammaRad = (gamma * Math.PI) / 180;

  const halfAlpha = alphaRad / 2;
  const halfBeta = betaRad / 2;
  const halfGamma = gammaRad / 2;

  const ca = Math.cos(halfAlpha);
  const sa = Math.sin(halfAlpha);
  const cb = Math.cos(halfBeta);
  const sb = Math.sin(halfBeta);
  const cg = Math.cos(halfGamma);
  const sg = Math.sin(halfGamma);

  // Intrinsic Z-X'-Y'' composition:
  // q = q_z(alpha) * q_x(beta) * q_y(gamma)
  const w = ca * cb * cg - sa * sb * sg;
  const x = ca * sb * cg - sa * cb * sg;
  const y = sa * sb * cg + ca * cb * sg;
  const z = sa * cb * cg + ca * sb * sg;

  return normalizeQuaternion({ x, y, z, w });
}

/**
 * Converts a unit quaternion to a 3x3 orthonormal rotation matrix.
 * Represents the transformation from device coordinate frame to Earth world frame (East-North-Up).
 */
export function quaternionToRotationMatrix(q: Quaternion): RotationMatrix {
  const normQ = normalizeQuaternion(q);
  const { x, y, z, w } = normQ;

  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;

  return [
    [1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy)],
    [2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx)],
    [2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy)],
  ];
}

/**
 * Performs Spherical Linear Interpolation (SLERP) between two quaternions.
 * Uses the shortest path on the 4D hypersphere by flipping target quaternion
 * when dot product < 0, guaranteeing smooth transition and avoiding 180° spin artifacts.
 *
 * @param q1 Start quaternion
 * @param q2 Target quaternion
 * @param t  Interpolation parameter in range [0, 1]
 */
export function quaternionSlerp(
  q1: Quaternion,
  q2: Quaternion,
  t: number,
): Quaternion {
  const clampedT = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  if (clampedT === 0) return normalizeQuaternion(q1);
  if (clampedT === 1) return normalizeQuaternion(q2);

  const n1 = normalizeQuaternion(q1);
  let n2 = normalizeQuaternion(q2);

  let dot = quaternionDot(n1, n2);

  // Take the shortest path across the 4D unit sphere
  if (dot < 0) {
    dot = -dot;
    n2 = { x: -n2.x, y: -n2.y, z: -n2.z, w: -n2.w };
  }

  // Clamp dot product to [-1, 1] domain for Math.acos
  dot = Math.min(1, Math.max(-1, dot));

  // If orientations are virtually identical, fall back to linear interpolation to prevent division by zero
  if (dot > 0.9995) {
    return normalizeQuaternion({
      x: n1.x + clampedT * (n2.x - n1.x),
      y: n1.y + clampedT * (n2.y - n1.y),
      z: n1.z + clampedT * (n2.z - n1.z),
      w: n1.w + clampedT * (n2.w - n1.w),
    });
  }

  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  const w1 = Math.sin((1 - clampedT) * theta) / sinTheta;
  const w2 = Math.sin(clampedT * theta) / sinTheta;

  return normalizeQuaternion({
    x: w1 * n1.x + w2 * n2.x,
    y: w1 * n1.y + w2 * n2.y,
    z: w1 * n1.z + w2 * n2.z,
    w: w1 * n1.w + w2 * n2.w,
  });
}

/**
 * Computes the True North compass heading in degrees [0, 360) from a quaternion
 * without Euler angle gimbal lock singularity flips.
 *
 * Blends device top (+Y direction when held horizontal on a desk) and
 * device rear camera (-Z direction when held vertically in AR mode)
 * into a continuous horizontal ground plane direction vector.
 *
 * @param q Unit quaternion
 * @returns Heading in degrees [0, 360) where 0 = North, 90 = East, 180 = South, 270 = West
 */
export function quaternionToHeading(q: Quaternion): number {
  const R = quaternionToRotationMatrix(q);

  // R[0] = East row, R[1] = North row, R[2] = Up row
  // Device +Y (top of phone) in Earth frame: [R[0][1], R[1][1], R[2][1]]
  // Device -Z (camera out back of phone) in Earth frame: [-R[0][2], -R[1][2], -R[2][2]]

  const topEast = R[0][1];
  const topNorth = R[1][1];
  const topUp = R[2][1];

  const camEast = -R[0][2];
  const camNorth = -R[1][2];

  // If device is upright or horizontal (topUp >= 0), blend +Y and -Z.
  // If inverted/pitch downwards (topUp < 0), invert camera component.
  const east = topUp >= 0 ? topEast + camEast : topEast - camEast;
  const north = topUp >= 0 ? topNorth + camNorth : topNorth - camNorth;

  if (Math.abs(east) < 1e-9 && Math.abs(north) < 1e-9) {
    return 0;
  }

  // atan2(east, north) gives clockwise angle from North (0 deg)
  const angleRad = Math.atan2(east, north);
  const headingDeg = (angleRad * 180) / Math.PI;

  return ((headingDeg % 360) + 360) % 360;
}

/**
 * Checks if the current pitch angle (beta) is near ±90°, where raw Euler angles
 * experience gimbal lock singularity flips.
 *
 * @param betaDeg Device pitch in degrees
 * @param thresholdDeg Margin in degrees around ±90° (default: 15°)
 */
export function isGimbalLockProne(
  betaDeg: number | null | undefined,
  thresholdDeg = 15,
): boolean {
  if (betaDeg === null || betaDeg === undefined || !Number.isFinite(betaDeg)) {
    return false;
  }
  const absBeta = Math.abs(betaDeg);
  return Math.abs(absBeta - 90) <= thresholdDeg;
}

/**
 * Stateful orientation smoother applying Quaternion SLERP filtering.
 */
export class QuaternionOrientationFilter {
  private currentQuaternion: Quaternion | null = null;
  private slerpFactor: number;

  constructor(slerpFactor = 0.2) {
    this.slerpFactor = Math.max(0.01, Math.min(1.0, slerpFactor));
  }

  public setSlerpFactor(factor: number): void {
    if (Number.isFinite(factor)) {
      this.slerpFactor = Math.max(0.01, Math.min(1.0, factor));
    }
  }

  public getSlerpFactor(): number {
    return this.slerpFactor;
  }

  public getCurrentQuaternion(): Quaternion | null {
    return this.currentQuaternion ? { ...this.currentQuaternion } : null;
  }

  /**
   * Updates filter state with new Euler angles, applying SLERP smoothing.
   * Returns the updated smoothed heading in degrees [0, 360).
   */
  public update(
    alphaDeg: number | null | undefined,
    betaDeg: number | null | undefined,
    gammaDeg: number | null | undefined,
  ): number {
    const rawQ = eulerToQuaternion(alphaDeg, betaDeg, gammaDeg);

    if (!this.currentQuaternion) {
      this.currentQuaternion = rawQ;
    } else {
      this.currentQuaternion = quaternionSlerp(
        this.currentQuaternion,
        rawQ,
        this.slerpFactor,
      );
    }

    return quaternionToHeading(this.currentQuaternion);
  }

  /**
   * Resets internal filter state.
   */
  public reset(): void {
    this.currentQuaternion = null;
  }
}
