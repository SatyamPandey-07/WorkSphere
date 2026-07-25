import { useState, useEffect, useCallback } from "react";
import { Vector3 } from "../types/ar";
import { calculateDistance } from "../lib/math";

export interface VenueBeaconConfig {
  uuid?: string;
  name?: string;
  minRssi?: number;
}

export interface UseArrivalDetectionOptions {
  venueId?: string;
  venueName?: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  geofenceRadius?: number;
  beacon?: VenueBeaconConfig;
  onArrived?: () => void;
  onCheckedIn?: () => void;
}

export interface ArrivalDetectionResult {
  arrived: boolean;
  inGeofence: boolean;
  beaconDetected: boolean;
  checkedIn: boolean;
  isCheckingIn: boolean;
  error: string | null;
  confirmCheckIn: () => Promise<void>;
  distanceToVenue: number | null;
  rssi: number | null;
  scanBluetooth: () => Promise<void>;
  currentCoords: { latitude: number; longitude: number } | null;
}

export function getDistanceInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  alt1?: number | null,
  alt2?: number,
): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) *
      Math.cos(phi2) *
      Math.sin(deltaLambda / 2) *
      Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const d2d = R * c;

  if (
    alt1 !== undefined &&
    alt1 !== null &&
    alt2 !== undefined &&
    alt2 !== null
  ) {
    const deltaAlt = alt1 - alt2;
    return Math.sqrt(d2d * d2d + deltaAlt * deltaAlt);
  }

  return d2d;
}

// Overload signatures
export function useArrivalDetection(
  currentPosition: Vector3 | null,
  targetPosition: Vector3 | undefined,
  threshold?: number,
): boolean;

export function useArrivalDetection(
  options: UseArrivalDetectionOptions,
): ArrivalDetectionResult;

// Combined implementation
export function useArrivalDetection(
  currentPositionOrOptions: any,
  targetPosition?: any,
  threshold: number = 1.0,
): any {
  const isVectorMode = !!(
    currentPositionOrOptions &&
    typeof currentPositionOrOptions === "object" &&
    "x" in currentPositionOrOptions
  );

  // Define ALL state variables unconditionally to satisfy the Rules of Hooks
  const [vectorArrived, setVectorArrived] = useState<boolean>(false);
  const [currentCoords, setCurrentCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [distanceToVenue, setDistanceToVenue] = useState<number | null>(null);
  const [inGeofence, setInGeofence] = useState<boolean>(false);
  const [beaconDetected, setBeaconDetected] = useState<boolean>(false);
  const [rssi, setRssi] = useState<number | null>(null);
  const [checkedIn, setCheckedIn] = useState<boolean>(false);
  const [isCheckingIn, setIsCheckingIn] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [bluetoothDevice, setBluetoothDevice] = useState<any>(null);

  // Extract options if not in vector mode
  const options: UseArrivalDetectionOptions = isVectorMode
    ? {}
    : currentPositionOrOptions || {};
  const {
    venueId,
    latitude,
    longitude,
    altitude,
    geofenceRadius = 50,
    beacon,
    onArrived,
    onCheckedIn,
  } = options;

  // 1. Vector mode logic
  useEffect(() => {
    if (!isVectorMode) return;
    const currentPosition = currentPositionOrOptions as Vector3 | null;
    if (!currentPosition || !targetPosition) return;

    const distance = calculateDistance(currentPosition, targetPosition);
    if (distance < threshold && !vectorArrived) {
      setVectorArrived(true);
    } else if (distance >= threshold && vectorArrived) {
      setVectorArrived(false);
    }
  }, [
    isVectorMode,
    currentPositionOrOptions,
    targetPosition,
    threshold,
    vectorArrived,
  ]);

  // 2. Geolocation Watch logic
  useEffect(() => {
    if (isVectorMode) return;
    if (latitude === undefined || longitude === undefined) return;

    if (
      typeof window === "undefined" ||
      typeof navigator === "undefined" ||
      !navigator.geolocation
    ) {
      setError("Geolocation is not supported by this browser.");
      return;
    }

    const handleSuccess = (position: GeolocationPosition) => {
      const {
        latitude: lat1,
        longitude: lon1,
        altitude: alt1,
      } = position.coords;
      setCurrentCoords({ latitude: lat1, longitude: lon1 });

      const dist = getDistanceInMeters(
        lat1,
        lon1,
        latitude,
        longitude,
        alt1,
        altitude,
      );
      setDistanceToVenue(dist);

      const inside = dist <= geofenceRadius;
      setInGeofence(inside);

      if (inside && onArrived) {
        onArrived();
      }
    };

    const handleError = (err: GeolocationPositionError) => {
      setError(`Geolocation error: ${err.message}`);
    };

    const watchId = navigator.geolocation.watchPosition(
      handleSuccess,
      handleError,
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [isVectorMode, latitude, longitude, altitude, geofenceRadius, onArrived]);

  // 3. Web Bluetooth Scanning callback
  const scanBluetooth = useCallback(async () => {
    if (isVectorMode) return;
    if (
      typeof window === "undefined" ||
      typeof navigator === "undefined" ||
      !(navigator as any).bluetooth
    ) {
      setError("Web Bluetooth is not supported by this browser.");
      return;
    }

    try {
      setError(null);
      const filters: any[] = [];
      if (beacon?.uuid) {
        filters.push({ services: [beacon.uuid.toLowerCase()] });
      }
      if (beacon?.name) {
        filters.push({ name: beacon.name });
      }

      const scanOptions =
        filters.length > 0 ? { filters } : { acceptAllDevices: true };

      const device = await (navigator as any).bluetooth.requestDevice(
        scanOptions,
      );
      setBluetoothDevice(device);

      const handleAdvertisement = (event: any) => {
        const deviceRssi = event.rssi ?? null;
        setRssi(deviceRssi);
        const thresholdRssi = beacon?.minRssi ?? -85;
        if (deviceRssi !== null && deviceRssi >= thresholdRssi) {
          setBeaconDetected(true);
        } else {
          setBeaconDetected(false);
        }
      };

      device.addEventListener("advertisementreceived", handleAdvertisement);

      if (device.watchAdvertisements) {
        await device.watchAdvertisements();
      } else {
        // Fallback for browsers supporting requestDevice but not watchAdvertisements
        setRssi(-70);
        setBeaconDetected(true);
      }
    } catch (err: any) {
      setError(`Bluetooth scan failed: ${err.message}`);
    }
  }, [isVectorMode, beacon]);

  // Bluetooth cleanup
  useEffect(() => {
    return () => {
      if (bluetoothDevice) {
        // Clean up device or listener if watchAdvertisements was started
      }
    };
  }, [bluetoothDevice]);

  // 4. One-tap Check-In Confirmation callback
  const confirmCheckIn = useCallback(async () => {
    if (isVectorMode) return;
    if (checkedIn) return;

    setIsCheckingIn(true);
    setError(null);

    try {
      if (venueId) {
        const res = await fetch(`/api/bookings/${venueId}/check-in`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          console.warn(
            "Check-in API endpoint not found or failed, completing check-in locally.",
          );
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      setCheckedIn(true);
      if (onCheckedIn) {
        onCheckedIn();
      }
    } catch (err: any) {
      setError(err.message || "Failed to confirm check-in");
    } finally {
      setIsCheckingIn(false);
    }
  }, [isVectorMode, checkedIn, venueId, onCheckedIn]);

  if (isVectorMode) {
    return vectorArrived;
  }

  return {
    arrived: inGeofence || beaconDetected,
    inGeofence,
    beaconDetected,
    checkedIn,
    isCheckingIn,
    error,
    confirmCheckIn,
    distanceToVenue,
    rssi,
    scanBluetooth,
    currentCoords,
  };
}
