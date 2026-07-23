"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Play, Pause, Volume2, VolumeX, Radio, Settings } from "lucide-react";

type SoundPreset = "jazz" | "cafe" | "library";

/**
 * Interface representing component props for the AudioEqualizer component.
 *
 * @example
 * ```tsx
 * import { AudioEqualizer } from "@/components/audio/AudioEqualizer";
 *
 * export default function WorkspacePage() {
 *   return (
 *     <AudioEqualizer
 *       venueName="Quiet Library"
 *       initialGains={[0, 2, -1, 3, 0, -2, 1, 0, 0, 0]}
 *       onGainChange={(index, gain) => console.log(`Band ${index} gain changed to ${gain}dB`)}
 *       sampleRate={44100}
 *     />
 *   );
 * }
 * ```
 */
export interface AudioEqualizerProps {
  /**
   * Display name of the workspace or venue shown in the equalizer header.
   * @default "Workspace"
   */
  venueName?: string;
  /**
   * Initial gain values in decibels (dB) for each frequency band.
   * @default [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
   */
  initialGains?: number[];
  /**
   * Callback fired when an equalizer frequency band gain is modified.
   * @param bandIndex - The zero-based index of the updated band.
   * @param newGain - The newly selected gain value in decibels (dB).
   */
  onGainChange?: (bandIndex: number, newGain: number) => void;
  /**
   * Audio processing sample rate in Hz.
   * @default 44100
   */
  sampleRate?: number;
}

export function AudioEqualizer({
  venueName = "Workspace",
  initialGains: _initialGains,
  onGainChange: _onGainChange,
  sampleRate: _sampleRate = 44100,
}: AudioEqualizerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [preset, setPreset] = useState<SoundPreset>("jazz");
  const [eqPreset, setEqPreset] = useState<EqPresetName>("flat");
  const [volume, setVolume] = useState(0.5);
  const [muted, setMuted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const eqFiltersRef = useRef<BiquadFilterNode[]>([]);
  const jazzCleanupRef = useRef<(() => void) | null>(null);
  const [frequencies, setFrequencies] = useState<number[]>(
    new Array(12).fill(10),
  );

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
      return () => mediaQuery.removeEventListener("change", listener);
    }
  }, []);

  // Initialize Audio Context on demand
  const initAudio = () => {
    if (audioContextRef.current) return;
    const AudioContextClass =
      window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass();
    const masterGain = ctx.createGain();
    const analyser = ctx.createAnalyser();

    // Create 5-band parametric EQ filters
    const eqFilters = EQ_FREQUENCIES.map((freq, i) => {
      const filter = ctx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.setValueAtTime(freq, ctx.currentTime);
      filter.Q.setValueAtTime(1.2, ctx.currentTime);
      filter.gain.setValueAtTime(EQ_PRESETS[eqPreset].gains[i], ctx.currentTime);
      return filter;
    });

    // Chain: source -> EQ filters -> master gain -> analyser -> destination
    let lastNode: AudioNode = eqFilters[0];
    for (let i = 1; i < eqFilters.length; i++) {
      lastNode.connect(eqFilters[i]);
      lastNode = eqFilters[i];
    }
    lastNode.connect(masterGain);
    masterGain.connect(analyser);
    analyser.connect(ctx.destination);

    audioContextRef.current = ctx;
    masterGainRef.current = masterGain;
    analyserRef.current = analyser;
    eqFiltersRef.current = eqFilters;
  };

  // Helper: Create Pink Noise Buffer
  const createPinkNoiseBuffer = (ctx: AudioContext) => {
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
  };

  // Helper: Create Brown Noise Buffer
  const createBrownNoiseBuffer = (ctx: AudioContext) => {
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
  };

  // Play Sound Logic
  const stopPlayingNodes = useCallback(() => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch {}
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

  // Play Sound Logic
  const startPlaying = useCallback(() => {
    initAudio();
    const ctx = audioContextRef.current!;
    const masterGain = masterGainRef.current!;

    if (ctx.state === "suspended") {
      ctx.resume();
    }

    // Stop existing source/jazz notes
    stopPlayingNodes();

    const eqInput = eqFiltersRef.current[0];

    if (preset === "cafe") {
      // Cafe Chatter
      const buffer = createPinkNoiseBuffer(ctx);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      // Filter to simulate muffled chatter
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(800, ctx.currentTime);

      source.connect(filter);
      filter.connect(eqInput);
      source.start();
      sourceNodeRef.current = source;
    } else if (preset === "library") {
      // Library Silence (Brown Noise + filter for HVAC hum)
      const buffer = createBrownNoiseBuffer(ctx);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(150, ctx.currentTime);

      source.connect(filter);
      filter.connect(eqInput);
      source.start();
      sourceNodeRef.current = source;
    } else if (preset === "jazz") {
      // Soft Jazz synthesizer chords
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
          osc.frequency.setValueAtTime(freq, now);

          // Pad envelope: soft attack & long release
          oscGain.gain.setValueAtTime(0, now);
          oscGain.gain.linearRampToValueAtTime(0.04, now + 1.5);
          oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 4.8);

          osc.connect(oscGain);
          oscGain.connect(eqInput);
          osc.start(now);
          osc.stop(now + 5.0);
        });
      };

      playChord();
      const interval = setInterval(playChord, 5000);
      jazzCleanupRef.current = () => clearInterval(interval);
    }
  }, [preset, stopPlayingNodes]);

  // Toggle Action
  const togglePlay = () => {
    if (isPlaying) {
      stopPlaying();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
    }
  };

  // Handle Preset or Volume changes
  useEffect(() => {
    if (isPlaying) {
      startPlaying();
    }
  }, [preset, isPlaying, startPlaying]);

  useEffect(() => {
    if (masterGainRef.current) {
      masterGainRef.current.gain.setValueAtTime(
        muted ? 0 : volume,
        audioContextRef.current ? audioContextRef.current.currentTime : 0,
      );
    }
  }, [volume, muted]);

  useEffect(() => {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    const gains = EQ_PRESETS[eqPreset].gains;
    eqFiltersRef.current.forEach((filter, i) => {
      filter.gain.setValueAtTime(gains[i], ctx.currentTime);
    });
  }, [eqPreset]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopPlayingNodes();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [stopPlayingNodes]);

  // Visualizer Animation Loop
  useEffect(() => {
    let animFrame: number;
    let interval: NodeJS.Timeout;

    const updateFrequencies = () => {
      if (!analyserRef.current || !isPlaying) return;
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(dataArray);

      // Downsample data points for 12 display bars
      const nextFrequencies = Array.from({ length: 12 }, (_, i) => {
        const val = dataArray[i * 2] || 0;
        return Math.max(5, Math.min(100, (val / 255) * 100));
      });
      setFrequencies(nextFrequencies);
    };

    if (isPlaying) {
      if (reducedMotion) {
        // Reduced motion: update very slowly for accessibility/performance
        interval = setInterval(updateFrequencies, 350);
      } else {
        const loop = () => {
          updateFrequencies();
          animFrame = requestAnimationFrame(loop);
        };
        loop();
      }
    } else {
      setFrequencies(new Array(12).fill(10));
    }

    return () => {
      if (animFrame) cancelAnimationFrame(animFrame);
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, reducedMotion]);

  return (
    <div className="p-5 rounded-2xl border border-white/10 bg-black/40 text-zinc-100 shadow-xl backdrop-blur-md relative overflow-hidden transition-all duration-300">
      <div className="absolute top-0 right-0 p-3 opacity-30">
        <Radio className="w-5 h-5 text-indigo-500 animate-pulse" />
      </div>

      <h3 className="text-xs font-black uppercase tracking-widest text-zinc-300 mb-1">
        Acoustic Ambience Preview
      </h3>
      <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-4">
        Synthesize simulated ambient soundscapes for {venueName}
      </p>

      {/* Preset Selector Panel */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {(["jazz", "cafe", "library"] as SoundPreset[]).map((type) => (
          <button
            key={type}
            onClick={() => setPreset(type)}
            className={`py-2 px-3 rounded-xl text-xs font-bold transition-all capitalize border ${
              preset === type
                ? "bg-indigo-600 border-indigo-500 text-white shadow-md shadow-indigo-600/30 scale-[1.02]"
                : "bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10 hover:border-white/10"
            }`}
          >
            {type === "jazz" && "🎷 Soft Jazz"}
            {type === "cafe" && "☕ Cafe Chatter"}
            {type === "library" && "📚 Library Silence"}
          </button>
        ))}
      </div>

      {/* Controller & Equalizer Visualizer */}
      <div className="flex flex-col sm:flex-row items-center gap-4 bg-white/5 p-4 rounded-xl border border-white/5">
        <button
          onClick={togglePlay}
          className={`p-3 rounded-full flex items-center justify-center transition-all ${
            isPlaying
              ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 animate-pulse"
              : "bg-white text-black hover:opacity-90 active:scale-95"
          }`}
          title={isPlaying ? "Pause Sound" : "Listen to Ambience"}
        >
          {isPlaying ? (
            <Pause className="w-5 h-5 fill-current" />
          ) : (
            <Play className="w-5 h-5 fill-current ml-0.5" />
          )}
        </button>

        {/* EQ Preset Selector */}
        <select
          value={eqPreset}
          onChange={(e) => setEqPreset(e.target.value as EqPresetName)}
          className="text-xs font-semibold bg-white/5 border border-white/10 text-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:border-indigo-500 transition-colors cursor-pointer appearance-none"
          title="Equalizer Preset"
        >
          {(Object.entries(EQ_PRESETS) as [EqPresetName, EqPreset][]).map(
            ([key, { label }]) => (
              <option key={key} value={key} className="bg-zinc-900 text-zinc-100">
                {label}
              </option>
            ),
          )}
        </select>

        {/* Equalizer Frequency Bars */}
        <div className="flex-1 flex items-end justify-center gap-[4px] h-12 px-2 bg-black/20 rounded-lg overflow-hidden border border-white/5">
          {frequencies.map((height, i) => (
            <div
              key={i}
              className={`w-[6px] rounded-t-full bg-gradient-to-t from-indigo-500 via-purple-500 to-pink-400 transition-all ${
                isPlaying ? "duration-75" : "duration-300"
              }`}
              style={{
                height: `${height}%`,
              }}
            />
          ))}
        </div>

        {/* Volume controls */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setMuted(!muted)}
            className="p-1.5 hover:bg-white/5 rounded-lg text-zinc-400 hover:text-white transition-colors"
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
      </div>

      {reducedMotion && (
        <div className="flex items-center gap-1.5 mt-2 justify-end opacity-40">
          <Settings className="w-3.5 h-3.5" />
          <span className="text-[9px] uppercase tracking-wider font-bold">
            Reduced Motion Active
          </span>
        </div>
      )}
    </div>
  );
}
