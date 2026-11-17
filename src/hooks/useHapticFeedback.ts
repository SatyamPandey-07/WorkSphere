"use client";

import { useCallback, useMemo } from "react";

/**
 * Standard tactile haptic patterns.
 */
export const HAPTIC_PATTERNS = {
  /** Light subtle tap for quick interactions (10ms) */
  light: [10],
  /** Success confirmation for completed reservations / check-ins (15ms, pause 50ms, 20ms) */
  success: [15, 50, 20],
  /** Error alert for failed actions or rejections (50ms, pause 100ms, 50ms) */
  error: [50, 100, 50],
} as const;

export type HapticPatternType = keyof typeof HAPTIC_PATTERNS;
export type HapticPatternInput = HapticPatternType | number | number[];

export interface UseHapticFeedbackOptions {
  /** Whether haptic feedback is globally enabled (default: true) */
  enabled?: boolean;
}

export interface UseHapticFeedbackReturn {
  /** Whether the Vibration API (navigator.vibrate) is supported in current environment */
  isSupported: boolean;
  /** Trigger a haptic feedback pattern by name or custom array */
  trigger: (pattern?: HapticPatternInput) => boolean;
  /** Convenient shortcut for light tap pattern ([10]) */
  triggerLight: () => boolean;
  /** Convenient shortcut for success confirmation pattern ([15, 50, 20]) */
  triggerSuccess: () => boolean;
  /** Convenient shortcut for error alert pattern ([50, 100, 50]) */
  triggerError: () => boolean;
  /** Alias for trigger */
  vibrate: (pattern?: HapticPatternInput) => boolean;
}

/**
 * Checks whether navigator.vibrate is supported in the current environment.
 */
export function isHapticSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function"
  );
}

/**
 * Standalone helper to trigger haptic feedback without requiring a React component.
 * Safely falls back on desktop, unsupported browsers, or permission-restricted contexts.
 */
export function triggerHapticFeedback(pattern: HapticPatternInput = "light"): boolean {
  if (!isHapticSupported()) {
    return false;
  }

  let vibrationPattern: number | number[];
  if (typeof pattern === "string") {
    const preset = HAPTIC_PATTERNS[pattern as HapticPatternType];
    vibrationPattern = preset ? [...preset] : [...HAPTIC_PATTERNS.light];
  } else {
    vibrationPattern = Array.isArray(pattern) ? [...pattern] : pattern;
  }

  try {
    return navigator.vibrate(vibrationPattern as number | number[]);
  } catch {
    // Gracefully handle browser restrictions, iframe sandbox limits, or permission denial
    return false;
  }
}

/**
 * React hook to trigger native tactile haptic feedback using navigator.vibrate.
 * Provides fallback handling for desktop or unsupported devices.
 */
export function useHapticFeedback(
  options: UseHapticFeedbackOptions = {}
): UseHapticFeedbackReturn {
  const { enabled = true } = options;

  const isSupported = useMemo(() => isHapticSupported(), []);

  const trigger = useCallback(
    (pattern: HapticPatternInput = "light"): boolean => {
      if (!enabled) {
        return false;
      }
      return triggerHapticFeedback(pattern);
    },
    [enabled]
  );

  const triggerLight = useCallback(() => trigger("light"), [trigger]);
  const triggerSuccess = useCallback(() => trigger("success"), [trigger]);
  const triggerError = useCallback(() => trigger("error"), [trigger]);

  return {
    isSupported,
    trigger,
    triggerLight,
    triggerSuccess,
    triggerError,
    vibrate: trigger,
  };
}

export default useHapticFeedback;
