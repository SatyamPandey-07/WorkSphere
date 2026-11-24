'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_SOUNDSCAPE_PRESET,
  loadSoundscapePresets,
  NoiseSoundscapeEngine,
  saveSoundscapePresets,
  type NoiseLayerType,
  type SoundscapePreset,
  type StorageLike,
} from '@/lib/audio/noiseSynthesizer';

export interface AmbientSoundGeneratorProps {
  storage?: StorageLike | null;
  initialPresets?: SoundscapePreset[];
}

export const AmbientSoundGenerator: React.FC<AmbientSoundGeneratorProps> = ({
  storage,
  initialPresets,
}) => {
  const presets = useMemo(
    () => initialPresets ?? loadSoundscapePresets(storage),
    [initialPresets, storage]
  );

  const activeInitial = presets[0] ?? DEFAULT_SOUNDSCAPE_PRESET;
  const engineRef = useRef<NoiseSoundscapeEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new NoiseSoundscapeEngine(null);
    engineRef.current.applyPreset(activeInitial);
  }

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [masterGain, setMasterGain] = useState(activeInitial.masterGain);
  const [layers, setLayers] = useState<Record<NoiseLayerType, number>>({
    ...activeInitial.layers,
  });

  useEffect(() => {
    const onVisibility = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) {
        void engineRef.current?.handleVisibilityChange(true);
        setIsPlaying(false);
      } else {
        void engineRef.current?.handleVisibilityChange(false);
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      void engineRef.current?.dispose();
    };
  }, []);

  const togglePlayback = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (isPlaying) {
      await engine.pause();
      setIsPlaying(false);
    } else {
      const started = await engine.start();
      setIsPlaying(started);
    }
  };

  const toggleMute = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const nextMuted = !isMuted;
    await engine.setMuted(nextMuted);
    setIsMuted(nextMuted);
    if (nextMuted) {
      setIsPlaying(false);
    }
  };

  const handleLayerChange = (layer: NoiseLayerType, value: number) => {
    const updated = engineRef.current?.setLayerGain(layer, value) ?? value;
    setLayers((prev) => ({ ...prev, [layer]: updated }));
  };

  const handleMasterChange = (value: number) => {
    const updated = engineRef.current?.setMasterGain(value) ?? value;
    setMasterGain(updated);
  };

  const handleSavePreset = () => {
    const customPreset: SoundscapePreset = {
      id: `custom-${Date.now()}`,
      name: 'Custom Nomad Mix',
      masterGain,
      layers,
    };
    saveSoundscapePresets([customPreset, ...presets], storage);
  };

  return (
    <section
      data-testid="ambient-sound-generator"
      aria-label="Ambient focus soundscape mixer"
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Focus Soundscape Mixer
          </h3>
          <p data-testid="soundscape-status" className="text-xs text-slate-500">
            Status: {isMuted ? 'Muted' : isPlaying ? 'Playing' : 'Paused'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="toggle-play-btn"
            onClick={() => void togglePlayback()}
            className="rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            data-testid="toggle-mute-btn"
            onClick={() => void toggleMute()}
            className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
          >
            {isMuted ? 'Unmute' : 'Mute'}
          </button>
          <button
            type="button"
            data-testid="save-preset-btn"
            onClick={handleSavePreset}
            className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            Save Preset
          </button>
        </div>
      </div>

      <div className="space-y-2.5">
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
          Master Volume ({Math.round(masterGain * 100)}%)
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={masterGain}
            data-testid="master-gain-slider"
            onChange={(e) => handleMasterChange(Number(e.target.value))}
            className="mt-1 w-full"
          />
        </label>

        {(['white', 'pink', 'rain'] as const).map((layer) => (
          <label
            key={layer}
            className="block text-xs font-medium capitalize text-slate-700 dark:text-slate-300"
          >
            {layer} Layer ({Math.round(layers[layer] * 100)}%)
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={layers[layer]}
              data-testid={`layer-slider-${layer}`}
              onChange={(e) => handleLayerChange(layer, Number(e.target.value))}
              className="mt-1 w-full"
            />
          </label>
        ))}
      </div>
    </section>
  );
};

export default AmbientSoundGenerator;
