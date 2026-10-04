"use client";

import { useEffect, useRef } from "react";
import { useBatteryStatus } from "./useBatteryStatus";

export interface AutoPauseOptions {
  /** Callback triggered when audio capture should pause (hidden tab or battery saver active). */
  onPause: () => void;
  /** Optional callback triggered when tab becomes visible again and battery is healthy. */
  onResume?: () => void;
  /** Whether auto-pause monitoring is currently active (e.g. while recording/capturing). */
  isActive?: boolean;
  /** Low battery threshold ratio (default 0.20 = 20%). */
  batteryThreshold?: number;
}

/**
 * Hook to automatically pause/suspend Web Audio capture when the browser document
 * becomes hidden or when device battery saver / low battery state is active.
 */
export function useWebAudioAutoPause({
  onPause,
  onResume,
  isActive = true,
  batteryThreshold = 0.2,
}: AutoPauseOptions) {
  const battery = useBatteryStatus();
  const wasAutoPausedRef = useRef(false);
  const onPauseRef = useRef(onPause);
  const onResumeRef = useRef(onResume);

  useEffect(() => {
    onPauseRef.current = onPause;
    onResumeRef.current = onResume;
  }, [onPause, onResume]);

  useEffect(() => {
    if (!isActive) {
      wasAutoPausedRef.current = false;
      return;
    }

    const isBatterySaver =
      battery.isSupported &&
      !battery.charging &&
      battery.level !== null &&
      battery.level <= batteryThreshold;

    const checkAutoPause = () => {
      const isHidden = typeof document !== "undefined" && document.hidden;
      const shouldPause = isHidden || isBatterySaver;

      if (shouldPause) {
        if (!wasAutoPausedRef.current) {
          wasAutoPausedRef.current = true;
          onPauseRef.current();
        }
      } else if (wasAutoPausedRef.current) {
        wasAutoPausedRef.current = false;
        if (onResumeRef.current) {
          onResumeRef.current();
        }
      }
    };

    checkAutoPause();

    const handleVisibility = () => {
      checkAutoPause();
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }

    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    };
  }, [isActive, battery.isSupported, battery.charging, battery.level, batteryThreshold]);
}
