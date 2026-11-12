"use client";

import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Footprints, Bike, Car } from "lucide-react";
import MapRouteLayer, {
  CalculatedRoute,
  RouteCoordinate,
  TransitMode,
} from "./map/MapRouteLayer";

interface MapProps {
  center?: RouteCoordinate;
  zoom?: number;
  origin?: RouteCoordinate | null;
  destination?: RouteCoordinate | null;
  initialMode?: TransitMode;
}

const TRANSIT_MODES: {
  id: TransitMode;
  label: string;
  icon: React.ReactNode;
}[] = [
  { id: "walking", label: "Walking", icon: <Footprints className="h-4 w-4" /> },
  { id: "cycling", label: "Cycling", icon: <Bike className="h-4 w-4" /> },
  { id: "driving", label: "Driving", icon: <Car className="h-4 w-4" /> },
];

export const Map: React.FC<MapProps> = ({
  center = { lat: 19.076, lng: 72.8777 },
  zoom = 13,
  origin = null,
  destination = null,
  initialMode = "walking",
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const [transitMode, setTransitMode] = useState<TransitMode>(initialMode);
  const [activeRoute, setActiveRoute] = useState<CalculatedRoute | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    setMapInstance(map);

    return () => {
      map.remove();
      setMapInstance(null);
    };
  }, [center.lat, center.lng, zoom]);

  const handleModeChange = (nextMode: TransitMode) => {
    if (nextMode === transitMode) return;
    setActiveRoute(null);
    setTransitMode(nextMode);
  };

  return (
    <div className="relative h-full min-h-[420px] w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
      {/* Transit Mode Switcher */}
      <div
        role="group"
        aria-label="Transit mode"
        className="absolute left-3 top-3 z-[1000] inline-flex items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-900/90 p-1 shadow-lg backdrop-blur-md"
      >
        {TRANSIT_MODES.map((item) => {
          const isActive = transitMode === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => handleModeChange(item.id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                isActive
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active Route Summary Pill */}
      {activeRoute && (
        <div className="absolute bottom-3 left-3 z-[1000] rounded-lg border border-slate-700/80 bg-slate-900/90 px-3 py-1.5 text-xs font-medium text-slate-200 shadow-lg backdrop-blur-md">
          {Math.max(1, Math.round(activeRoute.durationSeconds / 60))} min &bull;{" "}
          {(activeRoute.distanceMeters / 1000).toFixed(1)} km
        </div>
      )}

      {/* Map Canvas */}
      <div ref={containerRef} className="h-full min-h-[420px] w-full" />

      {/* Managed Route Polyline Layer */}
      <MapRouteLayer
        map={mapInstance}
        origin={origin}
        destination={destination}
        mode={transitMode}
        onRouteCalculated={setActiveRoute}
      />
    </div>
  );
};

export default Map;
