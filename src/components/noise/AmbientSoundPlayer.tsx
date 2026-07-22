"use client";

/**
 * AmbientSoundPlayer — Issue #701
 *
 * Renders a mini audio player trigger next to a venue's noise level indicator.
 * Plays short 5-second looping ambient soundscapes synthesized via the Web
 * Audio API (no external audio files required):
 *
 *   "quiet"    → Quiet Library  (~35 dB)  — barely-audible pink noise hum
 *   "moderate" → Cafe Chatter   (~55 dB)  — band-passed speech-frequency noise
 *   "loud"     → Bustling Lounge (~75 dB) — broadband noise + strong chatter
 *
 * Controls: play / pause toggle, inline volume slider, mute button.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Volume2, VolumeX, Headphones, Square, Play } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NoiseLevelKey = "quiet" | "moderate" | "loud";

interface SoundProfile {
  label: string;
  emoji: string;
  description: string;
  /** Master gain (0–1) applied to the synthesized noise */
  masterGain: number;
  /** Band-pass filter centre frequency in Hz for the "chatter" layer */
  speechFreq: number;
  /** Gain of the speech / chatter band-pass layer (0 = silent) */
  speechGain: number;
  /** Colour classes for the playing badge */
  badgeClass: string;
  /** Colour classes for the trigger button */
  buttonClass: string;
}

const SOUND_PROFILES: Record<NoiseLevelKey, SoundProfile> = {
  quiet: {
    label: "Quiet Library",
    emoji: "🍃",
    description: "Barely-audible ambient hum — ideal for deep focus",
    masterGain: 0.04,
    speechFreq: 800,
    speechGain: 0.0,
    badgeClass:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
    buttonClass:
      "text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 border-emerald-500/30",
  },
  moderate: {
    label: "Cafe Chatter",
    emoji: "☕",
    description: "Soft background chatter and ambient cafe sounds",
    masterGain: 0.14,
    speechFreq: 1200,
    speechGain: 0.55,
    badgeClass:
      "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
    buttonClass:
      "text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 border-amber-500/30",
  },
  loud: {
    label: "Bustling Lounge",
    emoji: "🔊",
    description: "Busy, energetic environment with lively ambient noise",
    masterGain: 0.32,
    speechFreq: 1600,
    speechGain: 0.85,
    badgeClass:
      "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
    buttonClass:
      "text-rose-700 dark:text-rose-400 hover:bg-rose-500/10 border-rose-500/30",
  },
};

// ---------------------------------------------------------------------------
// Audio synthesis helpers
// ---------------------------------------------------------------------------

/**
 * Generates a stereo pink-noise AudioBuffer (5 seconds) using the
 * Voss-McCartney algorithm.
 */
function generatePinkNoiseBuffer(
  ctx: AudioContext,
  durationSeconds = 5,
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const frameCount = Math.floor(sampleRate * durationSeconds);
  const buffer = ctx.createBuffer(2, frameCount, sampleRate);

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    // Voss-McCartney pink noise: sum of white noise layers at binary offsets
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
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) / 6.5;
      b6 = white * 0.115926;
    }
  }

  return buffer;
}

/**
 * Creates and wires up the audio graph for a given sound profile.
 * Returns a cleanup function that stops all nodes.
 */
function createSoundscape(
  ctx: AudioContext,
  profile: SoundProfile,
  volumeNode: GainNode,
  muteNode: GainNode,
): () => void {
  const noiseBuffer = generatePinkNoiseBuffer(ctx);
  const cleanupFns: Array<() => void> = [];

  // ── Base pink noise layer ────────────────────────────────────────────────
  const baseGain = ctx.createGain();
  baseGain.gain.value = profile.masterGain;
  baseGain.connect(volumeNode);

  const baseSource = ctx.createBufferSource();
  baseSource.buffer = noiseBuffer;
  baseSource.loop = true;
  baseSource.connect(baseGain);
  baseSource.start();
  cleanupFns.push(() => {
    try {
      baseSource.stop();
    } catch {
      /* already stopped */
    }
  });

  // ── Speech / chatter band-pass layer ────────────────────────────────────
  if (profile.speechGain > 0) {
    const speechGain = ctx.createGain();
    speechGain.gain.value = profile.speechGain;
    speechGain.connect(volumeNode);

    const bpf = ctx.createBiquadFilter();
    bpf.type = "bandpass";
    bpf.frequency.value = profile.speechFreq;
    bpf.Q.value = 0.8;
    bpf.connect(speechGain);

    const speechSource = ctx.createBufferSource();
    speechSource.buffer = generatePinkNoiseBuffer(ctx);
    speechSource.loop = true;
    speechSource.connect(bpf);
    speechSource.start();
    cleanupFns.push(() => {
      try {
        speechSource.stop();
      } catch {
        /* already stopped */
      }
    });

    // ── Extra high-mid sparkle for "loud" ─────────────────────────────────
    if (profile.masterGain > 0.25) {
      const sparkleGain = ctx.createGain();
      sparkleGain.gain.value = 0.3;
      sparkleGain.connect(volumeNode);

      const hpf = ctx.createBiquadFilter();
      hpf.type = "highpass";
      hpf.frequency.value = 2400;
      hpf.Q.value = 0.5;
      hpf.connect(sparkleGain);

      const sparkleSource = ctx.createBufferSource();
      sparkleSource.buffer = generatePinkNoiseBuffer(ctx);
      sparkleSource.loop = true;
      sparkleSource.connect(hpf);
      sparkleSource.start();
      cleanupFns.push(() => {
        try {
          sparkleSource.stop();
        } catch {
          /* already stopped */
        }
      });
    }
  }

  volumeNode.connect(muteNode);
  muteNode.connect(ctx.destination);

  return () => cleanupFns.forEach((fn) => fn());
}

// ---------------------------------------------------------------------------
// Wave animation bars (CSS-in-JS via inline style — no Tailwind keyframes needed)
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

      {/* Keyframe injection via a <style> tag scoped to the component */}
      <style>{`
        @keyframes ambient-wave-1 { from { height: 20% } to { height: 90% } }
        @keyframes ambient-wave-2 { from { height: 30% } to { height: 75% } }
        @keyframes ambient-wave-3 { from { height: 15% } to { height: 85% } }
      `}</style>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface AmbientSoundPlayerProps {
  /** Maps directly to venue.noiseLevel */
  noiseLevel: string;
}

export function AmbientSoundPlayer({ noiseLevel }: AmbientSoundPlayerProps) {
  const level = (
    ["quiet", "moderate", "loud"].includes(noiseLevel) ? noiseLevel : "moderate"
  ) as NoiseLevelKey;

  const profile = SOUND_PROFILES[level];

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(70); // 0–100
  const [showPanel, setShowPanel] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const volumeNodeRef = useRef<GainNode | null>(null);
  const muteNodeRef = useRef<GainNode | null>(null);
  const stopSoundRef = useRef<(() => void) | null>(null);

  // Tear down on unmount
  useEffect(() => {
    return () => {
      stopSoundRef.current?.();
      ctxRef.current?.close().catch(() => {});
    };
  }, []);

  const startPlayback = useCallback(async () => {
    // Resume or create AudioContext (browser requires user gesture)
    if (!ctxRef.current || ctxRef.current.state === "closed") {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return; // browser doesn't support Web Audio
      ctxRef.current = new Ctx();
    }

    const ctx = ctxRef.current;
    if (ctx.state === "suspended") await ctx.resume();

    const volumeNode = ctx.createGain();
    volumeNode.gain.value = volume / 100;
    volumeNodeRef.current = volumeNode;

    const muteNode = ctx.createGain();
    muteNode.gain.value = isMuted ? 0 : 1;
    muteNodeRef.current = muteNode;

    const stop = createSoundscape(ctx, profile, volumeNode, muteNode);
    stopSoundRef.current = stop;

    setIsPlaying(true);
  }, [profile, volume, isMuted]);

  const stopPlayback = useCallback(() => {
    stopSoundRef.current?.();
    stopSoundRef.current = null;
    setIsPlaying(false);
  }, []);

  const togglePlay = useCallback(async () => {
    if (isPlaying) {
      stopPlayback();
    } else {
      await startPlayback();
    }
  }, [isPlaying, startPlayback, stopPlayback]);

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Number(e.target.value);
      setVolume(val);
      if (volumeNodeRef.current) {
        volumeNodeRef.current.gain.setTargetAtTime(
          val / 100,
          ctxRef.current!.currentTime,
          0.05,
        );
      }
    },
    [],
  );

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (muteNodeRef.current) {
        muteNodeRef.current.gain.setTargetAtTime(
          next ? 0 : 1,
          ctxRef.current!.currentTime,
          0.05,
        );
      }
      return next;
    });
  }, []);

  return (
    <div className="relative inline-flex items-center">
      {/* Trigger button */}
      <button
        id={`ambient-player-trigger-${level}`}
        type="button"
        onClick={() => setShowPanel((v) => !v)}
        aria-label={`Preview ${profile.label} ambient sound`}
        title={`Preview: ${profile.label} — ${profile.description}`}
        className={`
          inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold
          transition-all duration-150 active:scale-95
          ${profile.buttonClass}
          ${showPanel ? "ring-1 ring-current ring-offset-1" : ""}
        `}
      >
        <Headphones className="w-3 h-3 shrink-0" />
        <span className="sr-only">Preview ambient sound</span>
        {isPlaying && <WaveBars active />}
      </button>

      {/* Floating control panel */}
      {showPanel && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowPanel(false)}
            aria-hidden="true"
          />

          <div
            role="dialog"
            aria-label={`Ambient sound player — ${profile.label}`}
            className="
              absolute bottom-full left-0 z-50 mb-2
              w-64 rounded-2xl border border-zinc-200 dark:border-zinc-700
              bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md
              shadow-2xl shadow-black/10 dark:shadow-black/40
              p-4 space-y-3
              animate-in fade-in slide-in-from-bottom-2 duration-150
            "
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-50">
                  {profile.emoji} {profile.label}
                </p>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-snug">
                  {profile.description}
                </p>
              </div>
              {/* Playing badge */}
              {isPlaying && (
                <span
                  className={`
                    flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-wider
                    ${profile.badgeClass}
                  `}
                >
                  <WaveBars active={!isMuted} />
                  {isMuted ? "MUTED" : "LIVE"}
                </span>
              )}
            </div>

            {/* Play / Stop control */}
            <button
              id={`ambient-player-play-${level}`}
              type="button"
              onClick={togglePlay}
              className={`
                w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5
                text-xs font-black uppercase tracking-tight text-white
                transition-all duration-150 active:scale-[0.97] shadow-md
                ${
                  isPlaying
                    ? "bg-zinc-800 hover:bg-zinc-700 dark:bg-zinc-700 dark:hover:bg-zinc-600"
                    : level === "quiet"
                      ? "bg-emerald-600 hover:bg-emerald-500"
                      : level === "moderate"
                        ? "bg-amber-500 hover:bg-amber-400"
                        : "bg-rose-600 hover:bg-rose-500"
                }
              `}
            >
              {isPlaying ? (
                <>
                  <Square className="h-3.5 w-3.5 fill-current" />
                  Stop Preview
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 fill-current" />
                  Play 5-sec Loop
                </>
              )}
            </button>

            {/* Volume + Mute row */}
            <div className="flex items-center gap-2">
              <button
                id={`ambient-player-mute-${level}`}
                type="button"
                onClick={toggleMute}
                aria-label={isMuted ? "Unmute" : "Mute"}
                title={isMuted ? "Unmute" : "Mute"}
                className="flex-shrink-0 p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500 dark:text-zinc-400"
              >
                {isMuted ? (
                  <VolumeX className="w-3.5 h-3.5" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
              </button>

              <input
                id={`ambient-player-volume-${level}`}
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={handleVolumeChange}
                aria-label="Volume"
                className="flex-1 h-1.5 rounded-full accent-blue-500 cursor-pointer"
                style={{ accentColor: "currentColor" }}
              />

              <span className="text-[10px] font-bold text-zinc-400 w-7 text-right tabular-nums">
                {isMuted ? "—" : `${volume}%`}
              </span>
            </div>

            {/* Decibel range hint */}
            <p className="text-[9px] text-zinc-400 dark:text-zinc-500 text-center border-t border-zinc-100 dark:border-zinc-800 pt-2">
              Simulates ambient decibel level recorded at similar venues
            </p>
          </div>
        </>
      )}
    </div>
  );
}
