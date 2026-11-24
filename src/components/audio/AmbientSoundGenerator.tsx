'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  clampVolume,
  NoiseSynthesizer,
  type AmbientSoundType,
} from '@/lib/audio/noiseSynthesizer';

export interface AmbientSoundGeneratorProps {
  initialSound?: AmbientSoundType;
  initialVolume?: number;
  className?: string;
}

const SOUND_OPTIONS: { id: AmbientSoundType; label: string; hint: string }[] = [
  { id: 'white', label: 'White Noise', hint: 'Balanced masking for chatter' },
  { id: 'pink', label: 'Pink Noise', hint: 'Softer deep-focus warmth' },
  { id: 'rain', label: 'Rain Sound', hint: 'Gentle steady rainfall' },
];

export const AmbientSoundGenerator: React.FC<AmbientSoundGeneratorProps> = ({
  initialSound = 'pink',
  initialVolume = 0.5,
  className = '',
}) => {
  const [soundType, setSoundType] = useState<AmbientSoundType>(initialSound);
  const [volume, setVolume] = useState<number>(() => clampVolume(initialVolume));
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const synthRef = useRef<NoiseSynthesizer | null>(null);
  if (!synthRef.current) {
    synthRef.current = new NoiseSynthesizer({
      soundType: initialSound,
      volume: clampVolume(initialVolume),
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

  const handleSelectSound = (nextType: AmbientSoundType) => {
    setSoundType(nextType);
    synthRef.current?.setSoundType(nextType);
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
            Focus Soundscape
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
        className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3"
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

      <div className="mt-4 flex items-center gap-3">
        <label
          htmlFor="ambient-volume-slider"
          className="text-xs font-medium text-slate-600 dark:text-slate-300"
        >
          Volume
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
    </section>
  );
};

export default AmbientSoundGenerator;
