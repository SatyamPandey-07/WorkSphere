/**
 * Web Audio Auto-Pause Utility
 * Monitors document visibility and device battery saver to auto-pause audio capture.
 */

export interface WebAudioAutoPauseController {
  disconnect: () => void;
  isPaused: () => boolean;
  isDisconnected: () => boolean;
  checkNow: () => void;
  pause: () => void;
  resume: () => void;
}

export interface WebAudioAutoPauseOptions {
  batteryThreshold?: number;
  documentTarget?: {
    hidden: boolean;
    addEventListener: (event: string, handler: () => void) => void;
    removeEventListener: (event: string, handler: () => void) => void;
  };
  getBatteryProvider?: () => Promise<any>;
}

export const DEFAULT_BATTERY_THRESHOLD = 0.2;

/**
 * Normalizes battery threshold to a [0, 1] float.
 * Converts integer percentages (e.g. 20 -> 0.20) and handles non-finite inputs.
 */
export function normalizeBatteryThreshold(threshold?: number): number {
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0) {
    return DEFAULT_BATTERY_THRESHOLD;
  }
  if (threshold > 1 && threshold <= 100) {
    return threshold / 100;
  }
  return Math.min(1, threshold);
}

/**
 * Attaches visibility and battery saver listeners to auto-pause Web Audio processing.
 */
export function attachWebAudioAutoPause(
  onPause: () => void,
  onResume?: () => void,
  optionsOrThreshold: number | WebAudioAutoPauseOptions = DEFAULT_BATTERY_THRESHOLD,
): WebAudioAutoPauseController {
  const options: WebAudioAutoPauseOptions =
    typeof optionsOrThreshold === "number"
      ? { batteryThreshold: optionsOrThreshold }
      : optionsOrThreshold || {};

  const normalizedThreshold = normalizeBatteryThreshold(options.batteryThreshold);
  const doc = options.documentTarget || (typeof document !== "undefined" ? document : null);

  let isPaused = false;
  let isDisconnected = false;
  let cancelled = false;
  let batteryManager: any = null;

  const safeCall = (fn?: () => void, name = "callback") => {
    if (!fn) return;
    try {
      fn();
    } catch (err) {
      console.error(`[WebAudioAutoPause] Error in ${name}:`, err);
    }
  };

  const checkConditions = (b?: any) => {
    if (cancelled) return;
    const isHidden = Boolean(doc && doc.hidden);
    const isLowBattery = Boolean(
      b &&
      !b.charging &&
      typeof b.level === "number" &&
      Number.isFinite(b.level) &&
      b.level <= normalizedThreshold
    );
    const shouldPause = isHidden || isLowBattery;

    if (shouldPause) {
      if (!isPaused) {
        isPaused = true;
        safeCall(onPause, "onPause");
      }
    } else if (isPaused) {
      isPaused = false;
      safeCall(onResume, "onResume");
    }
  };

  const handleVisibility = () => {
    if (cancelled) return;
    checkConditions(batteryManager);
  };

  const handleBattery = () => {
    if (cancelled) return;
    checkConditions(batteryManager);
  };

  if (doc && typeof doc.addEventListener === "function") {
    doc.addEventListener("visibilitychange", handleVisibility);
  }

  const getBatteryFn =
    options.getBatteryProvider ||
    (typeof navigator !== "undefined" && typeof (navigator as any).getBattery === "function"
      ? () => (navigator as any).getBattery()
      : null);

  if (getBatteryFn) {
    getBatteryFn()
      .then((b: any) => {
        if (cancelled) return;
        batteryManager = b;
        checkConditions(b);
        if (b && typeof b.addEventListener === "function") {
          b.addEventListener("levelchange", handleBattery);
          b.addEventListener("chargingchange", handleBattery);
        }
      })
      .catch(() => {
        if (cancelled) return;
        checkConditions();
      });
  } else {
    checkConditions();
  }

  const disconnect = () => {
    if (isDisconnected) return;
    isDisconnected = true;
    cancelled = true;

    if (doc && typeof doc.removeEventListener === "function") {
      try {
        doc.removeEventListener("visibilitychange", handleVisibility);
      } catch (_) {}
    }

    if (batteryManager && typeof batteryManager.removeEventListener === "function") {
      try {
        batteryManager.removeEventListener("levelchange", handleBattery);
        batteryManager.removeEventListener("chargingchange", handleBattery);
      } catch (_) {}
    }
  };

  return {
    disconnect,
    isPaused: () => isPaused,
    isDisconnected: () => isDisconnected,
    checkNow: () => checkConditions(batteryManager),
    pause: () => {
      if (cancelled) return;
      if (!isPaused) {
        isPaused = true;
        safeCall(onPause, "onPause");
      }
    },
    resume: () => {
      if (cancelled) return;
      if (isPaused) {
        isPaused = false;
        safeCall(onResume, "onResume");
      }
    },
  };
}
