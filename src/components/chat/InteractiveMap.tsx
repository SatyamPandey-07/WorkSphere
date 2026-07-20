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
        {spiderfiedMarkers.map((marker, idx) => (
          <Marker
            key={idx}
            position={[marker.renderedLat, marker.renderedLng]}
            title={marker.name}
            alt={marker.name}
            keyboard={true}
            eventHandlers={markerEventHandlers}
          >
            <Popup>
              <div className="font-bold text-sm">{marker.name}</div>
              <div className="text-xs text-gray-500 capitalize">
                {marker.category?.replace("_", " ")}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
