'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import {
  DEFAULT_SOUNDSCAPE_PRESET,
  loadSoundscapePresets,
  NoiseSoundscapeEngine,
  saveSoundscapePresets,
  type NoiseLayerType,
  type SoundscapePreset,
  type StorageLike,
} from '@/lib/audio/noiseSynthesizer';
import {
  useSoundscapePreferences,
  type SoundLayer,
} from '@/hooks/useSoundscapePreferences';

export interface AmbientSoundGeneratorProps {
  storage?: StorageLike | null;
  initialPresets?: SoundscapePreset[];
  audioContext?: any;
  audioContextFactory?: () => any;
  storageKey?: string;
  className?: string;
}

export const AmbientSoundGenerator: React.FC<AmbientSoundGeneratorProps> = ({
  storage,
  initialPresets,
  audioContext,
  audioContextFactory,
  storageKey,
  className = '',
}) => {
  const { preferences, setLayerVolume } = useSoundscapePreferences(
    storageKey ? { storageKey } : undefined
  );

  const presets = useMemo(
    () => initialPresets ?? loadSoundscapePresets(storage),
    [initialPresets, storage]
  );

  const activeInitial = presets[0] ?? DEFAULT_SOUNDSCAPE_PRESET;
  const audioContextRef = useRef<any>(null);
  const engineRef = useRef<NoiseSoundscapeEngine | null>(null);

  // Track active layer gain nodes and registered event listeners to prevent memory leaks (#10119)
  const layerGainNodesRef = useRef<Map<string, any>>(new Map());
  const masterGainNodeRef = useRef<any>(null);
  const listenersRef = useRef<Set<() => void>>(new Set());

  // Defensive, idempotent GainNode disconnection
  const safelyDisconnectNode = (node: any) => {
    if (!node) return;
    try {
      if (typeof node.disconnect === 'function') {
        node.disconnect();
      }
    } catch {
      // Node may already be disconnected or in invalid state
    }
  };

  // Disconnect and release an individual layer's GainNode
  const cleanupLayerGainNode = (layerKey: string) => {
    const existing = layerGainNodesRef.current.get(layerKey);
    if (existing) {
      safelyDisconnectNode(existing);
      layerGainNodesRef.current.delete(layerKey);
    }
  };

  // Disconnect and release all GainNodes owned by the component
  const cleanupAllGainNodes = () => {
    layerGainNodesRef.current.forEach((node) => {
      safelyDisconnectNode(node);
    });
    layerGainNodesRef.current.clear();

    if (masterGainNodeRef.current) {
      safelyDisconnectNode(masterGainNodeRef.current);
      masterGainNodeRef.current = null;
    }
  };

  if (!engineRef.current) {
    let ctx: any = null;
    if (audioContext !== undefined) {
      ctx = audioContext;
    } else if (audioContextFactory) {
      ctx = audioContextFactory();
    } else if (typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        try {
          ctx = new AudioCtx();
        } catch {
          ctx = null;
        }
      }
    }
    audioContextRef.current = ctx;

    // Track master gain node if audio context supports createGain
    if (ctx && typeof ctx.createGain === 'function') {
      try {
        const masterNode = ctx.createGain();
        masterGainNodeRef.current = masterNode;
      } catch {
        // Safe fallback
      }
    }

    engineRef.current = new NoiseSoundscapeEngine(ctx);
    engineRef.current.applyPreset(activeInitial);
  }

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [masterGain, setMasterGain] = useState(activeInitial.masterGain);

  // Sync initial sound layers from persistent preferences
  const [layers, setLayers] = useState<Record<NoiseLayerType, number>>(() => ({
    ...activeInitial.layers,
    rain: preferences.rain !== undefined ? preferences.rain / 100 : activeInitial.layers.rain,
  }));

  // Update audio engine when preferences change
  useEffect(() => {
    if (preferences.rain !== undefined) {
      const normalizedRain = preferences.rain / 100;
      setLayers((prev) => {
        if (prev.rain === normalizedRain) return prev;
        return { ...prev, rain: normalizedRain };
      });
      if (normalizedRain <= 0) {
        cleanupLayerGainNode('rain');
      }
      engineRef.current?.setLayerGain('rain', normalizedRain);
    }
  }, [preferences.rain]);

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
      listenersRef.current.add(onVisibility);
    }

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
        listenersRef.current.delete(onVisibility);
      }
      // Detach any remaining registered listeners
      listenersRef.current.forEach((listener) => {
        if (typeof document !== 'undefined') {
          try {
            document.removeEventListener('visibilitychange', listener);
          } catch {
            // Ignore
          }
        }
      });
      listenersRef.current.clear();

      // Disconnect and release all GainNodes on unmount
      cleanupAllGainNodes();

      void engineRef.current?.dispose();
      engineRef.current = null;
      audioContextRef.current = null;
    };
  }, []);

  const togglePlayback = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (isPlaying) {
      await engine.pause();
      setIsPlaying(false);
    } else {
      const ctx = audioContextRef.current;
      if (ctx && typeof ctx.resume === 'function' && ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          // Autoplay policy or user gesture required
        }
      }
      const started = await engine.start();
      setIsPlaying(started);
    }
  };

  const toggleMute = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const nextMuted = !isMuted;
    if (nextMuted) {
      engine.setMasterGain(0, 0.05);
      await engine.setMuted(true);
      setIsMuted(true);
      if (isPlaying) {
        setIsPlaying(false);
      }
    } else {
      await engine.setMuted(false);
      engine.setMasterGain(masterGain, 0.05);
      setIsMuted(false);
    }
  };

  const handleLayerChange = (layer: NoiseLayerType, value: number) => {
    if (value <= 0) {
      cleanupLayerGainNode(layer);
    }
    const updated = engineRef.current?.setLayerGain(layer, value) ?? value;
    setLayers((prev) => ({ ...prev, [layer]: updated }));
    if (layer === 'rain') {
      setLayerVolume('rain', Math.round(updated * 100));
    }
  };

  const handleSoundscapeLayerChange = (layer: SoundLayer, value: number) => {
    if (value <= 0) {
      cleanupLayerGainNode(layer);
    }
    setLayerVolume(layer, value);
    if (layer === 'rain') {
      const normalized = value / 100;
      engineRef.current?.setLayerGain('rain', normalized);
      setLayers((prev) => ({ ...prev, rain: normalized }));
    }
  };

  const handleMasterChange = (value: number) => {
    setMasterGain(value);
    if (!isMuted) {
      engineRef.current?.setMasterGain(value, 0.05);
    }
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
      className={`space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}
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
            aria-label={isMuted ? 'Unmute sound' : 'Mute sound'}
            aria-pressed={isMuted}
            title={isMuted ? 'Unmute master soundscape' : 'Mute master soundscape'}
            className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {isMuted ? (
              <>
                <VolumeX className="h-3.5 w-3.5 text-red-500" aria-hidden="true" />
                <span>Unmute</span>
              </>
            ) : (
              <>
                <Volume2 className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
                <span>Mute</span>
              </>
            )}
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

        {/* Dedicated ambient soundscape layer controls for issue #10110 */}
        <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Ambient Soundscape Volumes
          </h4>
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Brown Noise ({preferences.brown}%)
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={preferences.brown}
                data-testid="soundscape-slider-brown"
                aria-label="Brown noise volume"
                onChange={(e) => handleSoundscapeLayerChange('brown', Number(e.target.value))}
                className="mt-1 w-full"
              />
            </label>

            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Cafe Chatter ({preferences.cafe}%)
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={preferences.cafe}
                data-testid="soundscape-slider-cafe"
                aria-label="Cafe chatter volume"
                onChange={(e) => handleSoundscapeLayerChange('cafe', Number(e.target.value))}
                className="mt-1 w-full"
              />
            </label>

            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Rainfall ({preferences.rain}%)
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={preferences.rain}
                data-testid="soundscape-slider-rain"
                aria-label="Rainfall volume"
                onChange={(e) => handleSoundscapeLayerChange('rain', Number(e.target.value))}
                className="mt-1 w-full"
              />
            </label>
          </div>
        </div>
      </div>
    </section>
  );
};

export default AmbientSoundGenerator;
