import { useState, useEffect, useRef } from "react";

export type GeolocationPermissionState = "prompt" | "granted" | "denied";

export interface UseGeolocationWatchOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

export interface UseGeolocationWatchResult {
  position: GeolocationPosition | null;
  permissionState: GeolocationPermissionState;
  error: GeolocationPositionError | null;
}

/**
 * Watches the device's geolocation using navigator.geolocation.watchPosition.
 *
 * Centralises permission-state tracking, error handling, and watch cleanup so
 * consumers (e.g. useArrivalDetection) don't need to manage these themselves.
 *
 * @param onPosition - Optional callback invoked on every successful position update.
 * @param options    - Standard PositionOptions forwarded to watchPosition.
 */
export function useGeolocationWatch(
  onPosition?: (position: GeolocationPosition) => void,
  options: UseGeolocationWatchOptions = {},
): UseGeolocationWatchResult {
  const {
    enableHighAccuracy = true,
    timeout = 10000,
    maximumAge = 0,
  } = options;

  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [permissionState, setPermissionState] =
    useState<GeolocationPermissionState>("prompt");
  const [error, setError] = useState<GeolocationPositionError | null>(null);

  // Keep a stable ref so the effect doesn't re-run when the callback changes.
  const onPositionRef = useRef(onPosition);
  useEffect(() => {
    onPositionRef.current = onPosition;
  });

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof navigator === "undefined" ||
      !navigator.geolocation
    ) {
      // Treat missing API as a permanent denial.
      setPermissionState("denied");
      return;
    }

    // Attempt to read the current permission state before starting the watch.
    if (navigator.permissions) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((status) => {
          setPermissionState(status.state as GeolocationPermissionState);
          status.onchange = () => {
            setPermissionState(status.state as GeolocationPermissionState);
          };
        })
        .catch(() => {
          // permissions API not available — leave state as "prompt".
        });
    }

    const handleSuccess = (pos: GeolocationPosition) => {
      setPosition(pos);
      setPermissionState("granted");
      setError(null);
      onPositionRef.current?.(pos);
    };

    const handleError = (err: GeolocationPositionError) => {
      setError(err);
      if (err.code === err.PERMISSION_DENIED) {
        setPermissionState("denied");
      }
    };

    const watchId = navigator.geolocation.watchPosition(
      handleSuccess,
      handleError,
      { enableHighAccuracy, timeout, maximumAge },
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [enableHighAccuracy, timeout, maximumAge]);

  return { position, permissionState, error };
}
