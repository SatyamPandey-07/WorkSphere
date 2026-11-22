'use client';

import { useEffect, useState } from 'react';

export interface BatteryState {
  level: number;
  charging: boolean;
  isLowPower: boolean;
}

export interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
  addEventListener(
    type: 'levelchange' | 'chargingchange',
    listener: EventListenerOrEventListenerObject | null
  ): void;
  removeEventListener(
    type: 'levelchange' | 'chargingchange',
    listener: EventListenerOrEventListenerObject | null
  ): void;
}

export const LOW_BATTERY_THRESHOLD = 0.2;
export const DEFAULT_CRDT_BATCH_INTERVAL_MS = 50;
export const LOW_POWER_CRDT_BATCH_INTERVAL_MS = 500;
export const DEFAULT_FFT_SIZE = 2048;
export const LOW_POWER_FFT_SIZE = 256;

export interface PowerOptimizationProfile {
  isLowPower: boolean;
  crdtBatchIntervalMs: number;
  fftSize: number;
  pauseDecorativeAnimations: boolean;
}

function normalizeLevel(rawLevel: unknown): number {
  if (typeof rawLevel !== 'number' || !Number.isFinite(rawLevel)) {
    return 1;
  }
  const scaled = rawLevel > 1 ? rawLevel / 100 : rawLevel;
  return Math.max(0, Math.min(1, scaled));
}

export function computeBatteryState(
  rawLevel: unknown,
  charging: unknown,
  threshold = LOW_BATTERY_THRESHOLD
): BatteryState {
  const level = normalizeLevel(rawLevel);
  const isCharging = Boolean(charging);
  const isLowPower = !isCharging && level < threshold;

  return {
    level,
    charging: isCharging,
    isLowPower,
  };
}

export function getPowerOptimizationProfile(
  isLowPower: boolean
): PowerOptimizationProfile {
  if (isLowPower) {
    return {
      isLowPower: true,
      crdtBatchIntervalMs: LOW_POWER_CRDT_BATCH_INTERVAL_MS,
      fftSize: LOW_POWER_FFT_SIZE,
      pauseDecorativeAnimations: true,
    };
  }

  return {
    isLowPower: false,
    crdtBatchIntervalMs: DEFAULT_CRDT_BATCH_INTERVAL_MS,
    fftSize: DEFAULT_FFT_SIZE,
    pauseDecorativeAnimations: false,
  };
}

export function useBatteryOptimization(
  threshold = LOW_BATTERY_THRESHOLD
): BatteryState {
  const [batteryState, setBatteryState] = useState<BatteryState>(() => ({
    level: 1,
    charging: true,
    isLowPower: false,
  }));

  useEffect(() => {
    let active = true;
    let manager: BatteryManagerLike | null = null;

    const handleChange = () => {
      if (!active || !manager) return;
      setBatteryState(computeBatteryState(manager.level, manager.charging, threshold));
    };

    const nav = typeof navigator !== 'undefined'
      ? (navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> })
      : undefined;

    if (typeof nav?.getBattery === 'function') {
      Promise.resolve()
        .then(() => nav.getBattery!())
        .then((bm) => {
          if (!active || !bm) return;
          manager = bm;
          handleChange();
          manager.addEventListener('levelchange', handleChange);
          manager.addEventListener('chargingchange', handleChange);
        })
        .catch(() => {
          if (!active) return;
          setBatteryState({ level: 1, charging: true, isLowPower: false });
        });
    }

    return () => {
      active = false;
      if (manager) {
        manager.removeEventListener('levelchange', handleChange);
        manager.removeEventListener('chargingchange', handleChange);
      }
    };
  }, [threshold]);

  return batteryState;
}