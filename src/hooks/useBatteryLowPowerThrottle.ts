"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useBatteryStatus } from "./useBatteryStatus";
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
  type BatteryLowPowerState,
  type WebGLThrottlePolicy,
  type AudioWorkletThrottlePolicy,
  type WebGLFrameThrottler,
} from "@/lib/power/lowPowerThrottle";

export interface UseBatteryLowPowerThrottleReturn {
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
  /** Current battery level (0.0 - 1.0) or null */
  batteryLevel: number | null;
  /** Whether device is plugged into AC power */
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

/**
 * Hook to provide battery-aware low-power mode throttling for WebGL and Audio Worklets.
 * Dynamically switches between 60 FPS / 30 FPS / 15 FPS rendering policies and throttles
 * AudioWorklet telemetry IPC based on real-time battery status and power policies.
 */
export function useBatteryLowPowerThrottle(
  initialOverride?: PowerMode | null,
): UseBatteryLowPowerThrottleReturn {
  const battery = useBatteryStatus();
  const [manualOverride, setManualOverrideState] = useState<PowerMode | null>(() => {
    return initialOverride !== undefined
      ? initialOverride
      : getManualPowerOverride();
  });

  // Keep manual override synced across tabs / components
  useEffect(() => {
    const unsubscribe = subscribePowerModeChange((updatedState) => {
      setManualOverrideState(updatedState.manualOverride);
    });
    return unsubscribe;
  }, []);

  const mode = useMemo(() => {
    return evaluatePowerMode(battery.level, battery.charging, manualOverride);
  }, [battery.level, battery.charging, manualOverride]);

  const webglPolicy = useMemo(() => getWebGLThrottlePolicy(mode), [mode]);
  const audioWorkletPolicy = useMemo(
    () => getAudioWorkletThrottlePolicy(mode),
    [mode],
  );

  const policyRef = useRef(webglPolicy);
  useEffect(() => {
    policyRef.current = webglPolicy;
  }, [webglPolicy]);

  // Dedicated frame throttler instance
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
    mode,
    isLowPower: mode === "low_power" || mode === "critical",
    isCritical: mode === "critical",
    webglPolicy,
    audioWorkletPolicy,
    batteryLevel: battery.level,
    charging: battery.charging,
    manualOverride,
    setManualOverride: handleSetManualOverride,
    shouldRenderWebGLFrame,
    notifyAudioWorklet,
    optimalDpr,
  };
}
