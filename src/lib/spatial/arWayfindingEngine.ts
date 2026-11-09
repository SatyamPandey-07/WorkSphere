/**
 * arWayfindingEngine.ts
 * Spatial vector math and turn-by-turn waypoint routing for WebXR indoor AR wayfinding.
 * Computes heading bearings, distance vectors, and glowing bounding-box coordinates for reserved desks.
 */

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface ARWaypoint {
  stepIndex: number;
  position: Vector3D;
  instruction: string;
  distanceToNextMeters: number;
  turnAction: "STRAIGHT" | "TURN_LEFT" | "TURN_RIGHT" | "ARRIVED" | "STAIRS_ELEVATOR";
}

export interface ARNavigationPath {
  targetSeatId: string;
  targetSeatNumber: string;
  targetPosition: Vector3D;
  totalDistanceMeters: number;
  estimatedWalkingSeconds: number;
  waypoints: ARWaypoint[];
}

/**
 * Calculates Euclidean distance between two 3D spatial points.
 */
export function calculate3DDistance(p1: Vector3D, p2: Vector3D): number {
  return Math.sqrt(
    Math.pow(p2.x - p1.x, 2) +
    Math.pow(p2.y - p1.y, 2) +
    Math.pow(p2.z - p1.z, 2)
  );
}

/**
 * Calculates horizontal bearing angle (in degrees 0-360) from camera position to target.
 */
export function calculateHorizontalBearingDeg(from: Vector3D, to: Vector3D): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  let angle = Math.atan2(dx, -dz) * (180 / Math.PI);
  if (angle < 0) angle += 360;
  return Number(angle.toFixed(1));
}

/**
 * Generates an indoor navigation path with intermediate waypoints to avoid interior walls.
 */
export function computeARIndoorRoute(
  start: Vector3D,
  destination: Vector3D,
  targetSeatId: string,
  targetSeatNumber: string
): ARNavigationPath {
  const totalDist = calculate3DDistance(start, destination);
  const waypoints: ARWaypoint[] = [];

  // If distance is short (< 4m), direct line of sight
  if (totalDist <= 4.0) {
    waypoints.push({
      stepIndex: 1,
      position: destination,
      instruction: `Walk straight towards ${targetSeatNumber}`,
      distanceToNextMeters: Number(totalDist.toFixed(1)),
      turnAction: "STRAIGHT",
    });
    waypoints.push({
      stepIndex: 2,
      position: destination,
      instruction: `Arrived at ${targetSeatNumber}`,
      distanceToNextMeters: 0,
      turnAction: "ARRIVED",
    });
  } else {
    // Generate an intermediate hallway intersection waypoint
    const midX = start.x + (destination.x - start.x) * 0.5;
    const midZ = start.z; // Move along primary hallway axis first

    const intermediatePoint: Vector3D = {
      x: Number(midX.toFixed(2)),
      y: Number(start.y.toFixed(2)),
      z: Number(midZ.toFixed(2)),
    };

    const dist1 = calculate3DDistance(start, intermediatePoint);
    const dist2 = calculate3DDistance(intermediatePoint, destination);

    const isLeftTurn = destination.z < start.z;

    waypoints.push({
      stepIndex: 1,
      position: intermediatePoint,
      instruction: "Follow main corridor walkway",
      distanceToNextMeters: Number(dist1.toFixed(1)),
      turnAction: "STRAIGHT",
    });

    waypoints.push({
      stepIndex: 2,
      position: destination,
      instruction: isLeftTurn ? "Turn left into Workspace Bay" : "Turn right into Workspace Bay",
      distanceToNextMeters: Number(dist2.toFixed(1)),
      turnAction: isLeftTurn ? "TURN_LEFT" : "TURN_RIGHT",
    });

    waypoints.push({
      stepIndex: 3,
      position: destination,
      instruction: `Arrived at your reserved desk (${targetSeatNumber})`,
      distanceToNextMeters: 0,
      turnAction: "ARRIVED",
    });
  }

  const estimatedWalkingSeconds = Math.max(5, Math.round(totalDist / 1.1)); // 1.1 m/s indoor walking pace

  return {
    targetSeatId,
    targetSeatNumber,
    targetPosition: destination,
    totalDistanceMeters: Number(totalDist.toFixed(1)),
    estimatedWalkingSeconds,
    waypoints,
  };
}

export type ARCameraFallbackMode = "3d_spatial" | "horizon_locked" | "2d_top_down";

export interface ClampedCameraOrientation {
  offset: Vector3D;
  fallbackMode: ARCameraFallbackMode;
  isCompassReliable: boolean;
  pitchDeg: number;
  rollDeg: number;
}

/**
 * Clamps camera tilt / altitude when compass/gyro sensor reports null or NaN tilt.
 * Falls back to a 2D top-down perspective or forward-facing horizon lock (pitch = 0).
 * Clamps pitch to [-45°, 45°] and roll to [-30°, 30°] to prevent erratic spinning toward the sky.
 */
export function clampCameraOrientation(
  beta: number | null | undefined, // Pitch [-180, 180]
  gamma: number | null | undefined, // Roll [-90, 90]
  options: {
    minPitchDeg?: number;
    maxPitchDeg?: number;
    minRollDeg?: number;
    maxRollDeg?: number;
    forceTopDownOnNull?: boolean;
  } = {}
): ClampedCameraOrientation {
  const minPitch = options.minPitchDeg ?? -45;
  const maxPitch = options.maxPitchDeg ?? 45;
  const minRoll = options.minRollDeg ?? -30;
  const maxRoll = options.maxRollDeg ?? 30;

  const isBetaNullOrInvalid =
    beta === null || beta === undefined || typeof beta !== "number" || isNaN(beta);
  const isGammaNullOrInvalid =
    gamma === null || gamma === undefined || typeof gamma !== "number" || isNaN(gamma);

  if (isBetaNullOrInvalid || isGammaNullOrInvalid) {
    // If device orientation values are null or unreliable, fall back to a 2D top-down perspective or forward-facing horizon lock
    const fallbackMode: ARCameraFallbackMode = options.forceTopDownOnNull
      ? "2d_top_down"
      : "horizon_locked";

    return {
      offset: { x: 0, y: 0, z: 0 },
      fallbackMode,
      isCompassReliable: false,
      pitchDeg: 0,
      rollDeg: 0,
    };
  }

  // Clamp angles within safe forward-facing bounds
  const clampedBeta = Math.max(minPitch, Math.min(maxPitch, beta));
  const clampedGamma = Math.max(minRoll, Math.min(maxRoll, gamma));

  return {
    offset: {
      x: Number(((clampedGamma / 90) * 0.5).toFixed(3)),
      y: Number(((clampedBeta / 180) * 0.3).toFixed(3)),
      z: 0,
    },
    fallbackMode: "3d_spatial",
    isCompassReliable: true,
    pitchDeg: clampedBeta,
    rollDeg: clampedGamma,
  };
}

/**
 * Sensor uncertainty metrics for hybrid outdoor/indoor positioning.
 */
export interface PositioningSensorMetrics {
  /** GPS Horizontal Dilution of Precision (lower is better, e.g. < 1.5 is excellent, > 5.0 is poor) */
  gpsHdop?: number | null;
  /** GPS horizontal accuracy estimate in meters (e.g. 3m outdoors, 20m+ indoors) */
  gpsAccuracyMeters?: number | null;
  /** Variance of WiFi/BLE beacon RSSI measurements (dBm^2) */
  wifiRssiVariance?: number | null;
  /** Number of visible indoor WiFi/BLE beacons */
  beaconCount?: number;
}

export type PositioningSourceMode = "GPS_DOMINANT" | "TRANSITIONING" | "WIFI_BEACON_DOMINANT";

export interface SensorCovarianceWeights {
  gpsVariance: number;
  wifiVariance: number;
  mode: PositioningSourceMode;
  gpsWeight: number; // 0 to 1
  wifiWeight: number; // 0 to 1
}

/**
 * Computes dynamic sensor measurement noise covariance based on sensor uncertainty metrics.
 * When GPS HDOP degrades (e.g. entering a building) and WiFi RSSI beacons become available,
 * dynamically increases GPS measurement variance and decreases WiFi beacon variance to eliminate visual drift.
 */
export function calculateSensorMeasurementCovariance(
  metrics: PositioningSensorMetrics
): SensorCovarianceWeights {
  const hdop = metrics.gpsHdop ?? (metrics.gpsAccuracyMeters ? metrics.gpsAccuracyMeters / 2.5 : 2.0);
  const rssiVar = metrics.wifiRssiVariance ?? 4.0;
  const beacons = metrics.beaconCount ?? 0;

  // Base measurement variances
  // GPS variance scales quadratically with HDOP: R_gps = base * (HDOP^2)
  const baseGpsVariance = 1.0;
  const gpsVariance = Math.max(0.5, baseGpsVariance * Math.pow(Math.max(0.5, hdop), 2));

  // WiFi variance scales with RSSI variance and inversely with beacon density:
  // R_wifi = base / max(1, beacons) + rssiVariance * 0.25
  const baseWifiVariance = 2.0;
  const effectiveBeacons = Math.max(1, beacons);
  let wifiVariance = beacons > 0 ? (baseWifiVariance / effectiveBeacons) + (rssiVar * 0.25) : 100.0;
  wifiVariance = Math.max(0.2, Math.min(100.0, wifiVariance));

  // Determine transition mode and fusion weights
  // Weight inversely proportional to variance: w = (1 / R)
  const invGps = 1 / gpsVariance;
  const invWifi = 1 / wifiVariance;
  const sumInv = invGps + invWifi;
  const gpsWeight = Number((invGps / sumInv).toFixed(3));
  const wifiWeight = Number((invWifi / sumInv).toFixed(3));

  let mode: PositioningSourceMode = "TRANSITIONING";
  if (gpsWeight > 0.75) {
    mode = "GPS_DOMINANT";
  } else if (wifiWeight > 0.75) {
    mode = "WIFI_BEACON_DOMINANT";
  }

  return {
    gpsVariance: Number(gpsVariance.toFixed(3)),
    wifiVariance: Number(wifiVariance.toFixed(3)),
    mode,
    gpsWeight,
    wifiWeight,
  };
}

/**
 * 2D/3D Adaptive Kalman Filter for AR wayfinding that eliminates marker position jumps
 * during outdoor (GPS) to indoor (WiFi/BLE beacons) transitions.
 */
export class AdaptiveWayfindingKalmanFilter {
  private x: [number, number, number]; // [x, y, z] position
  private v: [number, number, number]; // [vx, vy, vz] velocity
  private p: [number, number, number]; // Position error covariance
  private processNoise: number;
  private lastTimestampMs: number;

  constructor(
    initialPosition: Vector3D = { x: 0, y: 0, z: 0 },
    processNoise: number = 0.05
  ) {
    this.x = [initialPosition.x, initialPosition.y, initialPosition.z];
    this.v = [0, 0, 0];
    this.p = [1.0, 1.0, 1.0];
    this.processNoise = processNoise;
    this.lastTimestampMs = Date.now();
  }

  /**
   * Time update (predict step) with velocity damping
   */
  predict(timestampMs: number = Date.now()): Vector3D {
    const dt = Math.max(0.01, Math.min(1.0, (timestampMs - this.lastTimestampMs) / 1000));
    this.lastTimestampMs = timestampMs;

    const damping = 0.95;
    for (let i = 0; i < 3; i++) {
      this.x[i] += this.v[i] * dt;
      this.v[i] *= damping;
      this.p[i] += this.processNoise * dt;
    }

    return this.getPosition();
  }

  /**
   * Measurement update with dynamic covariance weighting between GPS and WiFi beacons
   */
  update(
    measurement: {
      gpsPosition?: Vector3D | null;
      wifiPosition?: Vector3D | null;
      metrics?: PositioningSensorMetrics;
    }
  ): {
    filteredPosition: Vector3D;
    covarianceWeights: SensorCovarianceWeights;
  } {
    const metrics = measurement.metrics ?? {};
    const weights = calculateSensorMeasurementCovariance(metrics);

    // Fuse measurements according to their dynamic weights
    let targetPos: Vector3D;
    let effectiveR: number;

    if (measurement.gpsPosition && measurement.wifiPosition) {
      targetPos = {
        x: measurement.gpsPosition.x * weights.gpsWeight + measurement.wifiPosition.x * weights.wifiWeight,
        y: measurement.gpsPosition.y * weights.gpsWeight + measurement.wifiPosition.y * weights.wifiWeight,
        z: measurement.gpsPosition.z * weights.gpsWeight + measurement.wifiPosition.z * weights.wifiWeight,
      };
      effectiveR = 1 / ((1 / weights.gpsVariance) + (1 / weights.wifiVariance));
    } else if (measurement.wifiPosition) {
      targetPos = measurement.wifiPosition;
      effectiveR = weights.wifiVariance;
    } else if (measurement.gpsPosition) {
      targetPos = measurement.gpsPosition;
      effectiveR = weights.gpsVariance;
    } else {
      return {
        filteredPosition: this.getPosition(),
        covarianceWeights: weights,
      };
    }

    const meas = [targetPos.x, targetPos.y, targetPos.z];

    // Kalman update across 3 dimensions
    for (let i = 0; i < 3; i++) {
      const innovation = meas[i] - this.x[i];
      const innovationCovariance = this.p[i] + effectiveR;
      const kalmanGain = this.p[i] / innovationCovariance;

      this.x[i] += kalmanGain * innovation;
      this.v[i] += kalmanGain * innovation; // estimate velocity adjustment
      this.p[i] = (1 - kalmanGain) * this.p[i];
    }

    return {
      filteredPosition: this.getPosition(),
      covarianceWeights: weights,
    };
  }

  getPosition(): Vector3D {
    return {
      x: Number(this.x[0].toFixed(3)),
      y: Number(this.x[1].toFixed(3)),
      z: Number(this.x[2].toFixed(3)),
    };
  }

  reset(position: Vector3D = { x: 0, y: 0, z: 0 }): void {
    this.x = [position.x, position.y, position.z];
    this.v = [0, 0, 0];
    this.p = [1.0, 1.0, 1.0];
    this.lastTimestampMs = Date.now();
  }
}

