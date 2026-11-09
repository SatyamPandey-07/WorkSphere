"use client";

import { useEffect, useState } from "react";

export interface BatteryState {
  /** Battery charge level 0–1, or null if API not supported */
  level: number | null;
  /** True when charging */
  charging: boolean;
  /** Estimated seconds until fully discharged, or Infinity/null */
  dischargingTime: number | null;
  /** True when level < LOW_BATTERY_THRESHOLD and not charging */
  isLow: boolean;
  /** True when level < PANIC_THRESHOLD and not charging */
  isPanic: boolean;
  /** True if the Battery Status API is available in this browser */
  isSupported: boolean;
}

const LOW_BATTERY_THRESHOLD = 0.2;  // 20%
const PANIC_THRESHOLD = 0.1;        // 10%

const INITIAL_STATE: BatteryState = {
  level: null,
  charging: false,
  dischargingTime: null,
  isLow: false,
  isPanic: false,
  isSupported: false,
};

/**
 * Tracks battery level and charging state via the Battery Status API.
 * Returns `isPanic = true` when level ≤ 10% and not charging — used to
 * automatically bias venue searches toward outlets/charging points.
 */
export function useBatteryStatus(): BatteryState {
  const [state, setState] = useState<BatteryState>(INITIAL_STATE);

  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      typeof (navigator as any).getBattery !== "function"
    ) {
      return;
    }

    let isMounted = true;
    let battery: BatteryManager | null = null;

    const update = (b: BatteryManager) => {
      if (!isMounted) return;
      const level = b.level;
      const charging = b.charging;
      setState({
        level,
        charging,
        dischargingTime:
          b.dischargingTime === Infinity ? null : b.dischargingTime,
        isLow: !charging && level <= LOW_BATTERY_THRESHOLD,
        isPanic: !charging && level <= PANIC_THRESHOLD,
        isSupported: true,
      });
    };

    const handleBatteryChange = () => {
      if (battery && isMounted) {
        update(battery);
      }
    };

    (navigator as Navigator & { getBattery(): Promise<BatteryManager> })
      .getBattery()
      .then((b) => {
        if (!isMounted) return;
        battery = b;
        update(b);
        b.addEventListener("levelchange", handleBatteryChange);
        b.addEventListener("chargingchange", handleBatteryChange);
        b.addEventListener("dischargingtimechange", handleBatteryChange);
      })
      .catch(() => {
        // API rejected (e.g. Firefox 106+ disabling it for privacy)
      });

    return () => {
      isMounted = false;
      if (battery) {
        battery.removeEventListener("levelchange", handleBatteryChange);
        battery.removeEventListener("chargingchange", handleBatteryChange);
        battery.removeEventListener("dischargingtimechange", handleBatteryChange);
      }
    };
  }, []);

  return state;
}

// Minimal BatteryManager interface for TypeScript (not in all lib.dom.d.ts versions)
interface BatteryManager extends EventTarget {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  onlevelchange: EventListener | null;
  onchargingchange: EventListener | null;
  onchargingtimechange: EventListener | null;
  ondischargingtimechange: EventListener | null;
}
