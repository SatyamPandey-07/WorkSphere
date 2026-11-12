"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "@/components/ThemeProvider";

export const DEFAULT_LOW_LUX_THRESHOLD = 15;
export const DEFAULT_DEBOUNCE_DELAY_MS = 5000;

export interface IAmbientLightSensor extends EventTarget {
  illuminance: number | null;
  hasReading: boolean;
  activated: boolean;
  start: () => void;
  stop: () => void;
  addEventListener: (
    type: "reading" | "error" | "activate",
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  removeEventListener: (
    type: "reading" | "error" | "activate",
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ) => void;
}

export interface AmbientLightSensorConstructor {
  new (options?: { frequency?: number }): IAmbientLightSensor;
}

export interface UseAmbientLightSensorOptions {
  threshold?: number;
  debounceMs?: number;
  frequency?: number;
  autoStart?: boolean;
  autoSwitchTheme?: boolean;
  highContrast?: boolean;
  onLuxChange?: (lux: number) => void;
  onDebouncedLuxChange?: (debouncedLux: number) => void;
  onLowLight?: (lux: number) => void;
  onBrightLight?: (lux: number) => void;
}

export interface AmbientLightSensorState {
  illuminance: number | null;
  debouncedLux: number | null;
  isLowLight: boolean;
  isSupported: boolean;
  permissionState: PermissionState | "unknown";
  isActive: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * Checks whether the W3C AmbientLightSensor API is available in the current environment.
 */
export function isAmbientLightSensorSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "AmbientLightSensor" in window &&
    typeof (window as unknown as { AmbientLightSensor: unknown }).AmbientLightSensor === "function"
  );
}

/**
 * Hook to integrate the W3C Ambient Light Sensor API.
 * Tracks workspace lux levels, debounces shifts over 5 seconds to avoid flickering from shadows,
 * and automatically switches the UI into high-contrast dark mode when ambient light drops below 15 lux.
 */
export function useAmbientLightSensor(
  options: UseAmbientLightSensorOptions = {},
): AmbientLightSensorState {
  const {
    threshold = DEFAULT_LOW_LUX_THRESHOLD,
    debounceMs = DEFAULT_DEBOUNCE_DELAY_MS,
    frequency = 1,
    autoStart = true,
    autoSwitchTheme = true,
    highContrast = true,
    onLuxChange,
    onDebouncedLuxChange,
    onLowLight,
    onBrightLight,
  } = options;

  const { setTheme, setHighContrast } = useTheme();

  const [illuminance, setIlluminance] = useState<number | null>(null);
  const [debouncedLux, setDebouncedLux] = useState<number | null>(null);
  const [isLowLight, setIsLowLight] = useState<boolean>(false);
  const [permissionState, setPermissionState] = useState<PermissionState | "unknown">("unknown");
  const [isActive, setIsActive] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const sensorRef = useRef<IAmbientLightSensor | null>(null);
  const permStatusRef = useRef<PermissionStatus | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const isSupported = isAmbientLightSensorSupported();

  // 1. Debounce lux shifts over 5 seconds to eliminate transient shadow flicker
  useEffect(() => {
    if (illuminance === null) return;

    const timer = setTimeout(() => {
      setDebouncedLux(illuminance);
      onDebouncedLuxChange?.(illuminance);

      const isDim = illuminance < threshold;
      setIsLowLight(isDim);

      if (isDim) {
        onLowLight?.(illuminance);
        if (autoSwitchTheme) {
          setTheme("dark");
          if (highContrast) {
            setHighContrast(true);
          }
        }
      } else {
        onBrightLight?.(illuminance);
        if (autoSwitchTheme) {
          setTheme("light");
          if (highContrast) {
            setHighContrast(false);
          }
        }
      }
    }, debounceMs);

    return () => {
      clearTimeout(timer);
    };
  }, [
    illuminance,
    threshold,
    debounceMs,
    autoSwitchTheme,
    highContrast,
    setTheme,
    setHighContrast,
    onDebouncedLuxChange,
    onLowLight,
    onBrightLight,
  ]);

  // 2. Stop sensor
  const stop = useCallback(() => {
    if (sensorRef.current) {
      try {
        sensorRef.current.stop();
      } catch {
        // Ignore stop errors if already stopped
      }
      sensorRef.current = null;
    }
    setIsActive(false);
  }, []);

  // 3. Start sensor with feature detection and permission guards
  const start = useCallback(async () => {
    if (!isAmbientLightSensorSupported()) {
      setError("AmbientLightSensor API is not supported in this browser.");
      return;
    }

    setError(null);

    // Permission guard
    if (typeof navigator !== "undefined" && navigator.permissions?.query) {
      try {
        const permStatus = await navigator.permissions.query({
          name: "ambient-light-sensor" as PermissionName,
        });
        permStatusRef.current = permStatus;
        setPermissionState(permStatus.state);

        permStatus.onchange = () => {
          if (!isMountedRef.current) return;
          setPermissionState(permStatus.state);
          if (permStatus.state === "denied") {
            stop();
            setError("Ambient light sensor permission was denied.");
          }
        };

        if (permStatus.state === "denied") {
          setError("Ambient light sensor permission is denied.");
          setIsActive(false);
          return;
        }
      } catch {
        // Some browser engines do not recognize "ambient-light-sensor" in permissions.query
        setPermissionState("unknown");
      }
    }

    try {
      const SensorClass = (window as unknown as { AmbientLightSensor: AmbientLightSensorConstructor })
        .AmbientLightSensor;

      const sensor = new SensorClass({ frequency });
      sensorRef.current = sensor;

      const onReading = () => {
        if (!isMountedRef.current) return;
        if (sensor.illuminance !== null && !isNaN(sensor.illuminance)) {
          setIlluminance(sensor.illuminance);
          onLuxChange?.(sensor.illuminance);
        }
      };

      const onError = (event: Event) => {
        if (!isMountedRef.current) return;
        const err = (event as unknown as { error?: Error }).error;
        const message = err?.message || "AmbientLightSensor encountered a reading error.";
        setError(message);
        setIsActive(false);
      };

      sensor.addEventListener("reading", onReading as EventListener);
      sensor.addEventListener("error", onError as EventListener);

      sensor.start();
      setIsActive(true);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to initialize AmbientLightSensor.";
      setError(message);
      setIsActive(false);
    }
  }, [frequency, onLuxChange, stop]);

  // 4. Auto-start lifecycle
  useEffect(() => {
    isMountedRef.current = true;
    if (autoStart && isSupported) {
      start();
    }

    return () => {
      isMountedRef.current = false;
      stop();
      if (permStatusRef.current) {
        permStatusRef.current.onchange = null;
        permStatusRef.current = null;
      }
    };
  }, [autoStart, isSupported, start, stop]);

  return {
    illuminance,
    debouncedLux,
    isLowLight,
    isSupported,
    permissionState,
    isActive,
    error,
    start,
    stop,
  };
}
