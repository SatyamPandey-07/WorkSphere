"use client";

import React from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { Map as MapIcon } from "lucide-react";

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

  // Memoized event handlers for interactive markers to prevent re-attaching listeners
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

  // Fallback empty view if neither markers nor valid center provided
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
      className={`w-full h-64 mt-4 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden relative z-0 ${className}`}
    >
      <div
        data-testid="map-header"
        className="absolute top-2 left-2 z-[400] bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 flex items-center gap-2 text-xs font-bold text-zinc-700 dark:text-zinc-300"
      >
        <MapIcon className="w-3 h-3 text-blue-500" />
        Interactive Map View
      </div>
      <MapContainer
        center={computedCenter}
        zoom={zoom}
        style={{ height: "100%", width: "100%", zIndex: 0 }}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
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
