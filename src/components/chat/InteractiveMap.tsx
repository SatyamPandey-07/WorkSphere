"use client";

import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { Map as MapIcon } from "lucide-react";
import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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
type TileProviderKey = 'carto' | 'osm' | 'wikimedia';

const TILE_URLS: Record<TileProviderKey, string> = {
  carto: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  osm: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  wikimedia: 'https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}{r}.png',
};

interface InteractiveMapProps {
  center: [number, number];
  markers?: { id: string; lat: number; lng: number; title: string }[];
}

export const InteractiveMap: React.FC<InteractiveMapProps> = ({ center, markers = [] }) => {
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [provider, setProvider] = useState<TileProviderKey>('carto');

  useEffect(() => {
    if (!containerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current).setView(center, 13);
    }

    if (tileLayerRef.current) {
      mapRef.current.removeLayer(tileLayerRef.current);
    }

    const layer = L.tileLayer(TILE_URLS[provider], {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors & CARTO',
      subdomains: 'abcd',
    });

    layer.on('tileerror', () => {
      if (provider === 'carto') {
        console.warn('Carto tile error caught in InteractiveMap. Falling back to OSM.');
        setProvider('osm');
      }
    });

    layer.addTo(mapRef.current);
    tileLayerRef.current = layer;

    // Render markers
    markers.forEach((m) => {
      L.marker([m.lat, m.lng]).addTo(mapRef.current!).bindPopup(m.title);
    });

  }, [provider, center, markers]);

  return (
    <div className="relative w-full h-[500px]">
      <div className="absolute top-3 right-3 z-[1000] bg-slate-900/90 border border-slate-700 rounded-xl p-2 shadow-xl flex items-center gap-2">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as TileProviderKey)}
          className="bg-slate-800 text-slate-100 text-xs rounded-lg px-2 py-1 border border-slate-700 cursor-pointer"
        >
          <option value="carto">Carto (Default)</option>
          <option value="osm">OpenStreetMap</option>
          <option value="wikimedia">Wikimedia</option>
        </select>
      </div>
      <div ref={containerRef} className="w-full h-full rounded-2xl border border-slate-800 shadow-2xl" />
    </div>
  );
};

  // Group and spiderfy overlapping markers
  const spiderfiedMarkers = useMemo(() => {
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
  const computedCenter = useMemo(() => {
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

  const [currentCenter, setCurrentCenter] = useState(computedCenter);

  useEffect(() => {
    setCurrentCenter(computedCenter);
  }, [computedCenter]);

  // Quick Map Navigation Handlers
  const handleZoomIn = useCallback(() => {
    setCurrentZoom((prev) => {
      const next = Math.min(prev + 1, 19);
      try {
        mapRef.current?.setZoom?.(next);
        mapRef.current?.zoomIn?.();
      } catch {
        // no-op in headless/test
      }
      return next;
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setCurrentZoom((prev) => {
      const next = Math.max(prev - 1, 1);
      try {
        mapRef.current?.setZoom?.(next);
        mapRef.current?.zoomOut?.();
      } catch {
        // no-op in headless/test
      }
      return next;
    });
  }, []);

  const handleResetView = useCallback(() => {
    setCurrentZoom(zoom);
    setCurrentCenter(computedCenter);
    try {
      mapRef.current?.setView?.([computedCenter.lat, computedCenter.lng], zoom);
    } catch {
      // no-op in headless/test
    }
  }, [computedCenter, zoom]);

  const handleToggleHighContrast = useCallback(() => {
    setIsHighContrast((prev) => !prev);
  }, []);

  // Bind global keydown listeners for quick map navigation actions
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when user is typing in form inputs, textareas, or contenteditables
      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isInput =
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        Boolean(target?.isContentEditable);

      if (isInput) return;

      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        handleZoomIn();
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        handleZoomOut();
      } else if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        handleToggleHighContrast();
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        handleResetView();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleZoomIn, handleZoomOut, handleToggleHighContrast, handleResetView]);

  // Memoized event handlers for interactive markers
  const markerEventHandlers = useMemo(
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
  const cartoKey =
    typeof process !== "undefined"
      ? process.env?.NEXT_PUBLIC_CARTO_KEY
      : undefined;

  const tileLayerUrl = cartoKey
    ? isHighContrast
      ? `https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?api_key=${cartoKey}`
      : `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?api_key=${cartoKey}`
    : isHighContrast
      ? "https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

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

        {/* High Contrast Toggle Button with Monospace Keyboard Badge */}
        <button
          type="button"
          onClick={handleToggleHighContrast}
          aria-label="Toggle high contrast map display mode"
          aria-pressed={isHighContrast}
          data-testid="map-high-contrast-btn"
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

          {!isTouchOnly && (
            <kbd
              data-testid="kbd-high-contrast"
              className="px-1 py-0.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded font-mono text-zinc-400"
            >
              H
            </kbd>
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

      {/* Quick Map Action Navigation Controls with Keyboard Badges */}
      <div
        data-testid="map-navigation-controls"
        className="absolute bottom-8 right-4 z-[400] sm:bottom-4 flex items-center gap-1.5 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm p-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-md"
      >
        {/* Zoom In Button */}
        <button
          type="button"
          onClick={handleZoomIn}
          data-testid="map-zoom-in-btn"
          aria-label="Zoom in"
          title="Zoom In (+)"
          className="min-h-11 min-w-11 flex items-center justify-center gap-1.5 px-2 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-blue-500" />
          {!isTouchOnly && (
            <kbd
              data-testid="kbd-zoom-in"
              className="px-1 py-0.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded font-mono text-zinc-400"
            >
              +
            </kbd>
          )}
        </button>

        {/* Zoom Out Button */}
        <button
          type="button"
          onClick={handleZoomOut}
          data-testid="map-zoom-out-btn"
          aria-label="Zoom out"
          title="Zoom Out (-)"
          className="min-h-11 min-w-11 flex items-center justify-center gap-1.5 px-2 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
        >
          <Minus className="w-3.5 h-3.5 text-blue-500" />
          {!isTouchOnly && (
            <kbd
              data-testid="kbd-zoom-out"
              className="px-1 py-0.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded font-mono text-zinc-400"
            >
              -
            </kbd>
          )}
        </button>

        {/* Reset View Button */}
        <button
          type="button"
          onClick={handleResetView}
          data-testid="map-reset-view-btn"
          aria-label="Reset map view"
          title="Reset View (R)"
          className="min-h-11 min-w-11 flex items-center justify-center gap-1.5 px-2 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5 text-emerald-500" />
          {!isTouchOnly && (
            <kbd
              data-testid="kbd-reset-view"
              className="px-1 py-0.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded font-mono text-zinc-400"
            >
              R
            </kbd>
          )}
        </button>
      </div>

      <MapContainer
        ref={mapRef}
        center={currentCenter}
        zoom={currentZoom}
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
            parts.push(
              `Category: ${String(marker.category).replace("_", " ")}`,
            );
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
                <div
                  data-testid="marker-popup-name"
                  className="font-bold text-sm"
                >
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
