"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useBatteryStatus } from "./useBatteryStatus";

export interface AvionicsAudioOptions {
  /** Master volume between 0 and 1 (clamped for acoustic safety). Default: 0.25 */
  volume?: number;
  /** Whether to automatically synthesize the alarm when offline or battery < 5%. Default: true */
  autoTrigger?: boolean;
  /** Initial muted state. Default: false */
  isMuted?: boolean;
  /** Low-pass filter cutoff frequency in Hz to emulate military cockpit acoustics. Default: 1800 */
  filterCutoff?: number;
}

export interface PlayCautionOptions {
  /** Number of alternating 800Hz / 1000Hz tone pairs to play. Default: 2 */
  cycles?: number;
  /** Custom volume for this play call (clamped to safe limiter ceiling). */
  volume?: number;
}

export interface AvionicsAudioReturn {
  /** Trigger the two-tone Master Caution alarm procedurally */
  playMasterCaution: (options?: PlayCautionOptions) => boolean;
  /** Immediately silence and abort any active alarm chime */
  stopMasterCaution: () => void;
  /** True while the Master Caution alarm is actively playing */
  isCautionActive: boolean;
  /** True if the device is currently offline */
  isOffline: boolean;
  /** True if battery is below 5% and discharging */
  isLowBattery: boolean;
  /** Whether audio context is unlocked and ready to play */
  isAudioUnlocked: boolean;
  /** Manually unlock audio context via user gesture */
  unlockAudio: () => Promise<void>;
  /** Muted state */
  isMuted: boolean;
  /** Toggle muted state */
  setIsMuted: (muted: boolean) => void;
}

const CRITICAL_BATTERY_THRESHOLD = 0.05; // 5%
const TONE_LOW_FREQ = 800; // 800Hz military caution
const TONE_HIGH_FREQ = 1000; // 1000Hz military caution
const MAX_SAFE_GAIN = 0.45; // Limiter clamp ceiling to prevent acoustic clipping
const DEFAULT_FILTER_CUTOFF = 1800; // Low-pass filter cutoff in Hz

let globalAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!globalAudioCtx || globalAudioCtx.state === "closed") {
    try {
      globalAudioCtx = new AudioContextClass();
    } catch {
      return null;
    }
  }
  return globalAudioCtx;
}

/**
 * useAvionicsAudio
 * Hook that procedurally synthesizes military jet Master Caution two-tone audio warnings
 * (alternating 800Hz / 1000Hz square waves with low-pass filter and master limiter)
 * triggered when internet connectivity is lost or battery drops below 5%.
 */
export function useAvionicsAudio({
  volume = 0.25,
  autoTrigger = true,
  isMuted: initialMuted = false,
  filterCutoff = DEFAULT_FILTER_CUTOFF,
}: AvionicsAudioOptions = {}): AvionicsAudioReturn {
  const [isMuted, setIsMuted] = useState(initialMuted);
  const [isCautionActive, setIsCautionActive] = useState(false);
  const [isAudioUnlocked, setIsAudioUnlocked] = useState(false);
  const [isOffline, setIsOffline] = useState(() =>
    typeof navigator !== "undefined" ? !navigator.onLine : false
  );

  const battery = useBatteryStatus();
  const isLowBattery = Boolean(
    battery.isSupported &&
      !battery.charging &&
      battery.level !== null &&
      battery.level < CRITICAL_BATTERY_THRESHOLD
  );

  const isMutedRef = useRef(isMuted);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const activeNodesRef = useRef<{ osc: OscillatorNode; gain: GainNode }[]>([]);
  const masterGainRef = useRef<GainNode | null>(null);
  const cautionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const userInteractedRef = useRef(false);

  // Stop active caution chime
  const stopMasterCaution = useCallback(() => {
    if (activeNodesRef.current.length > 0) {
      activeNodesRef.current.forEach(({ osc, gain }) => {
        try {
          gain.gain.cancelScheduledValues(0);
          gain.gain.setValueAtTime(0, 0);
          osc.stop();
          osc.disconnect();
        } catch {
          // Ignore already stopped/disconnected
        }
      });
      activeNodesRef.current = [];
    }

    if (masterGainRef.current) {
      try {
        masterGainRef.current.gain.cancelScheduledValues(0);
        masterGainRef.current.gain.setValueAtTime(0, 0);
        masterGainRef.current.disconnect();
      } catch {
        // Ignore
      }
      masterGainRef.current = null;
    }

    if (cautionTimeoutRef.current) {
      clearTimeout(cautionTimeoutRef.current);
      cautionTimeoutRef.current = null;
    }

    setIsCautionActive(false);
  }, []);

  // Unlock audio context via user interaction or explicit permission
  const unlockAudio = useCallback(async () => {
    userInteractedRef.current = true;
    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        // Autoplay policy or unsupported
      }
    }

    const running = ctx.state === "running";
    setIsAudioUnlocked(running);
  }, []);

  // Set up user interaction listeners to safely unlock AudioContext per browser autoplay policy
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleUserGesture = () => {
      userInteractedRef.current = true;
      const ctx = getAudioContext();
      if (ctx && ctx.state === "suspended") {
        ctx.resume()
          .then(() => {
            setIsAudioUnlocked(ctx.state === "running");
          })
          .catch(() => {});
      } else if (ctx && ctx.state === "running") {
        setIsAudioUnlocked(true);
      }
    };

    const gestureEvents = ["click", "keydown", "touchstart", "pointerdown"];
    gestureEvents.forEach((evt) =>
      window.addEventListener(evt, handleUserGesture, { passive: true })
    );

    const ctx = getAudioContext();
    if (ctx && ctx.state === "running") {
      setIsAudioUnlocked(true);
      userInteractedRef.current = true;
    }

    return () => {
      gestureEvents.forEach((evt) =>
        window.removeEventListener(evt, handleUserGesture)
      );
    };
  }, []);

  // Procedural Master Caution synthesis
  const playMasterCaution = useCallback(
    (options?: PlayCautionOptions): boolean => {
      if (isMutedRef.current) return false;

      const ctx = getAudioContext();
      if (!ctx) return false;

      // Audio triggers only on user-initiated interaction or active permissions
      if (ctx.state !== "running") {
        if (!userInteractedRef.current) {
          return false;
        }
        // Attempt resume if user has interacted
        ctx.resume().catch(() => {});
        if (ctx.state !== "running") return false;
      }

      // Stop previous playback if active
      stopMasterCaution();

      const now = ctx.currentTime;
      const cycles = options?.cycles ?? 2;
      const requestedVol = options?.volume ?? volume;
      const effectiveVol = Math.min(Math.max(requestedVol, 0), MAX_SAFE_GAIN);

      // Master volume limiter to prevent acoustic clipping
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-6, now); // -6 dB brickwall threshold
      compressor.knee.setValueAtTime(3, now);
      compressor.ratio.setValueAtTime(20, now); // Hard limiting ratio
      compressor.attack.setValueAtTime(0.002, now); // 2ms fast attack
      compressor.release.setValueAtTime(0.1, now); // 100ms release

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(effectiveVol, now);
      masterGainRef.current = masterGain;

      // Low-pass filter to simulate military cockpit annunciator acoustic character
      const lowPassFilter = ctx.createBiquadFilter();
      lowPassFilter.type = "lowpass";
      lowPassFilter.frequency.setValueAtTime(filterCutoff, now);
      lowPassFilter.Q.setValueAtTime(1.2, now);

      // Audio graph wiring
      lowPassFilter.connect(compressor);
      compressor.connect(masterGain);
      masterGain.connect(ctx.destination);

      const toneDuration = 0.18;
      const interToneGap = 0.04;
      const cycleGap = 0.12;
      const singleCycleDuration = toneDuration * 2 + interToneGap + cycleGap;

      const nodes: { osc: OscillatorNode; gain: GainNode }[] = [];
      const startTime = now + 0.02; // Small scheduling delay for clean audio thread start

      for (let i = 0; i < cycles; i++) {
        const cycleStart = startTime + i * singleCycleDuration;

        // Tone 1: 800Hz square wave
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = "square";
        osc1.frequency.setValueAtTime(TONE_LOW_FREQ, cycleStart);

        gain1.gain.setValueAtTime(0.0001, cycleStart);
        gain1.gain.exponentialRampToValueAtTime(1.0, cycleStart + 0.015);
        gain1.gain.setValueAtTime(1.0, cycleStart + toneDuration - 0.02);
        gain1.gain.exponentialRampToValueAtTime(0.0001, cycleStart + toneDuration);

        osc1.connect(gain1);
        gain1.connect(lowPassFilter);
        osc1.start(cycleStart);
        osc1.stop(cycleStart + toneDuration + 0.01);
        nodes.push({ osc: osc1, gain: gain1 });

        // Tone 2: 1000Hz square wave
        const t2Start = cycleStart + toneDuration + interToneGap;
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = "square";
        osc2.frequency.setValueAtTime(TONE_HIGH_FREQ, t2Start);

        gain2.gain.setValueAtTime(0.0001, t2Start);
        gain2.gain.exponentialRampToValueAtTime(1.0, t2Start + 0.015);
        gain2.gain.setValueAtTime(1.0, t2Start + toneDuration - 0.02);
        gain2.gain.exponentialRampToValueAtTime(0.0001, t2Start + toneDuration);

        osc2.connect(gain2);
        gain2.connect(lowPassFilter);
        osc2.start(t2Start);
        osc2.stop(t2Start + toneDuration + 0.01);
        nodes.push({ osc: osc2, gain: gain2 });
      }

      activeNodesRef.current = nodes;
      setIsCautionActive(true);

      const totalDurationSec = cycles * singleCycleDuration;
      cautionTimeoutRef.current = setTimeout(() => {
        setIsCautionActive(false);
        activeNodesRef.current = [];
        masterGainRef.current = null;
      }, Math.ceil(totalDurationSec * 1000));

      return true;
    },
    [volume, filterCutoff, stopMasterCaution]
  );

  // Monitor online / offline network state
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOffline = () => {
      setIsOffline(true);
      if (autoTrigger) {
        playMasterCaution();
      }
    };

    const handleOnline = () => {
      setIsOffline(false);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [autoTrigger, playMasterCaution]);

  // Monitor critical battery (< 5%) transition
  const prevLowBatteryRef = useRef(isLowBattery);
  useEffect(() => {
    if (!prevLowBatteryRef.current && isLowBattery) {
      if (autoTrigger) {
        playMasterCaution();
      }
    }
    prevLowBatteryRef.current = isLowBattery;
  }, [isLowBattery, autoTrigger, playMasterCaution]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMasterCaution();
    };
  }, [stopMasterCaution]);

  return {
    playMasterCaution,
    stopMasterCaution,
    isCautionActive,
    isOffline,
    isLowBattery,
    isAudioUnlocked,
    unlockAudio,
    isMuted,
    setIsMuted,
  };
}
