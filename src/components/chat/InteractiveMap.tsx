"use client";

import React, { useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { Map as MapIcon, Sun, Moon } from "lucide-react";

// Fix for default leaflet icons in React
if (typeof window !== "undefined") {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
}

export interface InteractiveMapMarker {
  lat: number | string;
  lng: number | string;
  name?: string;
  title?: string;
  category?: string;
  score?: number | string;
  rating?: number | string;
  [key: string]: any;
}

export interface InteractiveMapProps {
  markers?: InteractiveMapMarker[];
  center?: { lat: number; lng: number };
  zoom?: number;
  className?: string;
}

export function InteractiveMap({
  markers = [],
  center: propCenter,
  zoom = 13,
  className = "",
}: InteractiveMapProps) {
  const [isHighContrast, setIsHighContrast] = useState(false);
  const [timeWindowHour, setTimeWindowHour] = useState(12);

  // Validate and sanitize numeric coordinates
  const safeMarkers = React.useMemo(() => {
    return (markers ?? []).filter(
      (m) =>
        m != null &&
        m.lat != null &&
        m.lng != null &&
        Number.isFinite(Number(m.lat)) &&
        Number.isFinite(Number(m.lng)),
    );
  }, [markers]);

  // Group and spiderfy overlapping markers
  const spiderfiedMarkers = React.useMemo(() => {
    const groups: { [key: string]: any[] } = {};
    safeMarkers.forEach((m) => {
      const numLat = Number(m.lat);
      const numLng = Number(m.lng);
      const key = `${numLat.toFixed(6)},${numLng.toFixed(6)}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push({ ...m, lat: numLat, lng: numLng });
    });

    const result: any[] = [];
    Object.keys(groups).forEach((key) => {
      const groupItems = groups[key];
      const n = groupItems.length;
      if (n === 1) {
        result.push({
          ...groupItems[0],
          renderedLat: groupItems[0].lat,
          renderedLng: groupItems[0].lng,
        });
      } else {
        const centerLat = groupItems[0].lat;
        const centerLng = groupItems[0].lng;
        // Base radius of ~200 meters to visually separate markers at default zoom
        const baseRadius = 0.002;
        // Expand slightly if many markers share the location
        const radius = baseRadius + 0.0002 * n;

        groupItems.forEach((item, index) => {
          const angle = (2 * Math.PI * index) / n;
          const offsetLat = centerLat + radius * Math.cos(angle);
          const offsetLng = centerLng + radius * Math.sin(angle);
          result.push({
            ...item,
            renderedLat: offsetLat,
            renderedLng: offsetLng,
          });
        });
      }
    });
    return result;
  }, [safeMarkers]);

  // Determine map centroid defensively
  const computedCenter = React.useMemo(() => {
    if (
      propCenter &&
      propCenter.lat != null &&
      propCenter.lng != null &&
      Number.isFinite(Number(propCenter.lat)) &&
      Number.isFinite(Number(propCenter.lng))
    ) {
      return { lat: Number(propCenter.lat), lng: Number(propCenter.lng) };
    }
    if (safeMarkers.length > 0) {
      const sumLat = safeMarkers.reduce((sum, m) => sum + Number(m.lat), 0);
      const sumLng = safeMarkers.reduce((sum, m) => sum + Number(m.lng), 0);
      return {
        lat: sumLat / safeMarkers.length,
        lng: sumLng / safeMarkers.length,
      };
    }
    return { lat: 0, lng: 0 };
  }, [propCenter, safeMarkers]);

  // Memoized event handlers for interactive markers
  const markerEventHandlers = React.useMemo(
    () => ({
      keydown: (e: any) => {
        if (e.originalEvent?.key === "Enter" || e.originalEvent?.key === " ") {
          e.originalEvent?.preventDefault?.();
          e.target?.openPopup?.();
        }
      },
      add: (e: any) => {
        const el = e.target?.getElement?.();
        if (el) {
          const name = e.target?.options?.title || "Map marker";
          el.setAttribute("aria-label", name);
          el.setAttribute("role", "button");
          el.setAttribute("tabindex", "0");
        }
      },
    }),
    [],
  );

  // Dynamic Tile Layer URL depending on High Contrast mode
 docs/multi-agent-consensus-diagram

 docs/testing-playbook

 feature/edge-bloom-limiter

 feature/audio-echo-canceller

 feature/3d-social-matrix

 feature/dtn-bundle-protocol

 fix/webgl-heatmap-renderer-palette

 feature/partykit-agent-monitor
 main
 main
 main
 main
 main
 main
main
  const tileLayerUrl = isHighContrast
    ? "https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

 docs/multi-agent-consensus-diagram

 docs/testing-playbook

 feature/edge-bloom-limiter

 feature/audio-echo-canceller

 feature/3d-social-matrix

feature/dtn-bundle-protocol

 fix/webgl-heatmap-renderer-palette

  const cartoKey = process.env.NEXT_PUBLIC_CARTO_KEY;
  const tileLayerUrl = cartoKey
    ? isHighContrast
      ? `https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?api_key=${cartoKey}`
      : `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?api_key=${cartoKey}`
    : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
 main

 main
main
main
 main
main
 main
 main
  // Fallback empty view
  if (safeMarkers.length === 0 && !propCenter) {
    return (
      <div
        data-testid="interactive-map-empty"
        className="w-full p-6 text-center text-xs text-zinc-500 border border-zinc-200 dark:border-zinc-800 rounded-2xl"
      >
        No markers provided
      </div>
    );
  }

  return (
    <div
      data-testid="interactive-map"
      className={`w-full h-80 mt-4 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden relative z-0 ${className}`}
    >
      {/* Map Overlay Controls - Non-overlapping Responsive Stack */}
      <div className="absolute top-2 left-2 z-[400] flex flex-col sm:flex-row items-start sm:items-center gap-2 max-w-[calc(100%-1rem)]">
        {/* Map Header Badge */}
        <div
          data-testid="map-header"
          className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 flex items-center gap-2 text-xs font-bold text-zinc-700 dark:text-zinc-300 shrink-0"
        >
          <MapIcon className="w-3.5 h-3.5 text-blue-500" />
          Interactive Map
        </div>

        {/* High Contrast Toggle Button */}
        <button
          type="button"
          onClick={() => setIsHighContrast((prev) => !prev)}
          aria-label="Toggle high contrast map display mode"
          aria-pressed={isHighContrast}
          className="shrink-0 px-2.5 py-1 text-xs font-semibold rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/90 text-zinc-800 dark:text-zinc-200 shadow-sm backdrop-blur-md hover:bg-zinc-100 dark:hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 transition-all flex items-center gap-1.5 cursor-pointer"
        >
          {isHighContrast ? (
            <>
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              Standard Contrast
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5 text-indigo-400" />
              High Contrast
            </>
          )}
        </button>

        {/* Time Window Slider Container */}
        <div className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/90 px-3 py-1 text-xs text-zinc-700 dark:text-zinc-300 shadow-sm backdrop-blur-md max-w-full overflow-x-auto">
          <span className="shrink-0 font-medium text-zinc-500 dark:text-zinc-400">
            Time:
          </span>
          <input
            type="range"
            min={0}
            max={24}
            value={timeWindowHour}
            onChange={(e) => setTimeWindowHour(Number(e.target.value))}
            aria-label="Time window hour slider"
            className="h-1.5 w-20 sm:w-28 accent-emerald-500 bg-zinc-200 dark:bg-zinc-700 rounded-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          />
          <span className="shrink-0 font-mono text-emerald-600 dark:text-emerald-400 font-semibold text-[11px] min-w-[45px]">
            {`${String(timeWindowHour).padStart(2, "0")}:00`}
          </span>
        </div>
      </div>

      <MapContainer
        center={computedCenter}
        zoom={zoom}
        style={{ height: "100%", width: "100%", zIndex: 0 }}
      >
        <TileLayer
          url={tileLayerUrl}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        {spiderfiedMarkers.map((marker, idx) => {
          const venueName = marker.name || marker.title || "Location";
          const ratingVal = marker.score ?? marker.rating;
          const parts = [`Venue: ${venueName}`];
          if (marker.category) {
            parts.push(`Category: ${String(marker.category).replace("_", " ")}`);
          }
          if (ratingVal != null && !isNaN(Number(ratingVal))) {
            parts.push(`Rating: ${ratingVal}`);
          }
          const markerAriaLabel = parts.join(", ");

          return (
            <Marker
              key={idx}
              position={[marker.renderedLat, marker.renderedLng]}
              title={markerAriaLabel}
              alt={venueName}
              keyboard={true}
              eventHandlers={{
                ...markerEventHandlers,
                add: (e: any) => {
                  const el = e.target?.getElement?.();
                  if (el) {
                    el.setAttribute("aria-label", markerAriaLabel);
                    el.setAttribute("role", "button");
                    el.setAttribute("tabindex", "0");
                    el.classList.add("interactive-map-pin");
                  }
                },
              }}
            >
              <Popup
                autoPanPadding={[20, 20]}
                autoPanPaddingTopLeft={[20, 90]}
                autoPanPaddingBottomRight={[20, 20]}
              >
                <div data-testid="marker-popup-name" className="font-bold text-sm">
                  {venueName}
                </div>
                {marker.category && (
                  <div className="text-xs text-gray-500 capitalize">
                    {String(marker.category).replace("_", " ")}
                  </div>
                )}
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}

export default InteractiveMap;