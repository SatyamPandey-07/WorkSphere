"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Radio,
  Settings,
  RotateCcw,
  BatteryLow,
  Battery,
} from "lucide-react";
// Assuming these exist based on the prompt's new snippet requirements
import { ParametricEQGraph } from "@/lib/audio/ParametricEQGraph";
import { FrequencyResponseCanvas } from "./FrequencyResponseCanvas";

type SoundPreset = "jazz" | "cafe" | "library";

export type EqPresetName =
  | "flat"
  | "balanced"
  | "speech-clarity" // mapped to vocal_clarity
  | "bass-boost"
  | "music"
  | "vocal-enhancer"
  | "treble-boost"
  | "warm"
  | "chatter-suppression" // new
  | "custom";

export interface EqPreset {
  label: string;
  gains: number[];
}

export const EQ_BANDS: number[] = [60, 250, 1000, 4000, 12000];
export const EQ_BAND_LABELS: string[] = [
  "60Hz",
  "250Hz",
  "1kHz",
  "4kHz",
  "12kHz",
];

export const EQ_PRESETS: Record<EqPresetName, EqPreset> = {
  flat: {
    label: "Flat",
    gains: [0, 0, 0, 0, 0],
  },
  balanced: {
    label: "Balanced",
    gains: [0, 0, 0, 0, 0],
  },
  "speech-clarity": {
    label: "Speech Clarity",
    gains: [-2, -1, 3, 2, 0],
  },
  "bass-boost": {
    label: "Bass Boost",
    gains: [5, 3, 0, 0, 0],
  },
  music: {
    label: "Music",
    gains: [4, 1, -1, 2, 3],
  },
  "vocal-enhancer": {
    label: "Vocal Enhancer",
    gains: [-2, -1, 3, 2, 0],
  },
  "treble-boost": {
    label: "Treble Boost",
    gains: [0, 0, 0, 3, 5],
  },
  warm: {
    label: "Warm",
    gains: [3, 2, 1, -1, -2],
  },
  "chatter-suppression": {
    label: "Suppress Chatter",
    gains: [-3, -2, 0, 4, 2], // High-mid boost for voice, low cut for rumble
  },
  custom: {
    label: "Custom",
    gains: [0, 0, 0, 0, 0],
  },
};

export interface AudioEqualizerProps {
  venueName?: string;
  initialGains?: number[];
  onGainChange?: (bandIndex: number, newGain: number) => void;
  sampleRate?: number;

  // New props for External Source Mode
  audioContext?: AudioContext | null;
  sourceNode?: MediaElementAudioSourceNode | null;
  destinationNode?: AudioNode | null;
}

// Helper: Create Pink Noise Buffer
function createPinkNoiseBuffer(ctx: AudioContext) {
  const bufferSize = 2 * ctx.sampleRate;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const output = buffer.getChannelData(0);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0;

  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    output[i] *= 0.11;
    b6 = white * 0.115926;
  }
  return buffer;
}

// Helper: Create Brown Noise Buffer
function createBrownNoiseBuffer(ctx: AudioContext) {
  const bufferSize = 2 * ctx.sampleRate;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const output = buffer.getChannelData(0);
  let lastOut = 0.0;

  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    output[i] = (lastOut + 0.02 * white) / 1.02;
    lastOut = output[i];
    output[i] *= 3.5;
  }
  return buffer;
}

/**
 * Smoothly transitions an AudioParam to a target value using setTargetAtTime
 * to eliminate audible clicking artifacts.
 */
function smoothSetAudioParam(
  param: AudioParam | null,
  targetValue: number,
  currentTime: number,
  timeConstant: number = 0.02
) {
  if (!param) return;

  
  if (typeof param.setTargetAtTime === "function") {
    param.setTargetAtTime(targetValue, currentTime, timeConstant);
  } else if (typeof param.linearRampToValueAtTime === "function") {
    param.setValueAtTime(param.value ?? 0, currentTime);
    param.linearRampToValueAtTime(targetValue, currentTime + timeConstant * 3);
  } else if (typeof param.setValueAtTime === "function") {
    param.setValueAtTime(targetValue, currentTime);
  }
}

export function AudioEqualizer({
  venueName = "Workspace",
  initialGains,
  onGainChange,
  sampleRate: _sampleRate = 44100,
  // External source props
  audioContext: externalAudioContext,
  sourceNode: externalSourceNode,
  destinationNode: externalDestinationNode,
}: AudioEqualizerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [preset, setPreset] = useState<SoundPreset>("jazz");
  const [eqPreset, setEqPreset] = useState<EqPresetName>("flat");
  const [volume, setVolume] = useState(0.5);
  const [muted, setMuted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [bandGains, setBandGains] = useState<number[]>(
    initialGains || [0, 0, 0, 0, 0],
  );
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [batteryCharging, setBatteryCharging] = useState<boolean | null>(null);
  const batteryAutoPausedRef = useRef<boolean>(false);

  // Internal Audio Refs (Standalone Mode)
  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const eqFiltersRef = useRef<BiquadFilterNode[]>([]);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const jazzCleanupRef = useRef<(() => void) | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // External Audio Refs (Parametric Mode)
  const eqRef = useRef<ParametricEQGraph | null>(null);

  // Detect prefers-reduced-motion on mount
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function"
    ) {
      const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      setReducedMotion(mediaQuery.matches);
      const listener = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
      mediaQuery.addEventListener("change", listener);

      const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      setIsDarkMode(darkModeQuery.matches);
      const darkListener = (e: MediaQueryListEvent) => setIsDarkMode(e.matches);
      darkModeQuery.addEventListener('change', darkListener);

      return () => {
        mediaQuery.removeEventListener("change", listener);
        darkModeQuery.removeEventListener('change', darkListener);
      };
    }
  }, []);

  // Monitor battery status for low-power auto-pause
  useEffect(() => {
    let battery: any = null;
    const updateBattery = (b: any) => {
      setBatteryLevel(b.level);
      setBatteryCharging(b.charging);
    };

    if (typeof navigator !== "undefined" && "getBattery" in navigator) {
      (navigator as any).getBattery().then((b: any) => {
        battery = b;
        updateBattery(b);
        b.addEventListener("levelchange", () => updateBattery(b));
        b.addEventListener("chargingchange", () => updateBattery(b));
      });
    }

    return () => {
      if (battery) {
        battery.removeEventListener("levelchange", () =>
          updateBattery(battery),
        );
        battery.removeEventListener("chargingchange", () =>
          updateBattery(battery),
        );
      }
    };
  }, []);

  // Load from Local Storage on Mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedPreset = window.localStorage.getItem(
        "webrtc_eq_preset",
      ) as EqPresetName;
      const savedGains = window.localStorage.getItem("webrtc_eq_gains");

      if (savedPreset && EQ_PRESETS[savedPreset]) {
        setEqPreset(savedPreset);
      }

      if (savedGains) {
        try {
          setBandGains(JSON.parse(savedGains));
        } catch { }
      } else if (savedPreset && savedPreset !== "custom") {
        setBandGains(EQ_PRESETS[savedPreset].gains);
      }
    }
  }, []);

  // Initialize Parametric EQ Graph if external source provided
  useEffect(() => {
    if (externalAudioContext && externalSourceNode && externalDestinationNode && !eqRef.current) {
      eqRef.current = new ParametricEQGraph(externalAudioContext, externalSourceNode, externalDestinationNode);

      // Sync initial gains if available
      if (eqRef.current.bands) {
        // Map our 5 bands to their band IDs if possible, or just init
        // For this merge, we assume ParametricEQGraph handles its own internal state initially
      }
    }

    return () => {
      if (eqRef.current) {
        eqRef.current.disconnect();
        eqRef.current = null;
      }
    };
  }, [externalAudioContext, externalSourceNode, externalDestinationNode]);

  // Initialize Internal Audio Context and BiquadFilterNode EQ chain on demand (Standalone Mode)
  const initAudio = useCallback(() => {
    if (externalAudioContext) return; // Skip if in external mode
    if (audioContextRef.current && audioContextRef.current.state !== "closed") return;
    if (audioContextRef.current && audioContextRef.current.state === "closed") {
      audioContextRef.current = null;
    }
    const AudioContextClass =
      window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const masterGain = ctx.createGain();
    const analyser = ctx.createAnalyser();

    analyser.fftSize = 64;
    // DynamicsCompressorNode prevents digital clipping
    if (typeof ctx.createDynamicsCompressor === "function") {
      const compressor = ctx.createDynamicsCompressor();
      if (compressor.threshold) compressor.threshold.value = -24;
      if (compressor.knee) compressor.knee.value = 12;
      if (compressor.ratio) compressor.ratio.value = 4;
      if (compressor.attack) compressor.attack.value = 0.003;
      if (compressor.release) compressor.release.value = 0.25;
      compressorRef.current = compressor;

      masterGain.connect(compressor);
      compressor.connect(analyser);
    } else {
      masterGain.connect(analyser);
    }
    analyser.connect(ctx.destination);

    // Build 5-band BiquadFilterNode cascade
    const filters: BiquadFilterNode[] = EQ_BANDS.map((freq, i) => {
      const filter = ctx.createBiquadFilter();
      if (i === 0) {
        filter.type = "lowshelf";
      } else if (i === EQ_BANDS.length - 1) {
        filter.type = "highshelf";
      } else {
        filter.type = "peaking";
        if ("Q" in filter && filter.Q) {
          if (typeof filter.Q.setValueAtTime === "function") {
            filter.Q.setValueAtTime(1.4, ctx.currentTime);
          } else {
            filter.Q.value = 1.4;
          }
        }
      }
      if (
        filter.frequency &&
        typeof filter.frequency.setValueAtTime === "function"
      ) {
        filter.frequency.setValueAtTime(freq, ctx.currentTime);
      }
      if (filter.gain && typeof filter.gain.setValueAtTime === "function") {
        filter.gain.setValueAtTime(bandGains[i] ?? 0, ctx.currentTime);
      }
      return filter;
    });

    for (let i = 0; i < filters.length - 1; i++) {
      filters[i].connect(filters[i + 1]);
    }
    if (filters.length > 0) {
      filters[filters.length - 1].connect(masterGain);
    }

    audioContextRef.current = ctx;
    masterGainRef.current = masterGain;
    eqFiltersRef.current = filters;
    analyserRef.current = analyser;

    // Safari iOS resume handler
    if (ctx.state === "suspended") {
      const resumeOnInteraction = () => {
        if (!audioContextRef.current) return;
        audioContextRef.current.resume().then(() => {
          if (audioContextRef.current?.state === "running") {
            document.removeEventListener("touchstart", resumeOnInteraction);
            document.removeEventListener("click", resumeOnInteraction);
          }
        }).catch(() => { });
      };
      document.addEventListener("touchstart", resumeOnInteraction, { passive: true });
      document.addEventListener("click", resumeOnInteraction);
    }
  }, [bandGains, externalAudioContext]);

  // Play Sound Logic (Standalone Mode)
  const stopPlayingNodes = useCallback(() => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch { }
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (jazzCleanupRef.current) {
      jazzCleanupRef.current();
      jazzCleanupRef.current = null;
    }
  }, []);

  const stopPlaying = useCallback(() => {
    stopPlayingNodes();
    if (
      audioContextRef.current &&
      audioContextRef.current.state !== "suspended"
    ) {
      audioContextRef.current.suspend();
    }
  }, [stopPlayingNodes]);

  // Auto-pause sampling when battery is critical and unplugged
  useEffect(() => {
    if (
      batteryLevel !== null &&
      batteryLevel < 0.15 &&
      !batteryCharging &&
      isPlaying &&
      !batteryAutoPausedRef.current
    ) {
      batteryAutoPausedRef.current = true;
      stopPlaying();
      setIsPlaying(false);
    }
    if (batteryCharging && batteryAutoPausedRef.current) {
      batteryAutoPausedRef.current = false;
    }
  }, [batteryLevel, batteryCharging, isPlaying, stopPlaying]);

  // Handle Real-Time Gain Slider Drag
  const handleBandGainChange = (index: number, newGain: number) => {
    const clampedGain = Math.max(-20, Math.min(20, newGain));

    setEqPreset("custom");
    if (typeof window !== "undefined") {
      window.localStorage.setItem("webrtc_eq_preset", "custom");
    }

    setBandGains((prev) => {
      const next = [...prev];
      next[index] = clampedGain;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("webrtc_eq_gains", JSON.stringify(next));
      }
      return next;
    });

    if (onGainChange) {
      onGainChange(index, clampedGain);
    }

    // Update External Parametric EQ if active
    if (eqRef.current) {
      // Map index to band ID. This assumes a specific mapping order in ParametricEQGraph
      // For safety, we might need a lookup map, but assuming standard order for now:
      const bandIds = ['low', 'lowMid', 'mid', 'highMid', 'high'];
      const bandId = bandIds[index];
      if (bandId) {
        eqRef.current.setBandGain(bandId, clampedGain);
      }
    }

    // Update Internal Standalone EQ if active
    // Use smooth transition to eliminate audio pops and clicks
    const filter = eqFiltersRef.current[index];
    if (filter && filter.gain && audioContextRef.current) {
      smoothSetAudioParam(
        filter.gain,
        clampedGain,
        audioContextRef.current.currentTime,
        0.02
      );
    }
  };

  const handleEqPresetChange = (presetName: EqPresetName) => {
    setEqPreset(presetName);

    if (typeof window !== "undefined") {
      window.localStorage.setItem("webrtc_eq_preset", presetName);
    }

    if (presetName !== "custom") {
      const gains = EQ_PRESETS[presetName].gains;
      setBandGains(gains);

      if (typeof window !== "undefined") {
        window.localStorage.setItem("webrtc_eq_gains", JSON.stringify(gains));
      }

      if (onGainChange) {
        gains.forEach((gain, i) => onGainChange(i, gain));
      }

      // Apply to External Parametric EQ
      if (eqRef.current) {
        // Map preset name to ParametricEQGraph preset if available, or apply gains manually
        if (presetName === 'speech-clarity' || presetName === 'vocal-enhancer') {
          eqRef.current.applyPreset('vocal_clarity');
        } else if (presetName === 'chatter-suppression') {
          eqRef.current.applyPreset('chatter_suppression');
        } else if (presetName === 'flat') {
          eqRef.current.applyPreset('flat');
        } else {
          // Manual application for other presets
          const bandIds = ['low', 'lowMid', 'mid', 'highMid', 'high'];
          gains.forEach((gain, i) => {
            if (bandIds[i]) eqRef.current?.setBandGain(bandIds[i], gain);
          });
        }
      }

      // Apply to Internal Standalone EQ
      // Apply smooth audio node param ramping
      if (audioContextRef.current) {
        const now = audioContextRef.current.currentTime;
        eqFiltersRef.current.forEach((filter, i) => {
          if (filter && filter.gain) {
            const targetGain = gains[i] ?? 0;
            smoothSetAudioParam(filter.gain, targetGain, now, 0.02);
          }
        });
      }
    }
  };

  const handleResetEq = () => {
    handleEqPresetChange("flat");
    // Smoothly animate all frequency sliders back to 0 dB and re-evaluate audio node gains
    const flatGains = EQ_PRESETS.flat.gains;
    const startGains = [...bandGains];
    const duration = 200; // 200ms smooth slider animation
    const startTime = performance.now();

    const animateReset = (nowTime: number) => {
      const elapsed = nowTime - startTime;
      const progress = Math.min(1, elapsed / duration);
      // Ease-out cubic animation curve
      const eased = 1 - Math.pow(1 - progress, 3);

      const interpolatedGains = startGains.map(
        (startGain, i) => Math.round((startGain + (flatGains[i] - startGain) * eased) * 10) / 10,
      );

      setBandGains(interpolatedGains);

      if (progress < 1) {
        requestAnimationFrame(animateReset);
      } else {
        handleEqPresetChange("flat");
      }
    };

    // Apply audio node param ramping immediately to smoothly ramp audio filter gains without clicks/pops
    if (audioContextRef.current) {
      const now = audioContextRef.current.currentTime;
      eqFiltersRef.current.forEach((filter, i) => {
        if (filter && filter.gain) {
          smoothSetAudioParam(filter.gain, 0, now, 0.02);
        }
      });
    }

    if (startGains.some((g) => g !== 0)) {
      requestAnimationFrame(animateReset);
    } else {
      handleEqPresetChange("flat");
    }
  };

  // Play Sound Logic (Standalone Mode)
  const startPlaying = useCallback(() => {
    if (externalAudioContext) return; // Don't generate noise if processing external audio

    initAudio();
    const ctx = audioContextRef.current!;
    const masterGain = masterGainRef.current!;
    const audioEntryPoint = eqFiltersRef.current[0] || masterGain;

    if (ctx.state === "suspended") {
      ctx.resume();
    }

    stopPlayingNodes();

    if (preset === "cafe") {
      const buffer = createPinkNoiseBuffer(ctx);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      if (
        filter.frequency &&
        typeof filter.frequency.setValueAtTime === "function"
      ) {
        filter.frequency.setValueAtTime(800, ctx.currentTime);
      }

      source.connect(filter);
      filter.connect(audioEntryPoint);
      source.start();
      sourceNodeRef.current = source;
    } else if (preset === "library") {
      const buffer = createBrownNoiseBuffer(ctx);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      if (
        filter.frequency &&
        typeof filter.frequency.setValueAtTime === "function"
      ) {
        filter.frequency.setValueAtTime(150, ctx.currentTime);
      }

      source.connect(filter);
      filter.connect(audioEntryPoint);
      source.start();
      sourceNodeRef.current = source;
    } else if (preset === "jazz") {
      const notes = [
        [174.61, 220.0, 261.63, 329.63], // Fmaj7
        [196.0, 233.08, 293.66, 349.23], // Gmin7
        [220.0, 261.63, 329.63, 392.0], // Amin7
      ];
      let chordIdx = 0;

      const playChord = () => {
        if (
          !audioContextRef.current ||
          audioContextRef.current.state === "suspended"
        )
          return;
        const now = ctx.currentTime;
        const chord = notes[chordIdx];
        chordIdx = (chordIdx + 1) % notes.length;

        chord.forEach((freq) => {
          const osc = ctx.createOscillator();
          const oscGain = ctx.createGain();
          osc.type = "sine";
          if (
            osc.frequency &&
            typeof osc.frequency.setValueAtTime === "function"
          ) {
            osc.frequency.setValueAtTime(freq, now);
          }

          if (
            oscGain.gain &&
            typeof oscGain.gain.setValueAtTime === "function"
          ) {
            oscGain.gain.setValueAtTime(0, now);
            if (typeof oscGain.gain.linearRampToValueAtTime === "function") {
              oscGain.gain.linearRampToValueAtTime(0.04, now + 1.5);
            }
            if (
              typeof oscGain.gain.exponentialRampToValueAtTime === "function"
            ) {
              oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 4.8);
            }
          }

          osc.connect(oscGain);
          oscGain.connect(audioEntryPoint);
          osc.start(now);
          osc.stop(now + 5.0);
        });
      };

      playChord();
      const interval = setInterval(playChord, 5000);
      jazzCleanupRef.current = () => clearInterval(interval);
    }
  }, [preset, initAudio, stopPlayingNodes, externalAudioContext]);

  const togglePlay = () => {
    if (isPlaying) {
      stopPlaying();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
    }
  };

  useEffect(() => {
    if (isPlaying) {
      startPlaying();
    }
  }, [preset, isPlaying, startPlaying]);

  useEffect(() => {
    // Handle volume for both internal and external contexts if possible
    if (masterGainRef.current && masterGainRef.current.gain) {
      smoothSetAudioParam(
        masterGainRef.current.gain,
        muted ? 0 : volume,
        audioContextRef.current ? audioContextRef.current.currentTime : 0,
        0.02
      );
    }
    // Note: Controlling volume of external sourceNode is usually done at the source element level, 
    // but if we had a gain node wrapper for external, we'd apply it here.
  }, [volume, muted]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        audioContextRef.current &&
        audioContextRef.current.state !== "closed"
      ) {
        audioContextRef.current.resume().catch(() => { });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopPlayingNodes();
      if (
        audioContextRef.current &&
        audioContextRef.current.state !== "closed"
      ) {
        try {
          audioContextRef.current.close().catch(() => { });
        } catch {
          // already closed
        }
        audioContextRef.current = null;
      }
    };
  }, [stopPlayingNodes]);

  // Visualizer Loop
  useEffect(() => {
    let animFrame: number;
    let interval: NodeJS.Timeout;

    const updateFrequencies = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const dpr = window.devicePixelRatio || 1;
      if (
        canvas.width !== Math.floor(rect.width * dpr) ||
        canvas.height !== Math.floor(rect.height * dpr)
      ) {
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let nextFrequencies: number[];
      // Only use FFT analyzer if in standalone mode and playing
      if (analyserRef.current && isPlaying && !externalAudioContext) {
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        nextFrequencies = Array.from({ length: 12 }, (_, i) => {
          const val = dataArray[i * 2] || 0;
          return Math.max(5, Math.min(100, (val / 255) * 100));
        });
      } else {
        nextFrequencies = new Array(12).fill(10);
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      const numBars = 12;
      const gap = 4;
      const barWidth = 6;
      const totalContentWidth = numBars * barWidth + (numBars - 1) * gap;
      const startX = (rect.width - totalContentWidth) / 2;

      const gradient = ctx.createLinearGradient(0, rect.height, 0, 0);
      gradient.addColorStop(0, "#6366f1");
      gradient.addColorStop(0.5, "#a855f7");
      gradient.addColorStop(1, "#f472b6");
      ctx.fillStyle = gradient;

      nextFrequencies.forEach((heightPct, i) => {
        const h = (heightPct / 100) * rect.height;
        const x = startX + i * (barWidth + gap);
        const y = rect.height - h;
        const radius = Math.min(barWidth / 2, h);

        ctx.beginPath();
        ctx.moveTo(x, rect.height);
        ctx.lineTo(x, y + radius);
        if (radius > 0) {
          ctx.arcTo(x, y, x + radius, y, radius);
          ctx.arcTo(x + barWidth, y, x + barWidth, y + radius, radius);
        } else {
          ctx.lineTo(x, y);
          ctx.lineTo(x + barWidth, y);
        }
        ctx.lineTo(x + barWidth, rect.height);
        ctx.closePath();
        ctx.fill();
      });

      ctx.restore();
    };

    if (isPlaying && !externalAudioContext) {
      const isLowBattery =
        batteryLevel !== null && batteryLevel < 0.2 && !batteryCharging;

      if (reducedMotion || isLowBattery) {
        const frameMs = isLowBattery ? 125 : 350;
        interval = setInterval(updateFrequencies, frameMs);
      } else {
        const loop = () => {
          updateFrequencies();
          animFrame = requestAnimationFrame(loop);
        };
        loop();
      }
    } else {
      updateFrequencies(); // Draw idle state
    }

    const handleResize = () => updateFrequencies();
    window.addEventListener("resize", handleResize);

    return () => {
      if (animFrame) cancelAnimationFrame(animFrame);
      if (interval) clearInterval(interval);
      window.removeEventListener("resize", handleResize);
    };
  }, [isPlaying, reducedMotion, batteryLevel, batteryCharging, externalAudioContext]);

  // Helper to get frequency response for the new Canvas
  const getFrequencyResponse = () => {
    return eqRef.current ? eqRef.current.getFrequencyResponse() : { frequencies: new Float32Array(0), magnitudes: new Float32Array(0) };
  };

  const isExternalMode = !!externalAudioContext;

  return (
    <div className={`p-5 rounded-2xl border shadow-xl backdrop-blur-md relative overflow-hidden transition-all duration-300 ${isDarkMode
        ? "border-white/10 bg-black/40 text-zinc-100"
        : "border-gray-200 bg-white/90 text-gray-900"
      }`}>
      <div className="absolute top-0 right-0 p-3 opacity-30">
        <Radio className={`w-5 h-5 animate-pulse ${isDarkMode ? "text-indigo-500" : "text-blue-500"}`} />
      </div>

      <h3 className="text-xs font-black uppercase tracking-widest mb-1 opacity-80">
        {isExternalMode ? "Parametric Equalizer" : "Acoustic Ambience Preview"}
      </h3>
      <p className="text-[10px] uppercase tracking-widest mb-4 opacity-60">
        {isExternalMode
          ? "Real-time frequency curve visualization"
          : `Synthesize simulated ambient soundscapes for ${venueName}`}
      </p>

      {/* Preset Selector Panel */}
      {!isExternalMode && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          {(["jazz", "cafe", "library"] as SoundPreset[]).map((type) => (
            <button
              key={type}
              onClick={() => setPreset(type)}
              className={`py-2 px-3 rounded-xl text-xs font-bold transition-all capitalize border ${preset === type
                  ? isDarkMode
                    ? "bg-indigo-600 border-indigo-500 text-white shadow-md shadow-indigo-600/30 scale-[1.02]"
                    : "bg-blue-600 border-blue-500 text-white shadow-md"
                  : isDarkMode
                    ? "bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10 hover:border-white/10"
                    : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
                }`}
            >
              {type === "jazz" && "🎷 Soft Jazz"}
              {type === "cafe" && "☕ Cafe Chatter"}
              {type === "library" && "📚 Library Silence"}
            </button>
          ))}
        </div>
      )}

      {/* Controller & Equalizer Visualizer */}
      <div className={`flex flex-col sm:flex-row items-center gap-4 p-4 rounded-xl border mb-4 ${isDarkMode ? "bg-white/5 border-white/5" : "bg-gray-50 border-gray-200"
        }`}>
        {!isExternalMode && (
          <button
            onClick={togglePlay}
            className={`p-3 rounded-full flex items-center justify-center transition-all ${isPlaying
                ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 animate-pulse"
                : isDarkMode
                  ? "bg-white text-black hover:opacity-90 active:scale-95"
                  : "bg-gray-900 text-white hover:opacity-90 active:scale-95"
              }`}
            title={isPlaying ? "Pause Sound" : "Listen to Ambience"}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 fill-current" />
            ) : (
              <Play className="w-5 h-5 fill-current ml-0.5" />
            )}
          </button>
        )}

        {/* EQ Preset Selector Dropdown */}
        <select
          value={eqPreset}
          onChange={(e) => handleEqPresetChange(e.target.value as EqPresetName)}
          className={`text-xs font-semibold rounded-lg px-2 py-1.5 outline-none focus:border-indigo-500 transition-colors cursor-pointer appearance-none ${isDarkMode
              ? "bg-white/5 border border-white/10 text-zinc-200"
              : "bg-white border border-gray-300 text-gray-700"
            }`}
          title="Equalizer Preset"
        >
          {(Object.entries(EQ_PRESETS) as [EqPresetName, EqPreset][]).map(
            ([key, { label }]) => (
              <option
                key={key}
                value={key}
                className={isDarkMode ? "bg-zinc-900 text-zinc-100" : "bg-white text-gray-900"}
              >
                {label}
              </option>
            ),
          )}
        </select>

        {/* Visualizer Area */}
        <div className="flex-1 flex items-end justify-center h-12 rounded-lg overflow-hidden border relative bg-black/5">
          {isExternalMode ? (
            // Use new Frequency Response Canvas for external mode
            <FrequencyResponseCanvas
              getFrequencyResponse={getFrequencyResponse}
              isDarkMode={isDarkMode}
            />
          ) : (
            // Use original FFT Canvas for standalone mode
            <canvas
              ref={canvasRef}
              className="w-full h-full absolute top-0 left-0"
              style={{ width: "100%", height: "100%" }}
            />
          )}
        </div>

        {/* Volume controls (Only for standalone mode as external volume is handled elsewhere usually) */}
        {!isExternalMode && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setMuted(!muted)}
              className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? "hover:bg-white/5 text-zinc-400 hover:text-white" : "hover:bg-gray-200 text-gray-500 hover:text-gray-900"
                }`}
            >
              {muted || volume === 0 ? (
                <VolumeX className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => {
                setVolume(parseFloat(e.target.value));
                setMuted(false);
              }}
              className="w-16 h-1 bg-zinc-700 accent-indigo-500 rounded-lg cursor-pointer"
            />
          </div>
        )}
      </div>

      {/* 5-Band Equalizer Controls */}
      <div className={`p-4 rounded-xl border ${isDarkMode ? "bg-white/5 border-white/5" : "bg-gray-50 border-gray-200"
        }`}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-bold uppercase tracking-wider opacity-80">
            {isExternalMode ? "Parametric Bands" : "5-Band Acoustic Equalizer"}
          </span>
          <button
            onClick={handleResetEq}
            className={`flex items-center gap-1 text-[10px] transition-colors ${isDarkMode ? "text-zinc-400 hover:text-white" : "text-gray-500 hover:text-gray-900"
              }`}
            title="Reset to Flat EQ preset (0 dB)"
            aria-label="Reset to Flat"
            data-testid="reset-to-flat-button"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset to Flat</span>
          </button>
        </div>

        {/* New Vertical Sliders Layout from Snippet */}
        {isExternalMode && eqRef.current ? (
          <div className="grid grid-cols-5 gap-4">
            {eqRef.current.bands.map((band) => (
              <div key={band.id} className="flex flex-col items-center gap-2">
                <label className="text-xs font-medium opacity-70 capitalize">
                  {band.id.replace(/([A-Z])/g, ' $1').trim()}
                </label>
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="0.5"
                  // We need to map band.id to index for our state, or just use local state logic
                  // For simplicity in this merge, we'll look up the gain from our main state if indices match
                  // Or better, rely on the component's internal state mapping if we refactored fully.
                  // Here we assume the order matches EQ_BANDS for the visual representation
                  value={bandGains[EQ_BANDS.indexOf(band.frequency)] ?? 0}
                  onChange={(e) => {
                    // Find index by frequency or ID
                    const idx = EQ_BANDS.indexOf(band.frequency);
                    if (idx !== -1) handleBandGainChange(idx, parseFloat(e.target.value));
                  }}
                  className="w-full h-32 appearance-none bg-gray-200 dark:bg-gray-700 rounded-lg cursor-pointer accent-blue-500"
                  style={{ writingMode: 'bt-lr', WebkitAppearance: 'slider-vertical' } as any}
                  aria-label={`${band.id} gain`}
                />
                <span className="text-xs font-mono opacity-60">
                  {(bandGains[EQ_BANDS.indexOf(band.frequency)] ?? 0) > 0
                    ? `+${bandGains[EQ_BANDS.indexOf(band.frequency)]}`
                    : bandGains[EQ_BANDS.indexOf(band.frequency)]} dB
                </span>
              </div>
            ))}
          </div>
        ) : (
          // Original Horizontal Sliders Layout
          <div className="grid grid-cols-5 gap-1 sm:gap-2 text-center">
            {EQ_BAND_LABELS.map((label, idx) => (
              <div
                key={label}
                onDoubleClick={() => handleBandGainChange(idx, 0)}
                className="flex flex-col items-center justify-between gap-1 sm:gap-1.5 min-w-0"
                title="Double-click to reset to 0 dB"
              >
                <span className={`text-[9px] sm:text-[10px] font-mono whitespace-nowrap ${isDarkMode ? "text-zinc-400" : "text-gray-500"}`}>
                  {label}
                </span>
                <input
                  type="range"
                  min="-20"
                  max="20"
                  step="0.5"
                  aria-label={`${label} Gain`}
                  value={bandGains[idx]}
                  onChange={(e) =>
                    handleBandGainChange(idx, parseFloat(e.target.value))
                  }
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleBandGainChange(idx, 0);
                  }}
                  className="w-full h-1 bg-zinc-700 accent-indigo-500 rounded-lg cursor-pointer"
                />
                <span className={`text-[8px] sm:text-[9px] font-mono whitespace-nowrap ${isDarkMode ? "text-indigo-400" : "text-blue-600"}`}>
                  {bandGains[idx] > 0 ? `+${bandGains[idx]}` : bandGains[idx]} dB
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {reducedMotion && (
        <div className={`flex items-center gap-1.5 mt-2 justify-end opacity-40 ${isDarkMode ? "text-zinc-100" : "text-gray-900"}`}>
          <Settings className="w-3.5 h-3.5" />
          <span className="text-[9px] uppercase tracking-wider font-bold">
            Reduced Motion Active
          </span>
        </div>
      )}
      {batteryLevel !== null && (
        <div className={`flex items-center gap-1.5 mt-2 justify-end opacity-40 ${isDarkMode ? "text-zinc-100" : "text-gray-900"}`}>
          {batteryLevel < 0.15 && !batteryCharging ? (
            <BatteryLow className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <Battery className="w-3.5 h-3.5" />
          )}
          <span className="text-[9px] uppercase tracking-wider font-bold">
            {Math.round(batteryLevel * 100)}%
            {batteryCharging ? " Charging" : ""}
          </span>
        </div>
      )}
    </div>
  );
}

export default AudioEqualizer;
