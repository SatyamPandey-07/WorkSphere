import React from 'react';
import { useMapLayers } from '../../hooks/useMapLayers';

export const MapLayerControl: React.FC = () => {
  const { layers, toggleLayer } = useMapLayers();

  return (
    <div className="absolute top-4 right-4 z-50 bg-slate-900/90 backdrop-blur-md text-white p-4 rounded-xl shadow-2xl border border-slate-800 w-72">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
        <h3 className="text-sm font-semibold tracking-wide text-slate-200">Map Layers</h3>
        <span className="text-xs text-emerald-400 font-mono">Live</span>
      </div>

      <div className="space-y-3">
        <label className="flex items-center justify-between cursor-pointer group">
          <span className="text-sm text-slate-300 group-hover:text-white transition">
            Seating Occupancy Heatmap
          </span>
          <input
            type="checkbox"
            checked={layers.seatingHeatmap}
            onChange={() => toggleLayer('seatingHeatmap')}
            className="w-4 h-4 accent-emerald-500 rounded bg-slate-800 border-slate-700 cursor-pointer"
          />
        </label>

        <label className="flex items-center justify-between cursor-pointer group">
          <span className="text-sm text-slate-300 group-hover:text-white transition">
            Ambient Noise Contours
          </span>
          <input
            type="checkbox"
            checked={layers.noiseContours}
            onChange={() => toggleLayer('noiseContours')}
            className="w-4 h-4 accent-emerald-500 rounded bg-slate-800 border-slate-700 cursor-pointer"
          />
        </label>

        <label className="flex items-center justify-between cursor-pointer group">
          <span className="text-sm text-slate-300 group-hover:text-white transition">
            Power Outlet Availability Pins
          </span>
          <input
            type="checkbox"
            checked={layers.powerOutlets}
            onChange={() => toggleLayer('powerOutlets')}
            className="w-4 h-4 accent-emerald-500 rounded bg-slate-800 border-slate-700 cursor-pointer"
          />
        </label>
      </div>
    </div>
  );
};

export default MapLayerControl;