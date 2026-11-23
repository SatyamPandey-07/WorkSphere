import { useEffect, useState } from 'react';

export interface BatteryManagerLike {
  level: number;
  charging: boolean;
  addEventListener: (type: 'levelchange' | 'chargingchange', listener: () => void) => void;
  removeEventListener: (type: 'levelchange' | 'chargingchange', listener: () => void) => void;
}

export interface BatteryOptimizationState {
  isLowPowerMode: boolean;
  batteryLevel: number | null;
  isCharging: boolean | null;
  crdtBatchIntervalMs: number;
  pauseDecorativeAnimations: boolean;
  fftSize: 256 | 2048;
}

export const LOW_BATTERY_THRESHOLD = 0.2;
export const NORMAL_CRDT_BATCH_MS = 50;
export const LOW_POWER_CRDT_BATCH_MS = 500;
export const NORMAL_FFT_SIZE: 2048 = 2048;
export const LOW_POWER_FFT_SIZE: 256 = 256;

export function computeBatteryOptimizationState(
  level: number | null,
  charging: boolean | null
): BatteryOptimizationState {
  const isLowPowerMode =
    typeof level === 'number' &&
    Number.isFinite(level) &&
    charging === false &&
    level < LOW_BATTERY_THRESHOLD;

  return {
    isLowPowerMode,
    batteryLevel: level,
    isCharging: charging,
    crdtBatchIntervalMs: isLowPowerMode
      ? LOW_POWER_CRDT_BATCH_MS
      : NORMAL_CRDT_BATCH_MS,
    pauseDecorativeAnimations: isLowPowerMode,
    fftSize: isLowPowerMode ? LOW_POWER_FFT_SIZE : NORMAL_FFT_SIZE,
  };
}

export function useBatteryOptimization(
  getBatteryFn?: () => Promise<BatteryManagerLike>
): BatteryOptimizationState {
  const [state, setState] = useState<BatteryOptimizationState>(() =>
    computeBatteryOptimizationState(null, null)
  );

  useEffect(() => {
    let cancelled = false;
    let batteryRef: BatteryManagerLike | null = null;

    const syncFromBattery = (mgr: BatteryManagerLike) => {
      if (cancelled) return;
      setState(computeBatteryOptimizationState(mgr.level, mgr.charging));
    };

    const resolveBattery =
      getBatteryFn ??
      (typeof navigator !== 'undefined' &&
      typeof (navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> }).getBattery === 'function'
        ? () =>
            (
              navigator as Navigator & {
                getBattery: () => Promise<BatteryManagerLike>;
              }
            ).getBattery()
        : null);

    if (!resolveBattery) return;

    resolveBattery()
      .then((mgr) => {
        if (cancelled || !mgr) return;
        batteryRef = mgr;
        syncFromBattery(mgr);
        mgr.addEventListener('levelchange', () => syncFromBattery(mgr));
        mgr.addEventListener('chargingchange', () => syncFromBattery(mgr));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (batteryRef) {
        try {
          batteryRef.removeEventListener('levelchange', () =>
            syncFromBattery(batteryRef!)
          );
          batteryRef.removeEventListener('chargingchange', () =>
            syncFromBattery(batteryRef!)
          );
        } catch {}
      }
    };
  }, [getBatteryFn]);

  return state;
}