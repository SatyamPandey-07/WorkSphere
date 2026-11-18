import React from 'react';
import { useMapLayers, type MapLayersState } from '../../hooks/useMapLayers';

/**
 * High-visibility two-tone keyboard focus indicator (#7724): a blue ring separated from
 * the control by a dark offset, so it stays visible on light, dark and satellite maps.
 */
export const MAP_LAYER_FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900';

const LAYER_OPTIONS: ReadonlyArray<{ key: keyof MapLayersState; label: string }> = [
  { key: 'seatingHeatmap', label: 'Seating Occupancy Heatmap' },
  { key: 'noiseContours', label: 'Ambient Noise Contours' },
  { key: 'powerOutlets', label: 'Power Outlet Availability Pins' },
];

export const MapLayerControl: React.FC = () => {
  const { layers, toggleLayer } = useMapLayers();

  return (
    <div className="absolute top-4 right-4 z-50 bg-slate-900/90 backdrop-blur-md text-white p-4 rounded-xl shadow-2xl border border-slate-800 w-72">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
        <h3 className="text-sm font-semibold tracking-wide text-slate-200">Map Layers</h3>
        <span className="text-xs text-emerald-400 font-mono">Live</span>
      </div>

      <div role="group" aria-label="Map layers" className="space-y-1">
        {LAYER_OPTIONS.map(({ key, label }) => {
          const pressed = layers[key];
          return (
            <button
              key={key}
              type="button"
              aria-pressed={pressed}
              onClick={() => toggleLayer(key)}
              className={`group flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left cursor-pointer ${MAP_LAYER_FOCUS_RING}`}
            >
              <span className="text-sm text-slate-300 group-hover:text-white transition">
                {label}
              </span>
              <span
                aria-hidden="true"
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
                  pressed ? 'bg-emerald-500 border-emerald-400' : 'bg-slate-800 border-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                    pressed ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default MapLayerControl;
