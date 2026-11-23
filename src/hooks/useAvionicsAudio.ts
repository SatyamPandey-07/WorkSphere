"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useBatteryStatus } from "./useBatteryStatus";
import {
  ANALYSER_FFT_SIZE,
  buildSpectralFrame,
  detectWasmSimd,
  type AnalyzerMode,
  type SpectralFrame,
} from "@/lib/audio/spectralFallback";

const SINK_STORAGE_KEY = "avionics_preferred_audio_sink_id";

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
  /** Available audio output devices */
  audioDevices: MediaDeviceInfo[];
  /** Currently selected sinkId */
  selectedSinkId: string;
  /** Set preferred audio sink */
  setAudioSink: (deviceId: string) => Promise<void>;
  /** Get or initialize AudioContext */
  getAudioContext: () => Promise<AudioContext | null>;
  /** Real-time spectral energy bins computed by Wasm SIMD AudioWorklet */
  spectralBins: Float32Array;
  /** Current sound pressure level in decibels (dB SPL) */
  splDb: number;
  /** Dominant noise peak frequency in Hz */
  dominantFrequencyHz: number;
  /** Last AudioWorklet FFT frame processing latency in ms (< 5ms target) */
  analyzerLatencyMs: number;
  /** True while the frequency analyzer (WASM SIMD or AnalyserNode fallback) is running */
  isAnalyzerActive: boolean;
  /** Which analyzer feeds the spectral state: WASM SIMD worklet, native AnalyserNode fallback, or none */
  analyzerMode: AnalyzerMode;
  /**
   * Start acoustic frequency analysis. Uses the WebAssembly SIMD AudioWorklet
   * when supported and falls back to a native AnalyserNode otherwise; both
   * produce identical spectralBins / splDb / dominantFrequencyHz output.
   */
  startFrequencyAnalyzer: (sourceStream?: MediaStream) => Promise<boolean>;
  /** Stop and disconnect the AudioWorklet frequency analyzer */
  stopFrequencyAnalyzer: () => void;
}

const CRITICAL_BATTERY_THRESHOLD = 0.05; // 5%
const TONE_LOW_FREQ = 800; // 800Hz military caution
const TONE_HIGH_FREQ = 1000; // 1000Hz military caution
const MAX_SAFE_GAIN = 0.45; // Limiter clamp ceiling to prevent acoustic clipping
const DEFAULT_FILTER_CUTOFF = 1800; // Low-pass filter cutoff in Hz

let globalAudioCtx:
  (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null = null;

function getSharedAudioContext(preferredSinkId?: string): AudioContext | null {
  if (typeof window === "undefined") return null;

  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextClass) return null;

  if (!globalAudioCtx || globalAudioCtx.state === "closed") {
    try {
      globalAudioCtx = new AudioContextClass() as AudioContext & {
        setSinkId?: (id: string) => Promise<void>;
      };

      if (preferredSinkId && typeof globalAudioCtx.setSinkId === "function") {
        globalAudioCtx.setSinkId(preferredSinkId).catch(() => {});
      }
    } catch {
      return null;
    }
  }

  return globalAudioCtx;
}

/**
 * useAvionicsAudio
 * Hook that procedurally synthesizes military jet Master Caution two-tone audio warnings,
 * provides output device (headphones/speakers) sink selection, and runs a 128-bit SIMD
 * WebAssembly acoustic frequency analyzer inside an AudioWorklet processor.
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
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedSinkId, setSelectedSinkId] = useState<string>("default");

  const [spectralBins, setSpectralBins] = useState<Float32Array>(
    () => new Float32Array(256),
  );
  const [splDb, setSplDb] = useState<number>(20);
  const [dominantFrequencyHz, setDominantFrequencyHz] = useState<number>(0);
  const [analyzerLatencyMs, setAnalyzerLatencyMs] = useState<number>(0);
  const [isAnalyzerActive, setIsAnalyzerActive] = useState<boolean>(false);
  const [analyzerMode, setAnalyzerMode] = useState<AnalyzerMode>("inactive");

  const battery = useBatteryStatus();

  const isLowBattery = Boolean(
    battery.isSupported &&
    !battery.charging &&
    battery.level !== null &&
    battery.level < CRITICAL_BATTERY_THRESHOLD,
  );

  const isMutedRef = useRef(isMuted);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const activeNodesRef = useRef<{ osc: OscillatorNode; gain: GainNode }[]>([]);
  const masterGainRef = useRef<GainNode | null>(null);
  const cautionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const userInteractedRef = useRef(false);

  // Retain a caution request until the AudioContext becomes available.
  const pendingCautionRef = useRef<PlayCautionOptions | null>(null);

  // Allows asynchronous resume handlers to invoke the latest playback callback.
  const playMasterCautionRef = useRef<
    ((options?: PlayCautionOptions) => boolean) | null
  >(null);

  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const analyserTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load preferred sinkId from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(SINK_STORAGE_KEY);

      if (saved) {
        setSelectedSinkId(saved);
      }
    }
  }, []);

  // Enumerate available audio output devices
  useEffect(() => {
    async function fetchDevices() {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();

          const outputs = devices.filter(
            (device) => device.kind === "audiooutput",
          );

          setAudioDevices(outputs);
        }
      } catch (e) {
        console.error("Failed to enumerate audio output devices:", e);
      }
    }

    fetchDevices();

    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", fetchDevices);

      return () => {
        navigator.mediaDevices.removeEventListener(
          "devicechange",
          fetchDevices,
        );
      };
    }
  }, []);

  // Update sinkId and persist in localStorage
  const setAudioSink = useCallback(async (deviceId: string) => {
    setSelectedSinkId(deviceId);

    if (typeof window !== "undefined") {
      localStorage.setItem(SINK_STORAGE_KEY, deviceId);
    }

    if (globalAudioCtx && typeof globalAudioCtx.setSinkId === "function") {
      try {
        await globalAudioCtx.setSinkId(deviceId);
      } catch (e) {
        console.error("Error applying audio context setSinkId:", e);
      }
    }
  }, []);

  // Stop active caution chime
  const stopMasterCaution = useCallback(() => {
    // Explicitly stopping a caution also cancels any queued playback.
    pendingCautionRef.current = null;

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

  // Resume a pending caution only after the AudioContext is running.
  const resumePendingCaution = useCallback((ctx: AudioContext) => {
    if (ctx.state !== "running") return;

    setIsAudioUnlocked(true);

    if (isMutedRef.current) {
      pendingCautionRef.current = null;
      return;
    }

    const pendingOptions = pendingCautionRef.current;

    if (!pendingOptions) return;

    // Clear first to prevent duplicate playback from concurrent events.
    pendingCautionRef.current = null;

    playMasterCautionRef.current?.(pendingOptions);
  }, []);

  const getAudioContext =
    useCallback(async (): Promise<AudioContext | null> => {
      const ctx = getSharedAudioContext(selectedSinkId);

      if (ctx && ctx.state === "suspended") {
        await ctx.resume().catch(() => {});
      }

      return ctx;
    }, [selectedSinkId]);

  const unlockAudio = useCallback(async () => {
    userInteractedRef.current = true;

    const ctx = getSharedAudioContext(selectedSinkId);

    if (ctx) {
      if (ctx.state === "suspended") {
        await ctx.resume().catch(() => {});
      }

      resumePendingCaution(ctx);
    }
  }, [selectedSinkId, resumePendingCaution]);

  // Stop active WebAssembly SIMD AudioWorklet frequency analyzer
  const stopFrequencyAnalyzer = useCallback(() => {
    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.port.onmessage = null;
        workletNodeRef.current.disconnect();
      } catch {
        // Ignore already disconnected node
      }

      workletNodeRef.current = null;
    }

    if (analyserTimerRef.current) {
      clearInterval(analyserTimerRef.current);
      analyserTimerRef.current = null;
    }

    if (analyserNodeRef.current) {
      try {
        analyserNodeRef.current.disconnect();
      } catch {
        // Ignore already disconnected node
      }

      analyserNodeRef.current = null;
    }

    if (mediaSourceRef.current) {
      try {
        mediaSourceRef.current.disconnect();
      } catch {
        // Ignore
      }

      mediaSourceRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    setIsAnalyzerActive(false);
    setAnalyzerMode("inactive");
  }, []);

  // Single place that publishes an analysis frame, shared by the WASM worklet
  // and the AnalyserNode fallback so consumers always get the same shapes.
  const applySpectralFrame = useCallback(
    (frame: Partial<SpectralFrame> | null | undefined) => {
      if (!frame) return;

      if (frame.bins instanceof Float32Array) {
        setSpectralBins(frame.bins);
      }

      if (typeof frame.splDb === "number") {
        setSplDb(frame.splDb);
      }

      if (typeof frame.dominantFrequencyHz === "number") {
        setDominantFrequencyHz(frame.dominantFrequencyHz);
      }

      if (typeof frame.latencyMs === "number") {
        setAnalyzerLatencyMs(frame.latencyMs);
      }
    },
    [],
  );

  // Native AnalyserNode analyzer for browsers without WASM SIMD / AudioWorklet.
  const startFallbackAnalyzer = useCallback(
    async (
      ctx: AudioContext,
      sourceStream: MediaStream | undefined,
      reason: string,
    ): Promise<boolean> => {
      console.warn(
        `[useAvionicsAudio] ${reason}; using native AnalyserNode fallback for the frequency analyzer.`,
      );

      try {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = ANALYSER_FFT_SIZE;
        // No temporal smoothing, matching the worklet's raw per-frame output.
        analyser.smoothingTimeConstant = 0;

        let stream = sourceStream ?? null;

        if (
          !stream &&
          typeof navigator !== "undefined" &&
          navigator.mediaDevices?.getUserMedia
        ) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          micStreamRef.current = stream;
        }

        if (stream) {
          const src = ctx.createMediaStreamSource(stream);
          src.connect(analyser);
          mediaSourceRef.current = src;
        }

        const sampleRate = ctx.sampleRate || 48000;
        const freqDb = new Float32Array(analyser.frequencyBinCount);
        const timeDomain = new Float32Array(analyser.fftSize);
        // One frame per FFT window, the same cadence as the worklet.
        const pollMs = Math.max(
          10,
          Math.round((1000 * analyser.fftSize) / sampleRate),
        );

        analyserTimerRef.current = setInterval(() => {
          const startTs = performance.now();
          analyser.getFloatFrequencyData(freqDb);
          analyser.getFloatTimeDomainData(timeDomain);

          const frame = buildSpectralFrame(freqDb, timeDomain, sampleRate);
          frame.latencyMs = performance.now() - startTs;
          applySpectralFrame(frame);
        }, pollMs);

        analyserNodeRef.current = analyser;
        setAnalyzerMode("fallback");
        setIsAnalyzerActive(true);

        return true;
      } catch (err) {
        console.error("Failed to start AnalyserNode frequency analyzer:", err);
        stopFrequencyAnalyzer();

        return false;
      }
    },
    [applySpectralFrame, stopFrequencyAnalyzer],
  );

  // Start the acoustic frequency analyzer: WebAssembly SIMD inside an
  // AudioWorklet when supported, native AnalyserNode otherwise (#8629).
  const startFrequencyAnalyzer = useCallback(
    async (sourceStream?: MediaStream): Promise<boolean> => {
      const ctx = await getAudioContext();

      if (!ctx) return false;

      stopFrequencyAnalyzer();

      if (!detectWasmSimd()) {
        return startFallbackAnalyzer(ctx, sourceStream, "WASM SIMD is not supported");
      }

      if (!ctx.audioWorklet) {
        return startFallbackAnalyzer(ctx, sourceStream, "AudioWorklet is not available");
      }

      let workletNode: AudioWorkletNode;
      let wasmBytes: ArrayBuffer;

      try {
        await ctx.audioWorklet.addModule("/worklets/fft-processor.js");

        const wasmResp = await fetch("/wasm/fft_analyzer.wasm");
        wasmBytes = await wasmResp.arrayBuffer();

        workletNode = new AudioWorkletNode(ctx, "fft-analyzer-processor", {
          processorOptions: {
            fftSize: ANALYSER_FFT_SIZE,
            sampleRate: ctx.sampleRate || 48000,
          },
        });
      } catch (err) {
        console.error("Failed to load Wasm SIMD frequency analyzer:", err);

        return startFallbackAnalyzer(ctx, sourceStream, "WASM analyzer failed to load");
      }

      try {
        workletNode.port.onmessage = (event: MessageEvent) => {
          const data = event.data;

          if (!data || data.type !== "SPECTRAL_FRAME") return;

          applySpectralFrame(data);
        };

        workletNode.port.postMessage({ type: "INIT_WASM", wasmBytes }, [
          wasmBytes,
        ]);

        let stream = sourceStream ?? null;

        if (
          !stream &&
          typeof navigator !== "undefined" &&
          navigator.mediaDevices?.getUserMedia
        ) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          micStreamRef.current = stream;
        }

        if (stream) {
          const src = ctx.createMediaStreamSource(stream);
          src.connect(workletNode);
          mediaSourceRef.current = src;
        }

        workletNodeRef.current = workletNode;
        setAnalyzerMode("wasm-simd");
        setIsAnalyzerActive(true);

        return true;
      } catch (err) {
        console.error("Failed to start Wasm SIMD frequency analyzer:", err);
        stopFrequencyAnalyzer();

        return false;
      }
    },
    [
      getAudioContext,
      stopFrequencyAnalyzer,
      startFallbackAnalyzer,
      applySpectralFrame,
    ],
  );

  // Unlock AudioContext on first user gesture.
  useEffect(() => {
    const handleUserGesture = () => {
      userInteractedRef.current = true;

      const ctx = getSharedAudioContext(selectedSinkId);

      if (!ctx) return;

      if (ctx.state === "suspended") {
        void ctx
          .resume()
          .then(() => {
            resumePendingCaution(ctx);
          })
          .catch(() => {});
      } else if (ctx.state === "running") {
        resumePendingCaution(ctx);
      }
    };

    const gestureEvents = ["click", "keydown", "touchstart", "pointerdown"];

    gestureEvents.forEach((evt) =>
      window.addEventListener(evt, handleUserGesture, { passive: true }),
    );

    const ctx = getSharedAudioContext(selectedSinkId);

    if (ctx && ctx.state === "running") {
      setIsAudioUnlocked(true);
      userInteractedRef.current = true;
    }

    return () => {
      gestureEvents.forEach((evt) =>
        window.removeEventListener(evt, handleUserGesture),
      );
    };
  }, [selectedSinkId, resumePendingCaution]);

  // Handle AudioContext suspend and resume on browser tab visibility change
  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible") {
        const audioCtx = getSharedAudioContext(selectedSinkId);

        if (audioCtx && audioCtx.state === "suspended") {
          try {
            await audioCtx.resume();
          } catch {
            // Ignore resume rejection if blocked by browser policy
          }
        }

        if (audioCtx && audioCtx.state === "running") {
          setIsAudioUnlocked(true);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [selectedSinkId]);

  // Procedural Master Caution synthesis
  const playMasterCaution = useCallback(
    (options?: PlayCautionOptions): boolean => {
      if (isMutedRef.current) return false;

      const ctx = getSharedAudioContext(selectedSinkId);

      if (!ctx) return false;

      // Queue playback until a suspended AudioContext is resumed.
      if (ctx.state !== "running") {
        pendingCautionRef.current = options ?? {};

        if (!userInteractedRef.current) {
          return false;
        }

        void ctx
          .resume()
          .then(() => {
            resumePendingCaution(ctx);
          })
          .catch(() => {});

        return false;
      }

      // Stop previous playback if active.
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
        gain1.gain.exponentialRampToValueAtTime(
          0.0001,
          cycleStart + toneDuration,
        );

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

      cautionTimeoutRef.current = setTimeout(
        () => {
          setIsCautionActive(false);
          activeNodesRef.current = [];
          masterGainRef.current = null;
        },
        Math.ceil(totalDurationSec * 1000),
      );

      return true;
    },
    [
      volume,
      filterCutoff,
      stopMasterCaution,
      selectedSinkId,
      resumePendingCaution,
    ],
  );

  // Keep the latest callback available to asynchronous resume handlers.
  useEffect(() => {
    playMasterCautionRef.current = playMasterCaution;
  }, [playMasterCaution]);

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
      stopFrequencyAnalyzer();
    };
  }, [stopMasterCaution, stopFrequencyAnalyzer]);

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
    audioDevices,
    selectedSinkId,
    setAudioSink,
    getAudioContext,
    spectralBins,
    splDb,
    dominantFrequencyHz,
    analyzerLatencyMs,
    isAnalyzerActive,
    analyzerMode,
    startFrequencyAnalyzer,
    stopFrequencyAnalyzer,
  };
}
