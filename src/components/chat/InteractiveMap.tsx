"use client";

import React from "react";
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

export default function InteractiveMap({ markers }: { markers: any[] }) {
  // Group and spiderfy overlapping markers
  const spiderfiedMarkers = React.useMemo(() => {
    const groups: { [key: string]: any[] } = {};
    if (markers) {
      markers.forEach((m) => {
        if (
          m &&
          m.lat != null &&
          m.lng != null &&
          !isNaN(Number(m.lat)) &&
          !isNaN(Number(m.lng))
        ) {
          const key = `${Number(m.lat).toFixed(6)},${Number(m.lng).toFixed(6)}`;
          if (!groups[key]) {
            groups[key] = [];
          }
          groups[key].push(m);
        }
      });
    }

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
  }, [markers]);

  // Memoized event handlers for all interactive markers to prevent react-leaflet
  // from removing and re-adding event listeners on every render.
  const markerEventHandlers = React.useMemo(
    () => ({
      keydown: (e: any) => {
        if (e.originalEvent.key === "Enter" || e.originalEvent.key === " ") {
          e.originalEvent.preventDefault();
          e.target.openPopup();
        }
      },
      add: (e: any) => {
        const el = e.target.getElement();
        if (el) {
          const name = e.target.options.title || "Map marker";
          el.setAttribute("aria-label", name);
          el.setAttribute("role", "button");
          el.setAttribute("tabindex", "0");
        }
      },
    }),
    [],
  );

  if (!markers || markers.length === 0) return <div>No markers provided</div>;

  const center = {
    lat: markers.reduce((sum, m) => sum + m.lat, 0) / markers.length,
    lng: markers.reduce((sum, m) => sum + m.lng, 0) / markers.length,
  };

  return (
    <div className="w-full h-64 mt-4 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden relative z-0">
      <div className="absolute top-2 left-2 z-[400] bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 flex items-center gap-2 text-xs font-bold text-zinc-700 dark:text-zinc-300">
        <MapIcon className="w-3 h-3 text-blue-500" />
        Interactive Map View
      </div>
      <MapContainer
        center={center}
        zoom={13}
        style={{ height: "100%", width: "100%", zIndex: 0 }}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        {spiderfiedMarkers.map((marker, idx) => {
          const ratingVal = marker.score ?? marker.rating;
          const parts = [`Venue: ${marker.name}`];
          if (marker.category) {
            parts.push(`Category: ${marker.category.replace("_", " ")}`);
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
              alt={marker.name}
              keyboard={true}
              eventHandlers={{
                ...markerEventHandlers,
                add: (e: any) => {
                  const el = e.target.getElement();
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
                <div className="font-bold text-sm">{marker.name}</div>
                <div className="text-xs text-gray-500 capitalize">
                  {marker.category?.replace("_", " ")}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
