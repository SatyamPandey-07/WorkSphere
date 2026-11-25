"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Volume2,
  VolumeX,
  Play,
  Pause,
  CloudRain,
  Coffee,
  Waves,
  RotateCcw,
  Sliders,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import {
  AmbientMixerEngine,
  AMBIENT_LAYERS,
  type AmbientLayerId,
} from "@/core/audio/AmbientMixerEngine";

export const AMBIENT_STORAGE_KEY = "worksphere_ambient_soundscape_v1";

export interface AmbientPreferences {
  version: 1;
  layers: {
    [key in AmbientLayerId]?: {
      enabled: boolean;
      volume: number; // 0 - 100
    };
  };
  masterMuted: boolean;
  masterVolume: number; // 0 - 100
}

const DEFAULT_PREFERENCES: AmbientPreferences = {
  version: 1,
  layers: {
    rain: { enabled: false, volume: 65 },
    coffee_shop: { enabled: false, volume: 60 },
    pink_noise: { enabled: false, volume: 50 },
  },
  masterMuted: false,
  masterVolume: 80,
};

/**
 * Validates and sanitizes stored preferences, falling back to defaults for any invalid fields.
 */
export function validatePreferences(raw: unknown): AmbientPreferences {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_PREFERENCES;
  }

  const candidate = raw as Partial<AmbientPreferences>;
  const layers: AmbientPreferences["layers"] = {};

  for (const layerConfig of AMBIENT_LAYERS) {
    const rawLayer = candidate.layers?.[layerConfig.id];
    const isEnabled = typeof rawLayer?.enabled === "boolean" ? rawLayer.enabled : false;
    let vol = typeof rawLayer?.volume === "number" ? rawLayer.volume : layerConfig.defaultVolume;
    if (isNaN(vol)) vol = layerConfig.defaultVolume;
    vol = Math.max(0, Math.min(100, Math.round(vol)));

    layers[layerConfig.id] = {
      enabled: isEnabled,
      volume: vol,
    };
  }

  let masterVol = typeof candidate.masterVolume === "number" ? candidate.masterVolume : 80;
  if (isNaN(masterVol)) masterVol = 80;
  masterVol = Math.max(0, Math.min(100, Math.round(masterVol)));

  return {
    version: 1,
    layers,
    masterMuted: typeof candidate.masterMuted === "boolean" ? candidate.masterMuted : false,
    masterVolume: masterVol,
  };
}

export function loadSavedPreferences(): AmbientPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const stored = window.localStorage.getItem(AMBIENT_STORAGE_KEY);
    if (!stored) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(stored);
    return validatePreferences(parsed);
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(prefs: AmbientPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AMBIENT_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Gracefully handle storage quota or privacy mode errors
  }
}

export interface AmbientSoundscapeGeneratorProps {
  className?: string;
}

export function AmbientSoundscapeGenerator({ className = "" }: AmbientSoundscapeGeneratorProps) {
  const engineRef = useRef<AmbientMixerEngine | null>(null);

  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [preferences, setPreferences] = useState<AmbientPreferences>(DEFAULT_PREFERENCES);
  const [activeLayers, setActiveLayers] = useState<Record<AmbientLayerId, boolean>>({
    rain: false,
    coffee_shop: false,
    pink_noise: false,
  });
  const [hasInteracted, setHasInteracted] = useState<boolean>(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(false);

  // Lazy instantiate audio engine
  const getEngine = useCallback(() => {
    if (!engineRef.current) {
      engineRef.current = new AmbientMixerEngine();
    }
    return engineRef.current;
  }, []);

  // Check Web Audio API support and motion preference on mount
  useEffect(() => {
    const supported = AmbientMixerEngine.isSupported();
    setIsSupported(supported);

    if (typeof window !== "undefined") {
      const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      setPrefersReducedMotion(motionQuery.matches);

      const handleMotionChange = (e: MediaQueryListEvent) => {
        setPrefersReducedMotion(e.matches);
      };
      if (typeof motionQuery.addEventListener === "function") {
        motionQuery.addEventListener("change", handleMotionChange);
      } else if (typeof motionQuery.addListener === "function") {
        motionQuery.addListener(handleMotionChange);
      }

      // Restore saved preferences WITHOUT autoplay
      const saved = loadSavedPreferences();
      setPreferences(saved);

      // Pre-seed engine volumes with saved preferences
      if (supported) {
        const engine = getEngine();
        engine.setMasterMuted(saved.masterMuted);
        engine.setMasterVolume(saved.masterVolume);
        for (const layer of AMBIENT_LAYERS) {
          const layerPref = saved.layers[layer.id];
          if (layerPref) {
            engine.setLayerVolume(layer.id, layerPref.volume);
          }
        }
      }

      return () => {
        if (typeof motionQuery.removeEventListener === "function") {
          motionQuery.removeEventListener("change", handleMotionChange);
        } else if (typeof motionQuery.removeListener === "function") {
          motionQuery.removeListener(handleMotionChange);
        }
      };
    }
  }, [getEngine]);

  // Teardown engine on unmount
  useEffect(() => {
    return () => {
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }
    };
  }, []);

  // Sync preference updates to localStorage
  const updatePreferences = useCallback((updater: (prev: AmbientPreferences) => AmbientPreferences) => {
    setPreferences((prev) => {
      const next = updater(prev);
      savePreferences(next);
      return next;
    });
  }, []);

  // Handle Layer Toggle (Play / Pause)
  const handleToggleLayer = async (layerId: AmbientLayerId) => {
    const engine = getEngine();
    setHasInteracted(true);

    const isCurrentlyActive = !!activeLayers[layerId];
    if (isCurrentlyActive) {
      engine.stopLayer(layerId);
      setActiveLayers((prev) => ({ ...prev, [layerId]: false }));
      updatePreferences((prev) => ({
        ...prev,
        layers: {
          ...prev.layers,
          [layerId]: {
            enabled: false,
            volume: prev.layers[layerId]?.volume ?? 60,
          },
        },
      }));
    } else {
      const currentVol = preferences.layers[layerId]?.volume ?? 60;
      engine.setLayerVolume(layerId, currentVol);
      await engine.startLayer(layerId);
      setActiveLayers((prev) => ({ ...prev, [layerId]: true }));
      updatePreferences((prev) => ({
        ...prev,
        layers: {
          ...prev.layers,
          [layerId]: {
            enabled: true,
            volume: currentVol,
          },
        },
      }));
    }
  };

  // Handle Layer Volume change
  const handleLayerVolumeChange = (layerId: AmbientLayerId, newVolume: number) => {
    const clamped = Math.max(0, Math.min(100, isNaN(newVolume) ? 0 : newVolume));
    const engine = getEngine();
    engine.setLayerVolume(layerId, clamped);

    updatePreferences((prev) => ({
      ...prev,
      layers: {
        ...prev.layers,
        [layerId]: {
          enabled: prev.layers[layerId]?.enabled ?? false,
          volume: clamped,
        },
      },
    }));
  };

  // Handle Master Mute Toggle
  const handleToggleMasterMute = () => {
    setHasInteracted(true);
    const engine = getEngine();
    const nextMuted = !preferences.masterMuted;
    engine.setMasterMuted(nextMuted);

    updatePreferences((prev) => ({
      ...prev,
      masterMuted: nextMuted,
    }));
  };

  // Handle Master Volume change
  const handleMasterVolumeChange = (newVolume: number) => {
    const clamped = Math.max(0, Math.min(100, isNaN(newVolume) ? 0 : newVolume));
    const engine = getEngine();
    engine.setMasterVolume(clamped);

    updatePreferences((prev) => ({
      ...prev,
      masterVolume: clamped,
    }));
  };

  // Stop all active layers
  const handleStopAll = () => {
    const engine = getEngine();
    engine.stopAll();
    setActiveLayers({
      rain: false,
      coffee_shop: false,
      pink_noise: false,
    });
    updatePreferences((prev) => ({
      ...prev,
      layers: {
        rain: { ...prev.layers.rain, enabled: false, volume: prev.layers.rain?.volume ?? 65 },
        coffee_shop: { ...prev.layers.coffee_shop, enabled: false, volume: prev.layers.coffee_shop?.volume ?? 60 },
        pink_noise: { ...prev.layers.pink_noise, enabled: false, volume: prev.layers.pink_noise?.volume ?? 50 },
      },
    }));
  };

  const anyLayerActive = Object.values(activeLayers).some(Boolean);

  const getLayerIcon = (id: AmbientLayerId) => {
    switch (id) {
      case "rain":
        return <CloudRain className="w-5 h-5 text-sky-400" aria-hidden="true" />;
      case "coffee_shop":
        return <Coffee className="w-5 h-5 text-amber-400" aria-hidden="true" />;
      case "pink_noise":
        return <Waves className="w-5 h-5 text-rose-400" aria-hidden="true" />;
    }
  };

  return (
    <section
      role="region"
      aria-label="Ambient Soundscape Generator"
      className={`rounded-2xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl backdrop-blur-md transition-all ${className}`}
    >
      {/* Header and Master Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-400" aria-hidden="true" />
            <h2 className="text-xl font-bold tracking-tight text-white">
              Ambient Soundscape Generator
            </h2>
          </div>
          <p className="mt-1 text-xs sm:text-sm text-slate-400">
            Procedurally layered binaural noise generator for deep work, relaxation, and focus.
          </p>
        </div>

        {/* Master Toolbar */}
        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
          {/* Master Mute Toggle */}
          <button
            type="button"
            onClick={handleToggleMasterMute}
            aria-pressed={preferences.masterMuted}
            aria-label={preferences.masterMuted ? "Unmute all soundscapes" : "Mute all soundscapes"}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
              preferences.masterMuted
                ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30"
                : anyLayerActive
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 hover:bg-indigo-500"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
            }`}
          >
            {preferences.masterMuted ? (
              <>
                <VolumeX className="w-4 h-4" aria-hidden="true" />
                <span>Muted</span>
              </>
            ) : (
              <>
                <Volume2 className="w-4 h-4" aria-hidden="true" />
                <span>Master Sound</span>
              </>
            )}
          </button>

          {/* Stop All button */}
          <button
            type="button"
            onClick={handleStopAll}
            disabled={!anyLayerActive}
            aria-label="Stop all sound layers"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-slate-200 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        </div>
      </div>

      {/* Unsupported Audio Notice */}
      {!isSupported && (
        <div
          role="alert"
          className="mt-4 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200 text-sm"
        >
          <AlertCircle className="w-5 h-5 flex-shrink-0 text-amber-400" aria-hidden="true" />
          <span>
            The Web Audio API is not supported or is disabled in your current browser environment.
            Ambient sound synthesis is unavailable.
          </span>
        </div>
      )}

      {/* Autoplay Notice before first interaction */}
      {isSupported && !hasInteracted && !anyLayerActive && (
        <div className="mt-4 flex items-center justify-between rounded-xl bg-indigo-950/40 border border-indigo-900/50 p-3.5 text-xs text-indigo-300">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-indigo-400" aria-hidden="true" />
            <span>Click any layer to activate sound synthesis. Your mix preferences are saved automatically.</span>
          </div>
        </div>
      )}

      {/* Master Volume Slider */}
      <div className="mt-5 flex items-center gap-4 bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/60">
        <label
          htmlFor="ambient-master-volume"
          className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 min-w-[100px]"
        >
          <Volume2 className="w-4 h-4 text-slate-400" aria-hidden="true" />
          Master Vol
        </label>
        <input
          id="ambient-master-volume"
          type="range"
          min="0"
          max="100"
          step="1"
          value={preferences.masterVolume}
          onChange={(e) => handleMasterVolumeChange(Number(e.target.value))}
          aria-label="Master volume slider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={preferences.masterVolume}
          aria-valuetext={`${preferences.masterVolume}% master volume`}
          className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <span className="text-xs font-mono font-medium text-slate-300 w-10 text-right">
          {preferences.masterVolume}%
        </span>
      </div>

      {/* Sound Layer Cards Grid */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-5">
        {AMBIENT_LAYERS.map((layer) => {
          const isActive = !!activeLayers[layer.id];
          const volume = preferences.layers[layer.id]?.volume ?? layer.defaultVolume;

          return (
            <div
              key={layer.id}
              className={`flex flex-col justify-between rounded-xl p-5 border transition-all duration-200 ${
                isActive
                  ? "bg-slate-800/80 border-indigo-500/50 shadow-lg shadow-indigo-950/40 ring-1 ring-indigo-500/20"
                  : "bg-slate-800/30 border-slate-800/80 hover:border-slate-700 hover:bg-slate-800/40"
              }`}
            >
              {/* Card Header */}
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`p-2 rounded-lg border ${
                        isActive
                          ? "bg-indigo-950/60 border-indigo-500/40"
                          : "bg-slate-800 border-slate-700/60"
                      }`}
                    >
                      {getLayerIcon(layer.id)}
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        {layer.name}
                        {isActive && (
                          <span className="flex h-2 w-2 relative">
                            {!prefersReducedMotion && (
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                            )}
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
                          </span>
                        )}
                      </h3>
                      <span className="text-[11px] font-medium text-slate-400">
                        {isActive ? (preferences.masterMuted ? "Muted by Master" : "Playing") : "Inactive"}
                      </span>
                    </div>
                  </div>

                  {/* Play/Stop Toggle */}
                  <button
                    type="button"
                    onClick={() => handleToggleLayer(layer.id)}
                    disabled={!isSupported}
                    aria-pressed={isActive}
                    aria-label={`${isActive ? "Disable" : "Enable"} ${layer.name}`}
                    className={`p-2.5 rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                      isActive
                        ? "bg-indigo-600 text-white hover:bg-indigo-500 shadow-md shadow-indigo-600/30"
                        : "bg-slate-700/60 text-slate-300 hover:bg-slate-700 hover:text-white"
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    {isActive ? (
                      <Pause className="w-4 h-4 fill-current" aria-hidden="true" />
                    ) : (
                      <Play className="w-4 h-4 fill-current ml-0.5" aria-hidden="true" />
                    )}
                  </button>
                </div>

                <p className="mt-3 text-xs text-slate-400 leading-relaxed min-h-[36px]">
                  {layer.description}
                </p>
              </div>

              {/* Volume Slider Section */}
              <div className="mt-6 pt-4 border-t border-slate-700/40">
                <div className="flex items-center justify-between mb-2">
                  <label
                    htmlFor={`volume-slider-${layer.id}`}
                    className="text-xs font-semibold text-slate-300"
                  >
                    Layer Gain
                  </label>
                  <span className="text-xs font-mono font-medium text-slate-400">
                    {volume}%
                  </span>
                </div>
                <input
                  id={`volume-slider-${layer.id}`}
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={volume}
                  onChange={(e) => handleLayerVolumeChange(layer.id, Number(e.target.value))}
                  aria-label={`${layer.name} volume slider`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={volume}
                  aria-valuetext={`${layer.name} volume ${volume}%`}
                  disabled={!isSupported}
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-40"
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default AmbientSoundscapeGenerator;
