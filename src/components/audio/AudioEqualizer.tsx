"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Radio,
  Settings,
  RotateCcw,
} from "lucide-react";

type SoundPreset = "jazz" | "cafe" | "library";

export const EQ_BANDS = [60, 250, 1000, 4000, 12000];
export const EQ_BAND_LABELS = ["60Hz", "250Hz", "1kHz", "4kHz", "12kHz"];

interface AudioEqualizerProps {
  venueName?: string;
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

export function AudioEqualizer({
  venueName = "Workspace",
}: AudioEqualizerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [preset, setPreset] = useState<SoundPreset>("jazz");
  const [volume, setVolume] = useState(0.5);
  const [muted, setMuted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [bandGains, setBandGains] = useState<number[]>([0, 0, 0, 0, 0]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const eqFiltersRef = useRef<BiquadFilterNode[]>([]);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
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

  // Initialize Audio Context and BiquadFilterNode EQ chain on demand
  const initAudio = useCallback(() => {
    if (audioContextRef.current) return;
    const AudioContextClass =
      window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass();
    const masterGain = ctx.createGain();
    const analyser = ctx.createAnalyser();

    analyser.fftSize = 64;
    masterGain.connect(analyser);
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
          filter.Q.value = 1.4;
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
  }, [bandGains]);

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

  // Handle Real-Time Gain Slider Drag with Smooth Audio Parameter Ramping
  const handleBandGainChange = (index: number, newGain: number) => {
    setBandGains((prev) => {
      const next = [...prev];
      next[index] = newGain;
      return next;
    });

    const filter = eqFiltersRef.current[index];
    if (filter && filter.gain && audioContextRef.current) {
      const now = audioContextRef.current.currentTime;
      if (typeof filter.gain.setTargetAtTime === "function") {
        // Smooth audio param ramp to eliminate audio pops and clicks
        filter.gain.setTargetAtTime(newGain, now, 0.015);
      } else if (typeof filter.gain.linearRampToValueAtTime === "function") {
        filter.gain.setValueAtTime(filter.gain.value ?? 0, now);
        filter.gain.linearRampToValueAtTime(newGain, now + 0.03);
      } else if (typeof filter.gain.setValueAtTime === "function") {
        filter.gain.setValueAtTime(newGain, now);
      }
    }
  };

  const handleResetEq = () => {
    const defaultGains = [0, 0, 0, 0, 0];
    setBandGains(defaultGains);
    if (audioContextRef.current) {
      const now = audioContextRef.current.currentTime;
      eqFiltersRef.current.forEach((filter) => {
        if (filter && filter.gain) {
          if (typeof filter.gain.setTargetAtTime === "function") {
            filter.gain.setTargetAtTime(0, now, 0.015);
          } else if (typeof filter.gain.setValueAtTime === "function") {
            filter.gain.setValueAtTime(0, now);
          }
        }
      });
    }
  };

  // Play Sound Logic
  const startPlaying = useCallback(() => {
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
  }, [preset, initAudio, stopPlayingNodes]);

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
    if (masterGainRef.current && masterGainRef.current.gain) {
      if (typeof masterGainRef.current.gain.setValueAtTime === "function") {
        masterGainRef.current.gain.setValueAtTime(
          muted ? 0 : volume,
          audioContextRef.current ? audioContextRef.current.currentTime : 0,
        );
      }
    }
  }, [volume, muted]);

  useEffect(() => {
    return () => {
      stopPlayingNodes();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [stopPlayingNodes]);

  useEffect(() => {
    let animFrame: number;
    let interval: NodeJS.Timeout;

    const updateFrequencies = () => {
      if (!analyserRef.current || !isPlaying) return;
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(dataArray);

      const nextFrequencies = Array.from({ length: 12 }, (_, i) => {
        const val = dataArray[i * 2] || 0;
        return Math.max(5, Math.min(100, (val / 255) * 100));
      });
      setFrequencies(nextFrequencies);
    };

    if (isPlaying) {
      if (reducedMotion) {
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
      <div className="flex flex-col sm:flex-row items-center gap-4 bg-white/5 p-4 rounded-xl border border-white/5 mb-4">
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

      {/* 5-Band BiquadFilterNode Equalizer Controls */}
      <div className="bg-white/5 p-4 rounded-xl border border-white/5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-300">
            5-Band Acoustic Equalizer
          </span>
          <button
            onClick={handleResetEq}
            className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white transition-colors"
            title="Reset all EQ gains to 0 dB"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset EQ</span>
          </button>
        </div>

        <div className="grid grid-cols-5 gap-2 text-center">
          {EQ_BAND_LABELS.map((label, idx) => (
            <div key={label} className="flex flex-col items-center gap-1.5">
              <span className="text-[10px] font-mono text-zinc-400">
                {label}
              </span>
              <input
                type="range"
                min="-12"
                max="12"
                step="0.5"
                aria-label={`${label} Gain`}
                value={bandGains[idx]}
                onChange={(e) =>
                  handleBandGainChange(idx, parseFloat(e.target.value))
                }
                className="w-full h-1 bg-zinc-700 accent-indigo-500 rounded-lg cursor-pointer"
              />
              <span className="text-[9px] font-mono text-indigo-400">
                {bandGains[idx] > 0 ? `+${bandGains[idx]}` : bandGains[idx]} dB
              </span>
            </div>
          ))}
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
