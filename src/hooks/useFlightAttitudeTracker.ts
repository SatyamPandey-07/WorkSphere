"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Smoothed aircraft-style attitude produced by the complementary filter.
 * All angles are in degrees.
 */
export interface FlightAttitude {
  /** Nose-up/down angle, -90..90 degrees. */
  pitch: number;
  /** Left/right bank angle, -180..180 degrees. */
  roll: number;
  /** Compass heading (yaw), 0..360 degrees (0 = true north-ish reference). */
  yaw: number;
}

/** Overall status of the tracker. */
export type AttitudePermissionState =
  | "prompt"
  | "granted"
  | "denied"
  | "unsupported";

export interface FlightAttitudeTrackerState {
  /** Latest smoothed attitude. Null until the first sensor samples arrive. */
  attitude: FlightAttitude | null;
  /** Whether the device exposes orientation/motion hardware APIs. */
  isSupported: boolean;
  /** True once live sensor data has been received. */
  isTracking: boolean;
  permissionState: AttitudePermissionState;
  error: string | null;
  /** iOS-13+ style permission request; safe to call on non-iOS browsers. */
  requestPermission: () => Promise<boolean>;
}

export interface UseFlightAttitudeTrackerOptions {
  /**
   * How strongly the accelerometer/magnetometer correction is blended into the
   * gyro-integrated estimate per update (0 = gyro only, 1 = sensors only).
   * Defaults to 0.05 — a classic complementary-filter gain.
   */
  alpha?: number;
  /** Poll the latest smoothed values into state at this interval (ms). */
  updateIntervalMs?: number;
  /** Attach listeners automatically once permission is granted. Default true. */
  autoStart?: boolean;
}

interface OrientationSample {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

interface MotionSample {
  ax: number | null;
  ay: number | null;
  az: number | null;
  rx: number | null; // rotationRate alpha, deg/s
  ry: number | null; // rotationRate beta, deg/s
  rz: number | null; // rotationRate gamma, deg/s
}

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Reject accelerometer corrections beyond this delta — gimbal-lock/jitter spikes. */
const MAX_ACCEL_CORRECTION_DEG = 40;
/** Gravity magnitude used to sanity-check accelerometer readings. */
const GRAVITY = 9.81;
/** Readings this far from 1g are considered in free-fall/vibration and ignored. */
const GRAVITY_TOLERANCE = 3.0;

/**
 * Complementary-filter fusion of DeviceOrientationEvent + DeviceMotionEvent.
 *
 * - Gyro (rotationRate) integrates the fast, smooth attitude.
 * - Accelerometer provides a slow gravity-vector correction (pitch/roll).
 * - Magnetometer/orientation alpha provides slow heading correction (yaw).
 * - Corrections larger than MAX_ACCEL_CORRECTION_DEG are rejected, which is
 *   what kills the classic ±180° gimbal-lock spikes near vertical attitude.
 */
export class FlightAttitudeFusion {
  private pitch = 0;
  private roll = 0;
  private yaw = 0;
  private alphaGain: number;
  private hasFix = false;
  private lastTimestamp: number | null = null;

  constructor(alphaGain = 0.05) {
    this.alphaGain = alphaGain;
  }

  get ready(): boolean {
    return this.hasFix;
  }

  getAttitude(): FlightAttitude {
    return {
      pitch: this.pitch,
      roll: this.roll,
      yaw: ((this.yaw % 360) + 360) % 360,
    };
  }

  /** Feed a devicemotion sample (gyro integration + accelerometer correction). */
  updateMotion(sample: MotionSample, timestamp = Date.now()): void {
    if (sample.az === null || sample.ax === null || sample.ay === null) return;

    const dt = this.lastTimestamp !== null
      ? Math.min(Math.max((timestamp - this.lastTimestamp) / 1000, 0.001), 0.2)
      : null;
    this.lastTimestamp = timestamp;

    // 1) Gyro integration — fast, smooth, drifts slowly.
    if (dt !== null) {
      this.pitch += (sample.rx ?? 0) * dt;
      this.roll += (sample.ry ?? 0) * dt;
      this.yaw += (sample.rz ?? 0) * dt;
    }

    // 2) Accelerometer correction — slow, absolute, noisy.
    const magnitude = Math.sqrt(sample.ax ** 2 + sample.ay ** 2 + sample.az ** 2);
    if (magnitude <= 0 || Math.abs(magnitude - GRAVITY) > GRAVITY_TOLERANCE) {
      this.hasFix = this.hasFix || dt !== null;
      return;
    }

    const accelPitch =
      Math.atan2(-sample.ax, Math.sqrt(sample.ay ** 2 + sample.az ** 2)) * RAD2DEG;
    const accelRoll = Math.atan2(sample.ay, sample.az) * RAD2DEG;

    // Gimbal-lock spike rejection: near vertical, accel-derived roll is
    // ill-defined and can jump ±180°. Only accept corrections that are
    // consistent with the gyro-integrated estimate.
    const pitchDelta = this.wrapDelta(accelPitch - this.pitch);
    const rollDelta = this.wrapDelta(accelRoll - this.roll);

    if (Math.abs(pitchDelta) <= MAX_ACCEL_CORRECTION_DEG) {
      this.pitch += pitchDelta * this.alphaGain;
    }
    if (Math.abs(rollDelta) <= MAX_ACCEL_CORRECTION_DEG) {
      this.roll += rollDelta * this.alphaGain;
    }

    this.hasFix = true;
  }

  /** Feed a deviceorientation sample (magnetometer/orientation yaw correction). */
  updateOrientation(sample: OrientationSample): void {
    let heading: number | null = null;
    if (typeof sample.webkitCompassHeading === "number") {
      heading = sample.webkitCompassHeading;
    } else if (
      typeof sample.alpha === "number" &&
      Number.isFinite(sample.alpha)
    ) {
      heading = ((360 - sample.alpha) % 360 + 360) % 360;
    }

    if (heading === null) return;

    // Correct yaw through the shortest angular path (no ±360 wrap spikes).
    const yawDelta = this.wrapDelta(heading - this.yaw);
    this.yaw += yawDelta * this.alphaGain;
    this.hasFix = true;
  }

  reset(): void {
    this.pitch = 0;
    this.roll = 0;
    this.yaw = 0;
    this.hasFix = false;
    this.lastTimestamp = null;
  }

  /** Shortest signed angular delta in (-180, 180]. */
  private wrapDelta(delta: number): number {
    return ((((delta % 360) + 540) % 360) - 180);
  }
}

/**
 * useFlightAttitudeTracker
 *
 * Merges DeviceOrientationEvent and DeviceMotionEvent via a complementary
 * filter to emit smooth pitch/roll/yaw without jitter or gimbal-lock spikes.
 */
export function useFlightAttitudeTracker(
  options: UseFlightAttitudeTrackerOptions = {},
): FlightAttitudeTrackerState {
  const {
    alpha = 0.05,
    updateIntervalMs = 100,
    autoStart = true,
  } = options;

  const fusionRef = useRef<FlightAttitudeFusion | null>(null);
  if (!fusionRef.current) {
    fusionRef.current = new FlightAttitudeFusion(alpha);
  }

  const [attitude, setAttitude] = useState<FlightAttitude | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [permissionState, setPermissionState] =
    useState<AttitudePermissionState>("prompt");
  const [error, setError] = useState<string | null>(null);

  const listenersRef = useRef<{
    orientation: ((e: DeviceOrientationEvent) => void) | null;
    motion: ((e: DeviceMotionEvent) => void) | null;
    absolute: ((e: DeviceOrientationEvent) => void) | null;
  }>({ orientation: null, motion: null, absolute: null });

  const stopListeners = useCallback(() => {
    if (typeof window === "undefined") return;
    const l = listenersRef.current;
    if (l.orientation) {
      window.removeEventListener("deviceorientation", l.orientation);
      l.orientation = null;
    }
    if (l.absolute) {
      window.removeEventListener(
        "deviceorientationabsolute" as any,
        l.absolute as EventListener,
      );
      l.absolute = null;
    }
    if (l.motion) {
      window.removeEventListener("devicemotion", l.motion);
      l.motion = null;
    }
    setIsTracking(false);
  }, []);

  const startListeners = useCallback(() => {
    if (typeof window === "undefined") return;
    if (listenersRef.current.orientation) return; // already attached

    const fusion = fusionRef.current!;

    const handleOrientation = (event: DeviceOrientationEvent) => {
      fusion.updateOrientation(event as unknown as OrientationSample);
    };
    const handleAbsolute = handleOrientation;
    const handleMotion = (event: DeviceMotionEvent) => {
      fusion.updateMotion(
        {
          ax: event.accelerationIncludingGravity?.x ?? null,
          ay: event.accelerationIncludingGravity?.y ?? null,
          az: event.accelerationIncludingGravity?.z ?? null,
          rx: event.rotationRate?.alpha ?? null,
          ry: event.rotationRate?.beta ?? null,
          rz: event.rotationRate?.gamma ?? null,
        },
        event.timeStamp || Date.now(),
      );
    };

    listenersRef.current.orientation = handleOrientation;
    listenersRef.current.absolute = handleAbsolute;
    listenersRef.current.motion = handleMotion;

    if ("ondeviceorientationabsolute" in window) {
      window.addEventListener(
        "deviceorientationabsolute" as any,
        handleAbsolute as EventListener,
        true,
      );
    }
    window.addEventListener("deviceorientation", handleOrientation, true);
    window.addEventListener("devicemotion", handleMotion, true);
    setIsTracking(true);
  }, []);

  // Detect hardware/API support and iOS permission gating.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const orientationApi = (window as any).DeviceOrientationEvent;
    const motionApi = (window as any).DeviceMotionEvent;

    const supported =
      Boolean(orientationApi) || Boolean(motionApi);
    setIsSupported(supported);

    if (!supported) {
      setPermissionState("unsupported");
      return;
    }

    const needsPermission =
      typeof orientationApi?.requestPermission === "function" ||
      typeof motionApi?.requestPermission === "function";

    if (needsPermission) {
      setPermissionState("prompt");
    } else {
      setPermissionState("granted");
      if (autoStart) startListeners();
    }

    return () => {
      stopListeners();
    };
  }, [autoStart, startListeners, stopListeners]);

  // Periodically publish the smoothed attitude into React state.
  useEffect(() => {
    if (updateIntervalMs <= 0) return;
    const interval = window.setInterval(() => {
      const fusion = fusionRef.current!;
      if (fusion.ready) {
        setAttitude(fusion.getAttitude());
      }
    }, updateIntervalMs);
    return () => window.clearInterval(interval);
  }, [updateIntervalMs]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined") return false;

    const orientationApi = (window as any).DeviceOrientationEvent as
      | { requestPermission?: () => Promise<"granted" | "denied"> }
      | undefined;
    const motionApi = (window as any).DeviceMotionEvent as
      | { requestPermission?: () => Promise<"granted" | "denied"> }
      | undefined;

    try {
      if (typeof orientationApi?.requestPermission === "function") {
        const result = await orientationApi.requestPermission();
        if (result !== "granted") {
          setPermissionState("denied");
          setError("Motion & orientation access was denied.");
          return false;
        }
      }
      if (typeof motionApi?.requestPermission === "function") {
        const result = await motionApi.requestPermission();
        if (result !== "granted") {
          setPermissionState("denied");
          setError("Motion & orientation access was denied.");
          return false;
        }
      }

      setPermissionState("granted");
      setError(null);
      if (autoStart) startListeners();
      return true;
    } catch (err: any) {
      setPermissionState("denied");
      setError(err?.message || "Failed to request motion permission.");
      return false;
    }
  }, [autoStart, startListeners]);

  return {
    attitude,
    isSupported,
    isTracking,
    permissionState,
    error,
    requestPermission,
  };
}
