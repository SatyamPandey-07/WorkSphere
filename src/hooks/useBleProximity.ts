"use client";

import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Standard BLE Proximity Status
 */
export type BleProximityStatus =
  | "idle"
  | "searching"
  | "nearby"
  | "connected"
  | "unsupported";

/**
 * BLE Beacon device information
 */
export interface BleBeaconInfo {
  id?: string;
  name?: string;
  rssi: number | null;
  rawRssi: number | null;
  distanceMeters: number | null;
  lastSeen: number | null;
}

/**
 * Configuration options for useBleProximity
 */
export interface UseBleProximityOptions {
  /**
   * Reference RSSI in dBm measured at 1 meter (RSSI₀).
   * Typical default for indoor BLE beacons is -59 dBm.
   */
  referenceRssi?: number;
  /**
   * Environmental path-loss exponent (n).
   * Typically 2.0 in free space; 2.5–3.5 in partitioned indoor coworking spaces/offices.
   * Defaults to 2.5.
   */
  pathLossExponent?: number;
  /**
   * Exponential Moving Average (EMA) smoothing coefficient alpha (0 < alpha <= 1).
   * Lower values produce smoother, slower-reacting distance estimates.
   * Defaults to 0.25.
   */
  smoothingFactor?: number;
  /**
   * Optional service UUIDs to filter scan requests.
   */
  serviceUuids?: (string | number)[];
  /**
   * Threshold distance in meters under which a beacon is classified as "nearby".
   * Defaults to 3.0 meters.
   */
  nearbyThresholdMeters?: number;
  /**
   * Custom requestDevice options override.
   */
  requestOptions?: BluetoothRequestOptions;
}

/**
 * Return interface for useBleProximity hook
 */
export interface BleProximityResult {
  status: BleProximityStatus;
  distance: number | null;
  rssi: number | null;
  rawRssi: number | null;
  error: string | null;
  isSupported: boolean;
  beacon: BleBeaconInfo | null;
  startScanning: () => Promise<void>;
  stopScanning: () => void;
}

/** Default 1-meter reference RSSI (dBm) */
export const DEFAULT_REFERENCE_RSSI = -59;

/** Default path loss exponent for coworking/office environments */
export const DEFAULT_PATH_LOSS_EXPONENT = 2.5;

/** Default EMA smoothing alpha */
export const DEFAULT_SMOOTHING_FACTOR = 0.25;

/** Default nearby distance threshold in meters */
export const DEFAULT_NEARBY_THRESHOLD_METERS = 3.0;

/**
 * Calculates estimated distance (in meters) from RSSI using the standard log-distance path-loss model:
 *
 * d = 10 ^ ((RSSI_0 - RSSI) / (10 * n))
 *
 * Note: RSSI distance is an approximation influenced by physical walls, multipath fading,
 * human body occlusion, radio interference, beacon orientation, and device antenna characteristics.
 * It must not be treated as a millimeter-precision measurement.
 *
 * @param rssi Measured or smoothed signal strength in dBm.
 * @param referenceRssi Calibrated RSSI at 1 meter (RSSI₀, typically -59 dBm).
 * @param pathLossExponent Environmental path loss exponent (n, typically 2.0 - 4.0).
 * @returns Estimated distance in meters (bounded and validated), or null if inputs are invalid.
 */
export function estimateRssiDistance(
  rssi: number | null | undefined,
  referenceRssi: number = DEFAULT_REFERENCE_RSSI,
  pathLossExponent: number = DEFAULT_PATH_LOSS_EXPONENT,
): number | null {
  if (
    rssi === null ||
    rssi === undefined ||
    !Number.isFinite(rssi) ||
    !Number.isFinite(referenceRssi) ||
    !Number.isFinite(pathLossExponent) ||
    pathLossExponent <= 0
  ) {
    return null;
  }

  // Reject physically implausible RSSI values (typically between -120 dBm and +20 dBm)
  if (rssi < -120 || rssi > 20) {
    return null;
  }

  try {
    const exponent = (referenceRssi - rssi) / (10 * pathLossExponent);
    const distance = Math.pow(10, exponent);

    if (!Number.isFinite(distance) || distance <= 0 || Number.isNaN(distance)) {
      return null;
    }

    // Return rounded to two decimal places
    return Math.round(distance * 100) / 100;
  } catch {
    return null;
  }
}

/**
 * Computes Exponential Moving Average (EMA) smoothing for noisy RSSI signal streams:
 *
 * EMA_t = alpha * RSSI_t + (1 - alpha) * EMA_{t-1}
 *
 * @param currentRssi Newly observed raw RSSI reading.
 * @param previousEma Previous smoothed RSSI value (or null for first reading).
 * @param alpha Smoothing factor (0 < alpha <= 1).
 */
export function computeEmaRssi(
  currentRssi: number,
  previousEma: number | null,
  alpha: number = DEFAULT_SMOOTHING_FACTOR,
): number | null {
  if (!Number.isFinite(currentRssi) || currentRssi < -120 || currentRssi > 20) {
    return previousEma;
  }

  const validAlpha = Number.isFinite(alpha) && alpha > 0 && alpha <= 1
    ? alpha
    : DEFAULT_SMOOTHING_FACTOR;

  if (previousEma === null || !Number.isFinite(previousEma)) {
    return currentRssi;
  }

  const smoothed = validAlpha * currentRssi + (1 - validAlpha) * previousEma;
  return Math.round(smoothed * 10) / 10;
}

/**
 * Detects whether Web Bluetooth API is available in the current browser runtime.
 * Safely guards against SSR environments and browsers without Web Bluetooth.
 */
export function isBluetoothApiSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  return Boolean(
    navigator.bluetooth &&
    typeof navigator.bluetooth.requestDevice === "function",
  );
}

/**
 * React hook for client-side BLE beacon detection and RSSI-based proximity estimation.
 */
export function useBleProximity(
  options: UseBleProximityOptions = {},
): BleProximityResult {
  const {
    referenceRssi = DEFAULT_REFERENCE_RSSI,
    pathLossExponent = DEFAULT_PATH_LOSS_EXPONENT,
    smoothingFactor = DEFAULT_SMOOTHING_FACTOR,
    serviceUuids,
    nearbyThresholdMeters = DEFAULT_NEARBY_THRESHOLD_METERS,
    requestOptions,
  } = options;

  const [status, setStatus] = useState<BleProximityStatus>("idle");
  const [distance, setDistance] = useState<number | null>(null);
  const [rssi, setRssi] = useState<number | null>(null);
  const [rawRssi, setRawRssi] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState<boolean>(false);
  const [beacon, setBeacon] = useState<BleBeaconInfo | null>(null);

  const deviceRef = useRef<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const smoothedRssiRef = useRef<number | null>(null);
  const advertisementListenerRef = useRef<((event: any) => void) | null>(null);

  // Check browser capability on mount
  useEffect(() => {
    isMountedRef.current = true;
    const supported = isBluetoothApiSupported();
    setIsSupported(supported);
    if (!supported) {
      setStatus("unsupported");
    }

    return () => {
      isMountedRef.current = false;
      stopScanningInternal();
    };
  }, []);

  const resetSmoothing = useCallback(() => {
    smoothedRssiRef.current = null;
    setRssi(null);
    setRawRssi(null);
    setDistance(null);
  }, []);

  const handleRssiUpdate = useCallback(
    (measuredRssi: number, deviceId?: string, deviceName?: string) => {
      if (!isMountedRef.current) return;

      const smoothed = computeEmaRssi(
        measuredRssi,
        smoothedRssiRef.current,
        smoothingFactor,
      );

      smoothedRssiRef.current = smoothed;
      const estimatedDist = estimateRssiDistance(
        smoothed,
        referenceRssi,
        pathLossExponent,
      );

      setRawRssi(measuredRssi);
      setRssi(smoothed);
      setDistance(estimatedDist);

      const isNearby =
        estimatedDist !== null && estimatedDist <= nearbyThresholdMeters;
      setStatus(isNearby ? "nearby" : "connected");

      setBeacon({
        id: deviceId,
        name: deviceName,
        rssi: smoothed,
        rawRssi: measuredRssi,
        distanceMeters: estimatedDist,
        lastSeen: Date.now(),
      });
    },
    [nearbyThresholdMeters, pathLossExponent, referenceRssi, smoothingFactor],
  );

  const stopScanningInternal = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    const device = deviceRef.current;
    const listener = advertisementListenerRef.current;

    if (device && listener) {
      try {
        device.removeEventListener("advertisementreceived", listener);
      } catch {
        // ignore
      }
    }

    if (device?.unwatchAdvertisements) {
      try {
        device.unwatchAdvertisements().catch(() => {});
      } catch {
        // ignore
      }
    }

    if (device?.gatt?.connected) {
      try {
        device.gatt.disconnect();
      } catch {
        // ignore
      }
    }

    deviceRef.current = null;
    advertisementListenerRef.current = null;
    smoothedRssiRef.current = null;
  }, []);

  const stopScanning = useCallback(() => {
    stopScanningInternal();
    if (!isMountedRef.current) return;
    setStatus(isSupported ? "idle" : "unsupported");
    setError(null);
    setDistance(null);
    setRssi(null);
    setRawRssi(null);
    setBeacon(null);
  }, [isSupported, stopScanningInternal]);

  const startScanning = useCallback(async () => {
    if (!isBluetoothApiSupported()) {
      setStatus("unsupported");
      setError("Web Bluetooth API is not supported in this browser.");
      return;
    }

    stopScanningInternal();
    resetSmoothing();
    setError(null);
    setStatus("searching");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const defaultOptions: BluetoothRequestOptions = serviceUuids && serviceUuids.length > 0
        ? {
            filters: serviceUuids.map((uuid) => ({ services: [uuid] })),
            optionalServices: serviceUuids,
          }
        : {
            acceptAllDevices: true,
          };

      const finalOptions = requestOptions || defaultOptions;

      const device = await navigator.bluetooth.requestDevice(finalOptions);

      if (!isMountedRef.current || controller.signal.aborted) {
        return;
      }

      deviceRef.current = device;

      // Listen for disconnection
      device.addEventListener("gattserverdisconnected", () => {
        if (!isMountedRef.current) return;
        setStatus("searching");
        resetSmoothing();
        setBeacon((prev) => (prev ? { ...prev, rssi: null, distanceMeters: null } : null));
      });

      // Continuous RSSI via Web Bluetooth Advertisements if supported by the browser
      if (typeof device.watchAdvertisements === "function") {
        const adListener = (event: any) => {
          if (!isMountedRef.current || controller.signal.aborted) return;
          const incomingRssi = event?.rssi;
          if (typeof incomingRssi === "number") {
            handleRssiUpdate(incomingRssi, device.id, device.name);
          }
        };

        advertisementListenerRef.current = adListener;
        device.addEventListener("advertisementreceived", adListener);

        try {
          await device.watchAdvertisements({ signal: controller.signal });
          setStatus("connected");
          return;
        } catch {
          // If watchAdvertisements fails or is not enabled, fall through to GATT connection
        }
      }

      // Fallback: Connect via GATT if advertisement watching is unavailable or denied
      if (device.gatt) {
        await device.gatt.connect();
        if (!isMountedRef.current || controller.signal.aborted) return;
        setStatus("connected");
        setBeacon({
          id: device.id,
          name: device.name,
          rssi: null,
          rawRssi: null,
          distanceMeters: null,
          lastSeen: Date.now(),
        });
      } else {
        setStatus("connected");
      }
    } catch (err: unknown) {
      if (!isMountedRef.current || controller.signal.aborted) return;

      const errorObj = err as any;
      const errorName = String(errorObj?.name || "");
      const errorMessage = String(errorObj?.message || err || "").toLowerCase();

      // Handle user cancellation gracefully
      if (
        errorName === "NotFoundError" ||
        errorMessage.includes("user cancelled") ||
        errorMessage.includes("user canceled")
      ) {
        setStatus("idle");
        setError(null);
        return;
      }

      // Handle permission denied or security errors
      if (
        errorName === "SecurityError" ||
        errorMessage.includes("permission denied") ||
        errorMessage.includes("security")
      ) {
        setStatus("idle");
        setError("Bluetooth access permission was denied.");
        return;
      }

      setStatus("idle");
      setError(errorObj?.message || "Failed to scan for Bluetooth beacon.");
    }
  }, [
    handleRssiUpdate,
    requestOptions,
    resetSmoothing,
    serviceUuids,
    stopScanningInternal,
  ]);

  return {
    status,
    distance,
    rssi,
    rawRssi,
    error,
    isSupported,
    beacon,
    startScanning,
    stopScanning,
  };
}
