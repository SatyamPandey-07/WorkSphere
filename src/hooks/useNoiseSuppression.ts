"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseNoiseSuppressionOptions {
  /** Audio track to apply noise suppression to. Pass null to disable. */
  track: MediaStreamTrack | null;
}

interface UseNoiseSuppressionReturn {
  /** Whether noise suppression is currently enabled */
  isEnabled: boolean;
  /** Whether the browser supports MediaTrackConstraints.noiseSuppression */
  isSupported: boolean;
  /** Toggle noise suppression on/off */
  toggle: () => void;
  /** Enable noise suppression */
  enable: () => Promise<void>;
  /** Disable noise suppression */
  disable: () => Promise<void>;
}

/**
 * Toggles browser-native noise suppression on a MediaStreamTrack.
 * Uses `MediaStreamTrack.applyConstraints({ noiseSuppression: true/false })`.
 * Falls back gracefully on browsers that don't support the constraint.
 */
export function useNoiseSuppression(
  options: UseNoiseSuppressionOptions,
): UseNoiseSuppressionReturn {
  const { track } = options;
  const [isEnabled, setIsEnabled] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Detect support and read initial state from the track
  useEffect(() => {
    if (!track) {
      setIsSupported(false);
      setIsEnabled(false);
      return;
    }

    // Check if the constraint is supported
    const capabilities = track.getCapabilities?.();
    const supported =
      !!capabilities?.noiseSuppression ||
      typeof (track.applyConstraints) === "function";
    setIsSupported(supported);

    // Read current noiseSuppression setting
    const settings = track.getSettings?.();
    if (settings?.noiseSuppression !== undefined) {
      setIsEnabled(settings.noiseSuppression);
    }
  }, [track]);

  const applyConstraint = useCallback(
    async (value: boolean): Promise<void> => {
      if (!track) return;
      try {
        await track.applyConstraints({ noiseSuppression: value });
        if (mountedRef.current) setIsEnabled(value);
      } catch (err) {
        console.warn("[NoiseSuppression] applyConstraints failed:", err);
        // Silently fail — noiseSuppression may not be supported by this browser
      }
    },
    [track],
  );

  const enable = useCallback(() => applyConstraint(true), [applyConstraint]);
  const disable = useCallback(() => applyConstraint(false), [applyConstraint]);

  const toggle = useCallback(() => {
    applyConstraint(!isEnabled);
  }, [applyConstraint, isEnabled]);

  return { isEnabled, isSupported, toggle, enable, disable };
}
