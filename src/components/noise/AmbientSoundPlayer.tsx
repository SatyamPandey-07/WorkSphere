"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Volume2,
  VolumeX,
  Headphones,
  Play,
  Pause,
  X,
  Sparkles,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types & Presets
// ---------------------------------------------------------------------------

export type PresetId = "white_noise" | "pink_noise" | "rain" | "cafe_hum";

export interface SoundscapePreset {
  id: PresetId;
  name: string;
  emoji: string;
  description: string;
  defaultVolume: number;
  badgeClass: string;
  accentClass: string;
}

export const PRESET_SOUNDSCAPES: SoundscapePreset[] = [
  {
    id: "white_noise",
    name: "White Noise",
    emoji: "📻",
    description: "Broadband static sound to mask harsh ambient distractions",
    defaultVolume: 60,
    badgeClass:
      "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
    accentClass: "text-sky-500",
  },
  {
    id: "pink_noise",
    name: "Pink Noise",
    emoji: "🌸",
    description: "Deeper, balanced acoustic profile for calm focus",
    defaultVolume: 60,
    badgeClass:
      "bg-pink-500/10 text-pink-700 dark:text-pink-400 border-pink-500/20",
    accentClass: "text-pink-500",
  },
  {
    id: "rain",
    name: "Rain",
    emoji: "🌧️",
    description: "Gentle rhythmic precipitation and soft droplets",
    defaultVolume: 70,
    badgeClass:
      "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
    accentClass: "text-blue-500",
  },
  {
    id: "cafe_hum",
    name: "Coffee Shop Hum",
    emoji: "☕",
    description: "Warm room murmur and subtle distant café atmosphere",
    defaultVolume: 65,
    badgeClass:
      "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
    accentClass: "text-amber-500",
  },
];

export interface SoundscapeState {
  isPlaying: boolean;
  volume: number; // 0 to 100
}

// ---------------------------------------------------------------------------
// Seamless Audio Buffer Generation
// ---------------------------------------------------------------------------

/**
 * Crossfades the end of an AudioBuffer into the beginning to ensure
 * click-free, gapless seamless looping.
 */
export function applySeamlessLoopCrossfade(
  buffer: AudioBuffer,
  crossfadeSeconds = 0.1,
): void {
  const sampleRate = buffer.sampleRate || 44100;
  const crossfadeFrames = Math.max(
    1,
    Math.min(
      Math.floor(sampleRate * crossfadeSeconds),
      Math.floor(buffer.length / 4),
    ),
  );
  const totalFrames = buffer.length;

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < crossfadeFrames; i++) {
      const progress = i / crossfadeFrames;
      // Equal-power crossfade curve
      const gainIn = Math.sin((progress * Math.PI) / 2);
      const gainOut = Math.cos((progress * Math.PI) / 2);

      const endIdx = totalFrames - crossfadeFrames + i;
      const mixed = data[i] * gainIn + data[endIdx] * gainOut;
      data[i] = mixed;
      data[endIdx] = mixed;
    }
  }
}

/**
 * Generates a White Noise buffer with seamless loop boundaries.
 */
export function generateWhiteNoiseBuffer(
  ctx: AudioContext,
  duration = 4,
): AudioBuffer {
  const sampleRate = ctx.sampleRate || 44100;
  const frameCount = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(2, frameCount, sampleRate);

  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < frameCount; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.15;
    }
  }
  applySeamlessLoopCrossfade(buffer, 0.1);
  return buffer;
}

/**
 * Generates a Pink Noise buffer (1/f spectral slope) with seamless loop boundaries.
 */
export function generatePinkNoiseBuffer(
  ctx: AudioContext,
  duration = 4,
): AudioBuffer {
  const sampleRate = ctx.sampleRate || 44100;
  const frameCount = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(2, frameCount, sampleRate);

  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < frameCount; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] =
        ((b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) / 6.5) * 0.22;
      b6 = white * 0.115926;
    }
  }
  applySeamlessLoopCrossfade(buffer, 0.1);
  return buffer;
}

/**
 * Generates a Rain soundscape buffer with low-frequency rumble and droplet grains.
 */
export function generateRainBuffer(
  ctx: AudioContext,
  duration = 4,
): AudioBuffer {
  const sampleRate = ctx.sampleRate || 44100;
  const frameCount = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(2, frameCount, sampleRate);

  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let last = 0;
    for (let i = 0; i < frameCount; i++) {
      const white = Math.random() * 2 - 1;
      // Gentle filtered lowpass base
      last = (last + 0.04 * white) / 1.04;
      // Soft droplets
      const droplet = Math.random() < 0.015 ? (Math.random() * 2 - 1) * 0.2 : 0;
      data[i] = (last * 1.8 + droplet) * 0.25;
    }
  }
  applySeamlessLoopCrossfade(buffer, 0.15);
  return buffer;
}

/**
 * Generates a Café Hum buffer with warm room resonances and murmur.
 */
export function generateCafeHumBuffer(
  ctx: AudioContext,
  duration = 4,
): AudioBuffer {
  const sampleRate = ctx.sampleRate || 44100;
  const frameCount = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(2, frameCount, sampleRate);

  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let low = 0;
    let mid = 0;
    for (let i = 0; i < frameCount; i++) {
      const white = Math.random() * 2 - 1;
      // Warm low frequency room tone
      low = (low + 0.02 * white) / 1.02;
      // Speech frequency murmur envelope modulation
      const mod = 0.8 + 0.4 * Math.sin((2 * Math.PI * i) / (sampleRate * 1.5));
      mid = (mid + 0.08 * white * mod) / 1.08;
      data[i] = (low * 1.4 + mid * 0.8) * 0.22;
    }
  }
  applySeamlessLoopCrossfade(buffer, 0.15);
  return buffer;
}

/**
 * Helper to generate AudioBuffer for any preset ID.
 */
export function generatePresetAudioBuffer(
  ctx: AudioContext,
  presetId: PresetId,
): AudioBuffer {
  switch (presetId) {
    case "white_noise":
      return generateWhiteNoiseBuffer(ctx);
    case "pink_noise":
      return generatePinkNoiseBuffer(ctx);
    case "rain":
      return generateRainBuffer(ctx);
    case "cafe_hum":
      return generateCafeHumBuffer(ctx);
    default:
      return generateWhiteNoiseBuffer(ctx);
  }
}

// ---------------------------------------------------------------------------
// Animated Wave Bars
// ---------------------------------------------------------------------------

function WaveBars({ active }: { active: boolean }) {
  const heights = [40, 70, 55, 85, 60, 45, 75, 50];
  return (
    <span className="inline-flex items-end gap-px h-3" aria-hidden="true">
      {heights.map((h, i) => (
        <span
          key={i}
          className="w-px rounded-full bg-current"
          style={{
            height: active ? `${h}%` : "20%",
            transition: `height ${active ? 0.2 + i * 0.07 : 0.15}s ease`,
            animation: active
              ? `ambient-wave-${(i % 3) + 1} ${0.6 + i * 0.05}s ease-in-out infinite alternate`
              : "none",
          }}
        />
      ))}
      <style>{`
        @keyframes ambient-wave-1 { from { height: 20% } to { height: 90% } }
        @keyframes ambient-wave-2 { from { height: 30% } to { height: 75% } }
        @keyframes ambient-wave-3 { from { height: 15% } to { height: 85% } }
      `}</style>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export interface AmbientSoundPlayerProps {
  /** Optional noise level string (e.g. "quiet" | "moderate" | "loud") */
  noiseLevel?: string;
  /** Whether to render as an inline standalone card player rather than a trigger popover */
  standalone?: boolean;
  /** Initial open state for the popover panel */
  defaultOpen?: boolean;
  /** Optional custom class name */
  className?: string;
}

export function AmbientSoundPlayer({
  noiseLevel,
  standalone = false,
  defaultOpen = false,
  className = "",
}: AmbientSoundPlayerProps) {
  const [showPanel, setShowPanel] = useState(defaultOpen);
  const [masterVolume, setMasterVolume] = useState(70);
  const [isMasterMuted, setIsMasterMuted] = useState(false);

  // Individual preset soundscape states
  const [soundscapeStates, setSoundscapeStates] = useState<
    Record<PresetId, SoundscapeState>
  >(() => ({
    white_noise: { isPlaying: false, volume: 60 },
    pink_noise: { isPlaying: false, volume: 60 },
    rain: { isPlaying: false, volume: 70 },
    cafe_hum: { isPlaying: false, volume: 65 },
  }));

  // Audio nodes and context refs
  const ctxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const muteGainRef = useRef<GainNode | null>(null);
  const presetBuffersRef = useRef<Map<PresetId, AudioBuffer>>(new Map());
  const presetNodesRef = useRef<
    Map<PresetId, { source: AudioBufferSourceNode; gain: GainNode }>
  >(new Map());

  // Safe AudioContext getter
  const getOrCreateAudioContext = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;

    if (!ctxRef.current || ctxRef.current.state === "closed") {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return null;

      const ctx = new AudioCtx();
      ctxRef.current = ctx;

      const masterGain = ctx.createGain();
      masterGain.gain.value = masterVolume / 100;
      masterGainRef.current = masterGain;

      const muteGain = ctx.createGain();
      muteGain.gain.value = isMasterMuted ? 0 : 1;
      muteGainRef.current = muteGain;

      masterGain.connect(muteGain);
      muteGain.connect(ctx.destination);
    }

    return ctxRef.current;
  }, [masterVolume, isMasterMuted]);

  // Cleanup on unmount
  useEffect(() => {
    const presetNodes = presetNodesRef.current;
    return () => {
      presetNodes.forEach(({ source, gain }) => {
        try {
          source.stop();
        } catch {
          // ignore
        }
        try {
          source.disconnect();
          gain.disconnect();
        } catch {
          // ignore
        }
      });
      presetNodes.clear();

      if (ctxRef.current && ctxRef.current.state !== "closed") {
        ctxRef.current.close().catch(() => {});
      }
      ctxRef.current = null;
    };
  }, []);

  // Toggle play/pause for a specific preset soundscape
  const togglePresetPlay = useCallback(
    async (presetId: PresetId) => {
      const currentState = soundscapeStates[presetId];
      const shouldPlay = !currentState.isPlaying;

      const ctx = getOrCreateAudioContext();
      if (!ctx) return;

      if (ctx.state === "suspended") {
        await ctx.resume().catch(() => {});
      }

      if (shouldPlay) {
        // Retrieve or generate cached buffer
        let buffer = presetBuffersRef.current.get(presetId);
        if (!buffer) {
          buffer = generatePresetAudioBuffer(ctx, presetId);
          presetBuffersRef.current.set(presetId, buffer);
        }

        // Stop any existing node
        const existing = presetNodesRef.current.get(presetId);
        if (existing) {
          try {
            existing.source.stop();
          } catch {
            // ignore
          }
          existing.source.disconnect();
          existing.gain.disconnect();
        }

        // Create independent gain node for this soundscape
        const gainNode = ctx.createGain();
        gainNode.gain.value = currentState.volume / 100;
        gainNode.connect(masterGainRef.current!);

        // Create buffer source node with seamless looping enabled
        const sourceNode = ctx.createBufferSource();
        sourceNode.buffer = buffer;
        sourceNode.loop = true;
        sourceNode.connect(gainNode);
        sourceNode.start();

        presetNodesRef.current.set(presetId, {
          source: sourceNode,
          gain: gainNode,
        });

        setSoundscapeStates((prev) => ({
          ...prev,
          [presetId]: { ...prev[presetId], isPlaying: true },
        }));
      } else {
        // Stop playback
        const node = presetNodesRef.current.get(presetId);
        if (node) {
          try {
            if (ctx.state !== "closed") {
              node.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
              setTimeout(() => {
                try {
                  node.source.stop();
                } catch {
                  // ignore
                }
                node.source.disconnect();
                node.gain.disconnect();
              }, 60);
            } else {
              node.source.stop();
            }
          } catch {
            // ignore
          }
          presetNodesRef.current.delete(presetId);
        }

        setSoundscapeStates((prev) => ({
          ...prev,
          [presetId]: { ...prev[presetId], isPlaying: false },
        }));
      }
    },
    [soundscapeStates, getOrCreateAudioContext],
  );

  // Handle independent volume adjustment per soundscape
  const handlePresetVolumeChange = useCallback(
    (presetId: PresetId, val: number) => {
      setSoundscapeStates((prev) => ({
        ...prev,
        [presetId]: { ...prev[presetId], volume: val },
      }));

      const node = presetNodesRef.current.get(presetId);
      if (node && ctxRef.current && ctxRef.current.state !== "closed") {
        node.gain.gain.setTargetAtTime(
          val / 100,
          ctxRef.current.currentTime,
          0.03,
        );
      }
    },
    [],
  );

  // Handle master volume adjustment
  const handleMasterVolumeChange = useCallback((val: number) => {
    setMasterVolume(val);
    if (
      masterGainRef.current &&
      ctxRef.current &&
      ctxRef.current.state !== "closed"
    ) {
      masterGainRef.current.gain.setTargetAtTime(
        val / 100,
        ctxRef.current.currentTime,
        0.03,
      );
    }
  }, []);

  // Handle master mute toggle
  const toggleMasterMute = useCallback(() => {
    setIsMasterMuted((prev) => {
      const next = !prev;
      if (
        muteGainRef.current &&
        ctxRef.current &&
        ctxRef.current.state !== "closed"
      ) {
        muteGainRef.current.gain.setTargetAtTime(
          next ? 0 : 1,
          ctxRef.current.currentTime,
          0.03,
        );
      }
      return next;
    });
  }, []);

  const anyPlaying = Object.values(soundscapeStates).some((s) => s.isPlaying);

  // Soundscape Cards UI Content
  const soundscapePanelContent = (
    <div
      role="region"
      aria-label="Preset Soundscapes Player"
      data-testid="soundscape-player-panel"
      className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md shadow-2xl p-4 space-y-4"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-zinc-150 dark:border-zinc-800 pb-3">
        <div>
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <h3 className="text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-50">
              Focus Soundscapes
            </h3>
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
            Mask café noise with seamless audio loops
          </p>
        </div>
        {!standalone && (
          <button
            type="button"
            onClick={() => setShowPanel(false)}
            aria-label="Close soundscape panel"
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Master Volume Controls */}
      <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-850/80 border border-zinc-200/80 dark:border-zinc-750/80">
        <div className="flex items-center justify-between text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1.5">
          <span>Master Volume</span>
          <span
            data-testid="master-volume-label"
            className="font-mono text-[11px] text-zinc-500"
          >
            {isMasterMuted ? "Muted" : `${masterVolume}%`}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={toggleMasterMute}
            aria-label={isMasterMuted ? "Unmute master" : "Mute master"}
            data-testid="master-mute-btn"
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors shrink-0"
          >
            {isMasterMuted ? (
              <VolumeX className="w-4 h-4 text-rose-500" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={masterVolume}
            aria-label="Master volume"
            data-testid="master-volume-slider"
            onChange={(e) => handleMasterVolumeChange(Number(e.target.value))}
            className="flex-1 h-2 rounded-lg bg-zinc-200 dark:bg-zinc-700 accent-blue-600 cursor-pointer"
          />
        </div>
      </div>

      {/* Preset Soundscapes Cards Grid */}
      <div
        data-testid="soundscapes-grid"
        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
      >
        {PRESET_SOUNDSCAPES.map((preset) => {
          const state = soundscapeStates[preset.id];
          return (
            <div
              key={preset.id}
              data-testid={`soundscape-card-${preset.id}`}
              className={`p-3 rounded-xl border transition-all ${
                state.isPlaying
                  ? "border-blue-500/40 bg-blue-50/20 dark:bg-blue-950/20 shadow-sm"
                  : "border-zinc-200 dark:border-zinc-750 bg-zinc-50/60 dark:bg-zinc-850/50"
              } flex flex-col justify-between`}
            >
              <div>
                <div className="flex items-start justify-between gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base" role="img" aria-hidden="true">
                      {preset.emoji}
                    </span>
                    <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                      {preset.name}
                    </span>
                  </div>
                  {state.isPlaying && (
                    <span
                      data-testid={`status-badge-${preset.id}`}
                      className={`px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border shrink-0 ${preset.badgeClass}`}
                    >
                      Playing
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 line-clamp-2 leading-relaxed">
                  {preset.description}
                </p>
              </div>

              <div className="mt-3 space-y-2.5">
                {/* Independent Volume Slider */}
                <div className="flex items-center gap-2">
                  <Volume2 className="w-3 h-3 text-zinc-400 shrink-0" />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={state.volume}
                    aria-label={`${preset.name} volume`}
                    data-testid={`volume-slider-${preset.id}`}
                    onChange={(e) =>
                      handlePresetVolumeChange(
                        preset.id,
                        Number(e.target.value),
                      )
                    }
                    className="flex-1 h-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-700 accent-blue-600 cursor-pointer"
                  />
                  <span
                    data-testid={`volume-label-${preset.id}`}
                    className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 w-7 text-right tabular-nums"
                  >
                    {state.volume}%
                  </span>
                </div>

                {/* Play / Pause Toggle Button */}
                <button
                  type="button"
                  onClick={() => void togglePresetPlay(preset.id)}
                  aria-label={
                    state.isPlaying
                      ? `Pause ${preset.name}`
                      : `Play ${preset.name}`
                  }
                  data-testid={`play-toggle-${preset.id}`}
                  className={`w-full py-1.5 px-3 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] ${
                    state.isPlaying
                      ? "bg-zinc-800 text-white dark:bg-zinc-700 hover:bg-zinc-700 dark:hover:bg-zinc-600 shadow-sm"
                      : "bg-blue-600 text-white hover:bg-blue-500 shadow-sm"
                  }`}
                >
                  {state.isPlaying ? (
                    <>
                      <Pause className="w-3.5 h-3.5 fill-current" />
                      <span>Pause</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Play</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // If standalone, render the soundscape cards directly
  if (standalone) {
    return (
      <div className={`w-full ${className}`}>{soundscapePanelContent}</div>
    );
  }

  // Popover trigger mode (for VenueCard integration)
  return (
    <div className={`relative inline-flex items-center ${className}`}>
      {/* Trigger button */}
      <button
        id={`ambient-player-trigger-${noiseLevel ?? "default"}`}
        type="button"
        onClick={() => setShowPanel((v) => !v)}
        aria-label="Preset focus soundscapes player"
        title="Focus Soundscapes: White Noise, Rain, Café Hum"
        data-testid="ambient-sound-trigger"
        className={`
          inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold
          transition-all duration-150 active:scale-95
          text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 border-zinc-300 dark:border-zinc-700
          ${showPanel ? "ring-1 ring-blue-500 ring-offset-1" : ""}
        `}
      >
        <Headphones className="w-3 h-3 shrink-0 text-blue-500" />
        <span className="sr-only">Focus soundscapes</span>
        {anyPlaying && <WaveBars active={!isMasterMuted} />}
      </button>

      {/* Floating control panel */}
      {showPanel && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowPanel(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-label="Ambient soundscapes player"
            className="absolute bottom-full left-0 z-50 mb-2 w-80 sm:w-96 max-w-[95vw]"
          >
            {soundscapePanelContent}
          </div>
        </>
      )}
    </div>
  );
}

export default AmbientSoundPlayer;
