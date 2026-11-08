/**
 * Battery-Aware Low-Power Mode Throttle System
 *
 * Coordinates dynamic hardware throttling for WebGL rendering loops and AudioWorklet
 * background DSP processors when running on battery power or battery saver mode.
 *
 * Throttling profiles:
 *  - NORMAL:    60 FPS, max DPR 2.0, full post-processing, full AudioWorklet telemetry (16ms)
 *  - LOW_POWER: 30 FPS, max DPR 1.0, bypass heavy bloom/shadows, decimated telemetry (100ms)
 *  - CRITICAL:  15-20 FPS, max DPR 0.75, minimum particles, bypass non-essential DSP (250ms)
 */

export type PowerMode = "normal" | "low_power" | "critical";

export interface WebGLThrottlePolicy {
  /** Target frame rate ceiling (e.g. 60, 30, or 15) */
  targetFps: number;
  /** Minimum elapsed time in milliseconds between frames (1000 / targetFps) */
  frameIntervalMs: number;
  /** Maximum devicePixelRatio clamp (e.g. 2.0 down to 1.0) */
  maxDpr: number;
  /** Whether expensive post-processing passes (bloom, blur, god-rays) should run */
  enablePostProcessing: boolean;
  /** Scaling factor for particle count / instance density (1.0, 0.4, 0.2) */
  particleScale: number;
  /** Whether dynamic shadow maps are enabled */
  shadowsEnabled: boolean;
  /** Downsampling factor for offscreen buffers (1.0 = native, 2.0 = half res) */
  downsampleFactor: number;
}

export interface AudioWorkletThrottlePolicy {
  /** Throttle interval in milliseconds between AudioWorklet telemetry messages */
  telemetryIntervalMs: number;
  /** Whether telemetry messages (RMS, FFT profiles) are emitted */
  enableTelemetry: boolean;
  /** DSP processing quality tier */
  dspQuality: "high" | "efficient" | "eco";
  /** Whether to bypass non-essential secondary audio nodes/effects */
  bypassNonEssential: boolean;
}

export interface BatteryLowPowerState {
  mode: PowerMode;
  isLowPower: boolean;
  isCritical: boolean;
  batteryLevel: number | null;
  charging: boolean;
  manualOverride: PowerMode | null;
  webgl: WebGLThrottlePolicy;
  audioWorklet: AudioWorkletThrottlePolicy;
}

export interface WebGLFrameThrottler {
  /**
   * Checks if enough time has elapsed to render a new WebGL frame according
   * to the active power policy. Updates internal timestamp when returning true.
   */
  shouldRender(now: number): boolean;
  /** Last frame execution timestamp */
  getLastFrameTime(): number;
  /** Elapsed milliseconds since the last rendered frame */
  getElapsedMs(now: number): number;
  /** Reset frame counter and timestamp */
  reset(): void;
}

export const POWER_MODE_STORAGE_KEY = "worksphere_power_mode_override";
export const POWER_MODE_CHANGE_EVENT = "worksphere:power-mode-change";

export const LOW_BATTERY_LEVEL_THRESHOLD = 0.2; // 20%
export const CRITICAL_BATTERY_LEVEL_THRESHOLD = 0.1; // 10%

export const POLICIES: Record<
  PowerMode,
  { webgl: WebGLThrottlePolicy; audioWorklet: AudioWorkletThrottlePolicy }
> = {
  normal: {
    webgl: {
      targetFps: 60,
      frameIntervalMs: 1000 / 60,
      maxDpr: 2.0,
      enablePostProcessing: true,
      particleScale: 1.0,
      shadowsEnabled: true,
      downsampleFactor: 1.0,
    },
    audioWorklet: {
      telemetryIntervalMs: 16,
      enableTelemetry: true,
      dspQuality: "high",
      bypassNonEssential: false,
    },
  },
  low_power: {
    webgl: {
      targetFps: 30,
      frameIntervalMs: 1000 / 30,
      maxDpr: 1.0,
      enablePostProcessing: false,
      particleScale: 0.4,
      shadowsEnabled: false,
      downsampleFactor: 1.5,
    },
    audioWorklet: {
      telemetryIntervalMs: 100,
      enableTelemetry: true,
      dspQuality: "efficient",
      bypassNonEssential: false,
    },
  },
  critical: {
    webgl: {
      targetFps: 15,
      frameIntervalMs: 1000 / 15,
      maxDpr: 0.75,
      enablePostProcessing: false,
      particleScale: 0.2,
      shadowsEnabled: false,
      downsampleFactor: 2.0,
    },
    audioWorklet: {
      telemetryIntervalMs: 250,
      enableTelemetry: false,
      dspQuality: "eco",
      bypassNonEssential: true,
    },
  },
};

/**
 * Evaluates the appropriate PowerMode based on battery state and any manual override.
 */
export function evaluatePowerMode(
  batteryLevel: number | null,
  charging: boolean,
  manualOverride: PowerMode | null = null,
): PowerMode {
  if (manualOverride) {
    return manualOverride;
  }

  if (charging || batteryLevel === null) {
    return "normal";
  }

  if (batteryLevel <= CRITICAL_BATTERY_LEVEL_THRESHOLD) {
    return "critical";
  }

  if (batteryLevel <= LOW_BATTERY_LEVEL_THRESHOLD) {
    return "low_power";
  }

  return "normal";
}

/**
 * Returns WebGL throttling policy for a given power mode.
 */
export function getWebGLThrottlePolicy(mode: PowerMode): WebGLThrottlePolicy {
  return POLICIES[mode].webgl;
}

/**
 * Returns AudioWorklet throttling policy for a given power mode.
 */
export function getAudioWorkletThrottlePolicy(
  mode: PowerMode,
): AudioWorkletThrottlePolicy {
  return POLICIES[mode].audioWorklet;
}

/**
 * Creates a lightweight WebGL frame rate regulator that throttles requestAnimationFrame
 * rendering based on the active power policy.
 */
export function createWebGLFrameThrottler(
  policyProvider: () => WebGLThrottlePolicy = () =>
    getWebGLThrottlePolicy(getCurrentPowerState().mode),
): WebGLFrameThrottler {
  let lastFrameTime = 0;

  return {
    shouldRender(now: number): boolean {
      if (typeof document !== "undefined" && document.hidden) {
        return false;
      }
      const policy = policyProvider();
      const interval = policy.frameIntervalMs;

      if (now - lastFrameTime < interval) {
        return false;
      }

      lastFrameTime = now;
      return true;
    },
    getLastFrameTime(): number {
      return lastFrameTime;
    },
    getElapsedMs(now: number): number {
      return lastFrameTime === 0 ? 0 : now - lastFrameTime;
    },
    reset(): void {
      lastFrameTime = 0;
    },
  };
}

/**
 * Sends a power policy update message to an AudioWorkletProcessor.
 */
export function notifyAudioWorkletLowPower(
  nodeOrPort: AudioWorkletNode | MessagePort | { port?: MessagePort },
  policy: AudioWorkletThrottlePolicy,
): void {
  const targetPort: MessagePort | null =
    "port" in nodeOrPort && nodeOrPort.port instanceof MessagePort
      ? nodeOrPort.port
      : nodeOrPort instanceof MessagePort
      ? nodeOrPort
      : null;

  if (!targetPort) return;

  try {
    targetPort.postMessage({
      type: "setLowPowerMode",
      enabled: policy.dspQuality !== "high",
      mode: policy.dspQuality,
      telemetryIntervalMs: policy.telemetryIntervalMs,
      enableTelemetry: policy.enableTelemetry,
      bypassNonEssential: policy.bypassNonEssential,
    });
  } catch (err) {
    console.warn("[lowPowerThrottle] Failed posting message to AudioWorklet:", err);
  }
}

/**
 * Reads manual power override mode from localStorage safely.
 */
export function getManualPowerOverride(): PowerMode | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  try {
    const stored = window.localStorage.getItem(POWER_MODE_STORAGE_KEY);
    if (stored === "normal" || stored === "low_power" || stored === "critical") {
      return stored;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persists manual power override mode and broadcasts change event.
 */
export function setManualPowerOverride(mode: PowerMode | null): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    if (mode === null) {
      window.localStorage.removeItem(POWER_MODE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(POWER_MODE_STORAGE_KEY, mode);
    }

    const state = getCurrentPowerState();
    window.dispatchEvent(
      new CustomEvent(POWER_MODE_CHANGE_EVENT, { detail: state }),
    );
  } catch (err) {
    console.warn("[lowPowerThrottle] Failed persisting power mode override:", err);
  }
}

/**
 * Returns current snapshot of power state across browser APIs and overrides.
 */
export function getCurrentPowerState(
  batteryLevel: number | null = null,
  charging = false,
): BatteryLowPowerState {
  const manual = getManualPowerOverride();
  const mode = evaluatePowerMode(batteryLevel, charging, manual);

  return {
    mode,
    isLowPower: mode === "low_power" || mode === "critical",
    isCritical: mode === "critical",
    batteryLevel,
    charging,
    manualOverride: manual,
    webgl: getWebGLThrottlePolicy(mode),
    audioWorklet: getAudioWorkletThrottlePolicy(mode),
  };
}

/**
 * Subscribes to power mode change events across the application.
 */
export function subscribePowerModeChange(
  callback: (state: BatteryLowPowerState) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = (event: Event) => {
    const custom = event as CustomEvent<BatteryLowPowerState>;
    if (custom.detail) {
      callback(custom.detail);
    } else {
      callback(getCurrentPowerState());
    }
  };

  window.addEventListener(POWER_MODE_CHANGE_EVENT, handler);
  return () => {
    window.removeEventListener(POWER_MODE_CHANGE_EVENT, handler);
  };
}
