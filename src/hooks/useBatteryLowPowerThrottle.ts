"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  evaluatePowerMode,
  getWebGLThrottlePolicy,
  getAudioWorkletThrottlePolicy,
  getManualPowerOverride,
  setManualPowerOverride,
  subscribePowerModeChange,
  notifyAudioWorkletLowPower,
  createWebGLFrameThrottler,
  type PowerMode,
  type WebGLThrottlePolicy,
  type AudioWorkletThrottlePolicy,
  type WebGLFrameThrottler,
} from "@/lib/power/lowPowerThrottle";

export interface UseBatteryLowPowerThrottleOptions {
  /** Target sync interval in ms during normal power (default ~16.67ms = 60Hz) */
  normalSyncIntervalMs?: number;
  /** Target sync interval in ms during low power (default 200ms = 5Hz) */
  lowPowerSyncIntervalMs?: number;
  /** Target rendering FPS during normal power (default 60 FPS) */
  normalRenderFps?: number;
  /** Target rendering FPS during low power (default 15 FPS) */
  lowPowerRenderFps?: number;
  /** Custom notification message for low power mode */
  notificationMessage?: string;
  /** Initial manual power mode override */
  initialOverride?: PowerMode | null;
}

export interface UseBatteryLowPowerThrottleReturn {
  // --- Issue #9355 Specification Properties ---
  /** True when battery <= 20% and not charging */
  isLowPowerMode: boolean;
  /** True if the Battery Status API is supported and initialized */
  isBatteryApiSupported: boolean;
  /** Current battery level 0.0 - 1.0, or null if unsupported */
  batteryLevel: number | null;
  /** True when connected to AC power / charging */
  isCharging: boolean;
  /** Current active sync interval (16.67ms normal vs 200ms low power) */
  syncIntervalMs: number;
  /** Current active target rendering FPS (60 normal vs 15 low power) */
  renderFps: number;
  /** Current active render frame interval in ms (1000 / renderFps) */
  renderIntervalMs: number;
  /** Dismiss the low battery notification banner/toast */
  dismissNotification: () => void;
  /** Whether the low battery notification has been dismissed for the current low-power cycle */
  isNotificationDismissed: boolean;

  // --- Backward Compatibility Properties for LowPowerModeIndicator ---
  /** Active power mode tier ("normal" | "low_power" | "critical") */
  mode: PowerMode;
  /** True if low-power or critical throttling is currently active */
  isLowPower: boolean;
  /** True if critical battery throttling is active (<= 10%) */
  isCritical: boolean;
  /** Active WebGL throttling policy */
  webglPolicy: WebGLThrottlePolicy;
  /** Active AudioWorklet throttling policy */
  audioWorkletPolicy: AudioWorkletThrottlePolicy;
  /** Whether device is plugged into AC power (alias for isCharging) */
  charging: boolean;
  /** Active manual power mode override, if any */
  manualOverride: PowerMode | null;
  /** Sets or clears manual power mode override */
  setManualOverride: (override: PowerMode | null) => void;
  /** Frame rate regulator for requestAnimationFrame loops */
  shouldRenderWebGLFrame: (now: number) => boolean;
  /** Directly notifies an AudioWorkletNode of current power policy */
  notifyAudioWorklet: (
    nodeOrPort: AudioWorkletNode | MessagePort | { port?: MessagePort },
  ) => void;
  /** Safe devicePixelRatio clamped by active power policy */
  optimalDpr: number;
}

const LOW_BATTERY_THRESHOLD = 0.2; // 20% inclusive
export const DEFAULT_LOW_POWER_MESSAGE =
  "Low Battery Mode Active: Throttled sync to preserve battery";

// Minimal BatteryManager interface for TypeScript
interface BatteryManager extends EventTarget {
  level: number;
  charging: boolean;
  dischargingTime?: number;
  chargingTime?: number;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

export function useBatteryLowPowerThrottle(
  optionsOrOverride?: UseBatteryLowPowerThrottleOptions | PowerMode | null,
): UseBatteryLowPowerThrottleReturn {
  // Normalize arguments whether called as (options) or (initialOverride)
  const options: UseBatteryLowPowerThrottleOptions =
    typeof optionsOrOverride === "string" || optionsOrOverride === null
      ? { initialOverride: optionsOrOverride }
      : optionsOrOverride ?? {};

  const {
    normalSyncIntervalMs = 1000 / 60, // ~16.67ms
    lowPowerSyncIntervalMs = 200,     // 200ms = 5Hz
    normalRenderFps = 60,             // 60 FPS
    lowPowerRenderFps = 15,           // 15 FPS
    notificationMessage = DEFAULT_LOW_POWER_MESSAGE,
    initialOverride,
  } = options;

  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [isCharging, setIsCharging] = useState<boolean>(false);
  const [isBatteryApiSupported, setIsBatteryApiSupported] = useState<boolean>(false);
  const [isLowPowerMode, setIsLowPowerMode] = useState<boolean>(false);
  const [isNotificationDismissed, setIsNotificationDismissed] = useState<boolean>(false);

  const [manualOverride, setManualOverrideState] = useState<PowerMode | null>(() => {
    return initialOverride !== undefined
      ? initialOverride
      : getManualPowerOverride();
  });

  const { toast } = useToast();
  const prevLowPowerRef = useRef<boolean>(false);
  const hasShownToastRef = useRef<boolean>(false);

  // Sync manual override across subscribers
  useEffect(() => {
    const unsubscribe = subscribePowerModeChange((updatedState) => {
      setManualOverrideState(updatedState.manualOverride);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let isMounted = true;
    let batteryManager: BatteryManager | null = null;

    if (
      typeof navigator === "undefined" ||
      typeof (navigator as any).getBattery !== "function"
    ) {
      if (isMounted) {
        setIsBatteryApiSupported(false);
        setIsLowPowerMode(false);
      }
      return;
    }

    const evaluateState = (b: BatteryManager) => {
      if (!isMounted) return;
      const level = typeof b.level === "number" && Number.isFinite(b.level) ? b.level : null;
      const charging = Boolean(b.charging);

      // Issue #9355 exact condition: level <= 0.20 && charging === false
      const lowPower = level !== null ? level <= LOW_BATTERY_THRESHOLD && !charging : false;

      setBatteryLevel(level);
      setIsCharging(charging);
      setIsBatteryApiSupported(true);
      setIsLowPowerMode(lowPower);

      // Trigger notification upon genuine transition into low power mode
      if (lowPower && !prevLowPowerRef.current) {
        setIsNotificationDismissed(false);
        if (!hasShownToastRef.current && typeof toast === "function") {
          hasShownToastRef.current = true;
          toast(notificationMessage, "warning");
        }
      } else if (!lowPower) {
        // Reset notification trigger when low power ceases
        hasShownToastRef.current = false;
        setIsNotificationDismissed(false);
      }

      prevLowPowerRef.current = lowPower;
    };

    const handleBatteryEvent = () => {
      if (batteryManager && isMounted) {
        evaluateState(batteryManager);
      }
    };

    (navigator as Navigator & { getBattery(): Promise<BatteryManager> })
      .getBattery()
      .then((bm) => {
        if (!isMounted) return;
        batteryManager = bm;
        evaluateState(bm);

        bm.addEventListener("levelchange", handleBatteryEvent);
        bm.addEventListener("chargingchange", handleBatteryEvent);
      })
      .catch(() => {
        if (isMounted) {
          setIsBatteryApiSupported(false);
          setIsLowPowerMode(false);
        }
      });

    return () => {
      isMounted = false;
      if (batteryManager) {
        batteryManager.removeEventListener("levelchange", handleBatteryEvent);
        batteryManager.removeEventListener("chargingchange", handleBatteryEvent);
      }
    };
  }, [notificationMessage, toast]);

  const dismissNotification = useCallback(() => {
    setIsNotificationDismissed(true);
  }, []);

  const syncIntervalMs = useMemo(() => {
    return isLowPowerMode ? lowPowerSyncIntervalMs : normalSyncIntervalMs;
  }, [isLowPowerMode, lowPowerSyncIntervalMs, normalSyncIntervalMs]);

  const renderFps = useMemo(() => {
    return isLowPowerMode ? lowPowerRenderFps : normalRenderFps;
  }, [isLowPowerMode, lowPowerRenderFps, normalRenderFps]);

  const renderIntervalMs = useMemo(() => {
    return 1000 / renderFps;
  }, [renderFps]);

  // Backward compatibility state derivations
  const mode = useMemo(() => {
    return evaluatePowerMode(batteryLevel, isCharging, manualOverride);
  }, [batteryLevel, isCharging, manualOverride]);

  const webglPolicy = useMemo(() => getWebGLThrottlePolicy(mode), [mode]);
  const audioWorkletPolicy = useMemo(
    () => getAudioWorkletThrottlePolicy(mode),
    [mode],
  );

  const policyRef = useRef(webglPolicy);
  useEffect(() => {
    policyRef.current = webglPolicy;
  }, [webglPolicy]);

  const throttlerRef = useRef<WebGLFrameThrottler | null>(null);
  if (!throttlerRef.current) {
    throttlerRef.current = createWebGLFrameThrottler(() => policyRef.current);
  }

  const shouldRenderWebGLFrame = useCallback((now: number): boolean => {
    return throttlerRef.current ? throttlerRef.current.shouldRender(now) : true;
  }, []);

  const handleSetManualOverride = useCallback((newOverride: PowerMode | null) => {
    setManualOverrideState(newOverride);
    setManualPowerOverride(newOverride);
  }, []);

  const notifyAudioWorklet = useCallback(
    (nodeOrPort: AudioWorkletNode | MessagePort | { port?: MessagePort }) => {
      notifyAudioWorkletLowPower(nodeOrPort, audioWorkletPolicy);
    },
    [audioWorkletPolicy],
  );

  const optimalDpr = useMemo(() => {
    const rawDpr =
      typeof window !== "undefined" && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1;
    return Math.min(rawDpr, webglPolicy.maxDpr);
  }, [webglPolicy.maxDpr]);

  return {
    isLowPowerMode,
    isBatteryApiSupported,
    batteryLevel,
    isCharging,
    syncIntervalMs,
    renderFps,
    renderIntervalMs,
    dismissNotification,
    isNotificationDismissed,
    mode,
    isLowPower: isLowPowerMode || mode === "low_power" || mode === "critical",
    isCritical: mode === "critical",
    webglPolicy,
    audioWorkletPolicy,
    charging: isCharging,
    manualOverride,
    setManualOverride: handleSetManualOverride,
    shouldRenderWebGLFrame,
    notifyAudioWorklet,
    optimalDpr,
  };
}

export default useBatteryLowPowerThrottle;
