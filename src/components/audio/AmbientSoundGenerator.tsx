'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  clampVolume,
  NoiseSynthesizer,
  normalizeLayerLevels,
  type AmbientSoundType,
  type LayerMixLevels,
} from '@/lib/audio/noiseSynthesizer';

export const AMBIENT_PRESET_STORAGE_KEY = 'worksphere:ambient_soundscape:v1';

export interface SavedAmbientPreset {
  soundType: AmbientSoundType;
  volume: number;
  layerLevels: LayerMixLevels;
  cutoffFrequency?: number;
}

export interface AmbientSoundGeneratorProps {
  initialSound?: AmbientSoundType;
  initialVolume?: number;
  initialCutoff?: number;
  storageKey?: string;
  className?: string;
}

const SOUND_OPTIONS: { id: AmbientSoundType; label: string; hint: string }[] = [
  { id: 'white', label: 'White Noise', hint: 'Balanced masking for chatter' },
  { id: 'pink', label: 'Pink Noise', hint: 'Softer deep-focus warmth' },
  { id: 'brown', label: 'Brown Noise', hint: 'Deep low-frequency rumble' },
  { id: 'rain', label: 'Rain Sound', hint: 'Gentle steady rainfall' },
];

export function loadSavedAmbientPreset(
  fallbackSound: AmbientSoundType,
  fallbackVolume: number,
  storageKey = AMBIENT_PRESET_STORAGE_KEY
): SavedAmbientPreset {
  const safeVol = clampVolume(fallbackVolume);
  const defaultLevels = normalizeLayerLevels(undefined, fallbackSound);

  if (typeof window === 'undefined') {
    return { soundType: fallbackSound, volume: safeVol, layerLevels: defaultLevels, cutoffFrequency: 12000 };
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return { soundType: fallbackSound, volume: safeVol, layerLevels: defaultLevels, cutoffFrequency: 12000 };
    }
    const parsed = JSON.parse(raw) as Partial<SavedAmbientPreset>;
    const soundType: AmbientSoundType =
      parsed.soundType === 'white' ||
      parsed.soundType === 'pink' ||
      parsed.soundType === 'brown' ||
      parsed.soundType === 'rain'
        ? parsed.soundType
        : fallbackSound;
    const volume = clampVolume(parsed.volume ?? safeVol);
    const layerLevels = normalizeLayerLevels(parsed.layerLevels, soundType);
    const cutoffFrequency =
      typeof parsed.cutoffFrequency === 'number' && Number.isFinite(parsed.cutoffFrequency)
        ? Math.max(200, Math.min(20000, parsed.cutoffFrequency))
        : 12000;
    return { soundType, volume, layerLevels, cutoffFrequency };
  } catch {
    return { soundType: fallbackSound, volume: safeVol, layerLevels: defaultLevels, cutoffFrequency: 12000 };
  }
}

export function saveAmbientPreset(
  preset: SavedAmbientPreset,
  storageKey = AMBIENT_PRESET_STORAGE_KEY
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(preset));
  } catch {
    // Ignore storage quota or private-browsing errors
  }
}

export const AmbientSoundGenerator: React.FC<AmbientSoundGeneratorProps> = ({
  initialSound = 'pink',
  initialVolume = 0.5,
  initialCutoff = 12000,
  storageKey = AMBIENT_PRESET_STORAGE_KEY,
  className = '',
}) => {
  const initialPreset = loadSavedAmbientPreset(
    initialSound,
    initialVolume,
    storageKey
  );

  const [soundType, setSoundType] = useState<AmbientSoundType>(
    initialPreset.soundType
  );
  const [volume, setVolume] = useState<number>(initialPreset.volume);
  const [cutoffFrequency, setCutoffFrequency] = useState<number>(
    initialPreset.cutoffFrequency ?? initialCutoff
  );
  const [layerLevels, setLayerLevels] = useState<LayerMixLevels>(
    initialPreset.layerLevels
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const synthRef = useRef<NoiseSynthesizer | null>(null);
  if (!synthRef.current) {
    synthRef.current = new NoiseSynthesizer({
      soundType: initialPreset.soundType,
      volume: initialPreset.volume,
      cutoffFrequency: initialPreset.cutoffFrequency ?? initialCutoff,
      layerLevels: initialPreset.layerLevels,
      muted: false,
    });
  }

  useEffect(() => {
    const synth = synthRef.current;
    return () => {
      void synth?.dispose();
    };
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        synthRef.current?.pause();
        setIsPlaying(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const persistCurrent = (
    nextSound: AmbientSoundType,
    nextVol: number,
    nextLayers: LayerMixLevels,
    nextCutoff: number
  ) => {
    saveAmbientPreset(
      { soundType: nextSound, volume: nextVol, layerLevels: nextLayers, cutoffFrequency: nextCutoff },
      storageKey
    );
  };

  const handleSelectSound = (nextType: AmbientSoundType) => {
    const nextLayers: LayerMixLevels = {
      white: nextType === 'white' ? Math.max(0.7, layerLevels.white) : 0,
      pink: nextType === 'pink' ? Math.max(0.7, layerLevels.pink) : 0,
      brown: nextType === 'brown' ? Math.max(0.7, layerLevels.brown) : 0,
      rain: nextType === 'rain' ? Math.max(0.7, layerLevels.rain) : 0,
    };
    setSoundType(nextType);
    setLayerLevels(nextLayers);
    synthRef.current?.setSoundType(nextType);
    persistCurrent(nextType, volume, nextLayers, cutoffFrequency);
  };

  const handleLayerChange = (type: AmbientSoundType, nextVal: number) => {
    const clamped = clampVolume(nextVal);
    const nextLayers = { ...layerLevels, [type]: clamped };
    setLayerLevels(nextLayers);
    synthRef.current?.setLayerLevel(type, clamped);
    persistCurrent(soundType, volume, nextLayers, cutoffFrequency);
  };

  const handleTogglePlay = async () => {
    const synth = synthRef.current;
    if (!synth) return;
    if (isMuted) {
      setIsMuted(false);
      synth.setMuted(false);
    }
    const playing = await synth.togglePlay();
    setIsPlaying(playing);
  };

  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    synthRef.current?.setMuted(nextMuted);
    if (nextMuted) {
      setIsPlaying(false);
    }
  };

  const handleVolumeChange = (nextVal: number) => {
    const clamped = clampVolume(nextVal);
    setVolume(clamped);
    synthRef.current?.setVolume(clamped);
    persistCurrent(soundType, clamped, layerLevels, cutoffFrequency);
  };

  const handleCutoffChange = (nextCutoff: number) => {
    const clamped = Math.max(200, Math.min(20000, nextCutoff));
    setCutoffFrequency(clamped);
    synthRef.current?.setCutoffFrequency(clamped);
    persistCurrent(soundType, volume, layerLevels, clamped);
  };

  return (
    <section
      aria-label="Ambient cafe sound generator"
      data-testid="ambient-sound-generator"
      className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-800 dark:bg-slate-900 ${className}`.trim()}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 sm:text-base dark:text-slate-100">
            Focus Soundscape Mixer
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Synthesized in-browser with zero external audio files
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleMute}
            aria-pressed={isMuted}
            aria-label={isMuted ? 'Unmute sound' : 'Mute sound'}
            data-testid="ambient-mute-btn"
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {isMuted ? 'Muted' : 'Mute'}
          </button>

          <button
            type="button"
            onClick={() => void handleTogglePlay()}
            aria-pressed={isPlaying}
            data-testid="ambient-play-toggle-btn"
            className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-indigo-700"
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
        </div>
      </div>

      <div
        role="group"
        aria-label="Noise type"
        className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-4"
      >
        {SOUND_OPTIONS.map((opt) => {
          const active = soundType === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              aria-pressed={active}
              data-testid={`sound-option-${opt.id}`}
              onClick={() => handleSelectSound(opt.id)}
              className={`rounded-xl border px-3 py-2 text-left transition ${
                active
                  ? 'border-indigo-600 bg-indigo-50/80 text-indigo-950 dark:border-indigo-500 dark:bg-indigo-950/60 dark:text-indigo-100'
                  : 'border-slate-200 bg-slate-50/50 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300'
              }`}
            >
              <div className="text-xs font-semibold">{opt.label}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {opt.hint}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 space-y-2.5">
        <div className="flex items-center gap-3">
          <label
            htmlFor="ambient-volume-slider"
            className="w-20 text-xs font-medium text-slate-600 dark:text-slate-300"
          >
            Master
          </label>
          <input
            id="ambient-volume-slider"
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            data-testid="ambient-volume-slider"
            onChange={(e) => handleVolumeChange(Number(e.target.value) / 100)}
            className="h-2 w-full cursor-pointer accent-indigo-600"
          />
          <span
            data-testid="ambient-volume-value"
            className="w-10 text-right text-xs font-semibold text-slate-700 dark:text-slate-200"
          >
            {Math.round(volume * 100)}%
          </span>
        </div>

        <div className="flex items-center gap-3">
          <label
            htmlFor="ambient-cutoff-slider"
            className="w-20 text-xs font-medium text-slate-600 dark:text-slate-300"
          >
            Cutoff
          </label>
          <input
            id="ambient-cutoff-slider"
            type="range"
            min={200}
            max={20000}
            step={100}
            value={cutoffFrequency}
            data-testid="ambient-cutoff-slider"
            onChange={(e) => handleCutoffChange(Number(e.target.value))}
            className="h-2 w-full cursor-pointer accent-indigo-600"
          />
          <span
            data-testid="ambient-cutoff-value"
            className="w-10 text-right text-xs font-semibold text-slate-700 dark:text-slate-200"
          >
            {cutoffFrequency >= 1000 ? `${(cutoffFrequency / 1000).toFixed(1)}k` : `${cutoffFrequency}`}Hz
          </span>
        </div>

        {(['white', 'pink', 'brown', 'rain'] as const).map((layerKey) => (
          <div key={layerKey} className="flex items-center gap-3">
            <label
              htmlFor={`layer-slider-${layerKey}`}
              className="w-20 text-xs capitalize text-slate-500 dark:text-slate-400"
            >
              {layerKey}
            </label>
            <input
              id={`layer-slider-${layerKey}`}
              type="range"
              min={0}
              max={100}
              value={Math.round(layerLevels[layerKey] * 100)}
              data-testid={`layer-slider-${layerKey}`}
              onChange={(e) =>
                handleLayerChange(layerKey, Number(e.target.value) / 100)
              }
              className="h-1.5 w-full cursor-pointer accent-indigo-500"
            />
            <span className="w-10 text-right text-[11px] text-slate-500 dark:text-slate-400">
              {Math.round(layerLevels[layerKey] * 100)}%
            </span>
          </div>
        ))}
      </div>
    </section>
  );
};

export default AmbientSoundGenerator;
