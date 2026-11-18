"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export const DEFAULT_DISTANCE_THRESHOLD_METERS = 15;
export const DEFAULT_VELOCITY_THRESHOLD_MPS = 1.5; // 1.5 m/s restores high precision
export const DEFAULT_STATIONARY_VELOCITY_MPS = 0.5; // <= 0.5 m/s is considered stationary / near zero
export const DEFAULT_THROTTLE_INTERVAL_MS = 30000; // 30 seconds when stationary

export interface ThrottledGeolocationState {
  position: GeolocationPosition | null;
  error: GeolocationPositionError | Error | null;
  isThrottled: boolean;
  isHighPrecision: boolean;
  velocity: number; // m/s
  displacementMeters: number;
  droppedUpdatesCount: number;
  emittedUpdatesCount: number;
}

export interface UseThrottledGeolocationOptions {
  distanceThresholdMeters?: number;
  velocityThresholdMetersPerSec?: number;
  stationaryVelocityThreshold?: number;
  throttleIntervalMs?: number;
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
  onPositionChange?: (position: GeolocationPosition, isThrottled: boolean) => void;
}

/**
 * Calculates great-circle distance between two GPS coordinates in meters
 * using the Haversine formula.
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    return 0;
  }

  const R = 6371000; // Earth's mean radius in meters
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRad) *
      Math.cos(lat2 * toRad) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

/**
 * Evaluates whether an incoming geolocation position update should be throttled
 * to conserve mobile GPS chip battery.
 */
export function evaluatePositionThrottle(
  prevPosition: GeolocationPosition | null,
  newPosition: GeolocationPosition,
  options: {
    distanceThresholdMeters?: number;
    velocityThresholdMetersPerSec?: number;
    stationaryVelocityThreshold?: number;
    throttleIntervalMs?: number;
    lastEmittedTime?: number;
  } = {}
): {
  shouldThrottle: boolean;
  isHighPrecision: boolean;
  displacementMeters: number;
  velocity: number;
} {
  const distanceThreshold =
    options.distanceThresholdMeters ?? DEFAULT_DISTANCE_THRESHOLD_METERS;
  const velocityThreshold =
    options.velocityThresholdMetersPerSec ?? DEFAULT_VELOCITY_THRESHOLD_MPS;
  const stationaryThreshold =
    options.stationaryVelocityThreshold ?? DEFAULT_STATIONARY_VELOCITY_MPS;
  const throttleInterval =
    options.throttleIntervalMs ?? DEFAULT_THROTTLE_INTERVAL_MS;
  const lastEmittedTime = options.lastEmittedTime ?? 0;

  // First reading is never throttled
  if (!prevPosition) {
    const rawSpeed = newPosition.coords.speed;
    const velocity = rawSpeed !== null && rawSpeed !== undefined && rawSpeed >= 0 ? rawSpeed : 0;
    return {
      shouldThrottle: false,
      isHighPrecision: velocity >= velocityThreshold,
      displacementMeters: 0,
      velocity,
    };
  }

  const displacementMeters = calculateHaversineDistanceMeters(
    prevPosition.coords.latitude,
    prevPosition.coords.longitude,
    newPosition.coords.latitude,
    newPosition.coords.longitude
  );

  // Compute velocity from coords.speed or delta displacement / time
  let velocity = 0;
  if (
    newPosition.coords.speed !== null &&
    newPosition.coords.speed !== undefined &&
    newPosition.coords.speed >= 0
  ) {
    velocity = newPosition.coords.speed;
  } else {
    const deltaTimeSeconds = Math.max(
      0.1,
      (newPosition.timestamp - prevPosition.timestamp) / 1000
    );
    velocity = displacementMeters / deltaTimeSeconds;
  }

  // If velocity exceeds threshold (e.g. > 1.5 m/s), immediately restore high-precision tracking
  if (velocity >= velocityThreshold || displacementMeters >= distanceThreshold) {
    return {
      shouldThrottle: false,
      isHighPrecision: true,
      displacementMeters,
      velocity: Number(velocity.toFixed(2)),
    };
  }

  // Displacement < 15m and velocity is near zero (stationary at desk)
  const isNearZeroVelocity = velocity <= stationaryThreshold;
  const timeSinceLastEmit = Date.now() - lastEmittedTime;

  if (isNearZeroVelocity && displacementMeters < distanceThreshold) {
    // Only emit after the throttle interval has elapsed (e.g. 30s)
    const shouldThrottle = timeSinceLastEmit < throttleInterval;
    return {
      shouldThrottle,
      isHighPrecision: false,
      displacementMeters,
      velocity: Number(velocity.toFixed(2)),
    };
  }

  return {
    shouldThrottle: false,
    isHighPrecision: false,
    displacementMeters,
    velocity: Number(velocity.toFixed(2)),
  };
}

/**
 * useThrottledGeolocation
 *
 * Wraps navigator.geolocation.watchPosition with distance and velocity threshold filtering.
 * Automatically throttles updates when stationary (< 15m displacement, near zero velocity)
 * to conserve mobile battery, and restores high precision when velocity exceeds 1.5 m/s.
 */
export function useThrottledGeolocation(
  options: UseThrottledGeolocationOptions = {}
): ThrottledGeolocationState {
  const {
    distanceThresholdMeters = DEFAULT_DISTANCE_THRESHOLD_METERS,
    velocityThresholdMetersPerSec = DEFAULT_VELOCITY_THRESHOLD_MPS,
    stationaryVelocityThreshold = DEFAULT_STATIONARY_VELOCITY_MPS,
    throttleIntervalMs = DEFAULT_THROTTLE_INTERVAL_MS,
    enableHighAccuracy = true,
    timeout = 10000,
    maximumAge = 0,
    onPositionChange,
  } = options;

  const [state, setState] = useState<ThrottledGeolocationState>({
    position: null,
    error: null,
    isThrottled: false,
    isHighPrecision: true,
    velocity: 0,
    displacementMeters: 0,
    droppedUpdatesCount: 0,
    emittedUpdatesCount: 0,
  });

  const lastEmittedPositionRef = useRef<GeolocationPosition | null>(null);
  const lastEmittedTimeRef = useRef<number>(0);
  const droppedCountRef = useRef<number>(0);
  const emittedCountRef = useRef<number>(0);

  const onPositionChangeRef = useRef(onPositionChange);
  useEffect(() => {
    onPositionChangeRef.current = onPositionChange;
  });

  const handlePosition = useCallback(
    (newPosition: GeolocationPosition) => {
      const evaluation = evaluatePositionThrottle(
        lastEmittedPositionRef.current,
        newPosition,
        {
          distanceThresholdMeters,
          velocityThresholdMetersPerSec,
          stationaryVelocityThreshold,
          throttleIntervalMs,
          lastEmittedTime: lastEmittedTimeRef.current,
        }
      );

      if (evaluation.shouldThrottle) {
        droppedCountRef.current += 1;
        setState((prev) => ({
          ...prev,
          isThrottled: true,
          isHighPrecision: false,
          velocity: evaluation.velocity,
          displacementMeters: evaluation.displacementMeters,
          droppedUpdatesCount: droppedCountRef.current,
        }));
        return;
      }

      // Emit update
      emittedCountRef.current += 1;
      lastEmittedPositionRef.current = newPosition;
      lastEmittedTimeRef.current = Date.now();

      setState({
        position: newPosition,
        error: null,
        isThrottled: false,
        isHighPrecision: evaluation.isHighPrecision,
        velocity: evaluation.velocity,
        displacementMeters: evaluation.displacementMeters,
        droppedUpdatesCount: droppedCountRef.current,
        emittedUpdatesCount: emittedCountRef.current,
      });

      onPositionChangeRef.current?.(newPosition, false);
    },
    [
      distanceThresholdMeters,
      velocityThresholdMetersPerSec,
      stationaryVelocityThreshold,
      throttleIntervalMs,
    ]
  );

  const handleError = useCallback((err: GeolocationPositionError) => {
    setState((prev) => ({
      ...prev,
      error: err,
    }));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setState((prev) => ({
        ...prev,
        error: new Error("Geolocation is not supported by this browser"),
      }));
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      handlePosition,
      handleError,
      {
        enableHighAccuracy,
        timeout,
        maximumAge,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [enableHighAccuracy, timeout, maximumAge, handlePosition, handleError]);

  return state;
}

export default useThrottledGeolocation;
