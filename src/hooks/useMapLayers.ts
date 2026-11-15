import { useState, useEffect } from 'react';

export interface MapLayersState {
  seatingHeatmap: boolean;
  noiseContours: boolean;
  powerOutlets: boolean;
}

const STORAGE_KEY = 'map_layer_preferences_v1';

const DEFAULT_LAYERS: MapLayersState = {
  seatingHeatmap: true,
  noiseContours: false,
  powerOutlets: true,
};

export function useMapLayers() {
  const [layers, setLayers] = useState<MapLayersState>(() => {
    if (typeof window === 'undefined') return DEFAULT_LAYERS;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to load map layer preferences from localStorage', e);
    }
    return DEFAULT_LAYERS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layers));
    } catch (e) {
      console.error('Failed to save map layer preferences to localStorage', e);
    }
  }, [layers]);

  const toggleLayer = (layerKey: keyof MapLayersState) => {
    setLayers((prev) => ({
      ...prev,
      [layerKey]: !prev[layerKey],
    }));
  };

  return {
    layers,
    toggleLayer,
  };
}