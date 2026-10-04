/**
 * Web Audio Auto-Pause Utility
 * Monitors document visibility and device battery saver to auto-pause audio capture.
 */

export interface WebAudioAutoPauseController {
  disconnect: () => void;
  isPaused: () => boolean;
}

/**
 * Attaches visibility and battery saver listeners to auto-pause Web Audio processing.
 */
export function attachWebAudioAutoPause(
  onPause: () => void,
  onResume?: () => void,
  batteryThreshold = 0.2,
): WebAudioAutoPauseController {
  let isPaused = false;
  let batteryManager: any = null;

  const checkConditions = (b?: any) => {
    const isHidden = typeof document !== "undefined" && document.hidden;
    const isLowBattery =
      b && !b.charging && b.level !== null && b.level <= batteryThreshold;
    const shouldPause = isHidden || isLowBattery;

    if (shouldPause) {
      if (!isPaused) {
        isPaused = true;
        onPause();
      }
    } else if (isPaused) {
      isPaused = false;
      if (onResume) {
        onResume();
      }
    }
  };

  const handleVisibility = () => {
    checkConditions(batteryManager);
  };

  const handleBattery = () => {
    checkConditions(batteryManager);
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibility);
  }

  if (
    typeof navigator !== "undefined" &&
    typeof (navigator as any).getBattery === "function"
  ) {
    (navigator as any)
      .getBattery()
      .then((b: any) => {
        batteryManager = b;
        checkConditions(b);
        b.addEventListener("levelchange", handleBattery);
        b.addEventListener("chargingchange", handleBattery);
      })
      .catch(() => {});
  } else {
    checkConditions();
  }

  return {
    disconnect: () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
      if (batteryManager) {
        batteryManager.removeEventListener("levelchange", handleBattery);
        batteryManager.removeEventListener("chargingchange", handleBattery);
      }
    },
    isPaused: () => isPaused,
  };
}
