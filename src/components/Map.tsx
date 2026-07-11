"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
} from "react-leaflet";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";
import { MapMarker, MapRoute, MapView } from "@/types/map";

// Import Leaflet Heatmap Plugin safely only on client-side
if (typeof window !== "undefined") {
  require("leaflet.heat");
}

// Custom venue marker for dark theme - purple/blue dot
const venueIcon = L.divIcon({
  className: "venue-marker",
  html: `<div class="venue-dot"></div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12],
});

// Destination marker - like the reference image
const destinationIcon = L.divIcon({
  className: "destination-marker",
  html: `<div class="destination-pin"><span>D</span></div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

// Also fix the global default:
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "/leaflet/marker-icon-2x.png",
  iconUrl: "/leaflet/marker-icon.png",
  shadowUrl: "/leaflet/marker-shadow.png",
});

function MapController({ mapView }: { mapView: MapView | null }) {
  const map = useMap();

  useEffect(() => {
    if (mapView && mapView.center && mapView.zoom) {
      if (mapView.animate) {
        map.flyTo([mapView.center.lat, mapView.center.lng], mapView.zoom);
      } else {
        map.setView([mapView.center.lat, mapView.center.lng], mapView.zoom);
      }
    }
  }, [mapView, map]);

  return null;
}

function AutoCenter({
  markers,
  userLocation,
}: {
  markers: MapMarker[];
  userLocation: [number, number];
}) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    const bounds = L.latLngBounds([
      userLocation,
      ...markers.map(
        (m) => [m.position.lat, m.position.lng] as [number, number]
      ),
    ]);

    if (markers.length > 0) {
      map.flyToBounds(bounds, { padding: [100, 100] });
    } else {
      map.setView(userLocation, 13);
    }
  }, [markers, userLocation, map]);

  return null;
}

// Subcomponent to handle rendering the Leaflet heatmap layer seamlessly
function HeatmapOverlay({ points, visible }: { points: any[]; visible: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !visible || points.length === 0) return;

    // Glowing purple/blue gradient zones as outlined in issue parameters
    const gradient = {
      0.3: "#1e3a8a", // Deep Blue (Quiet)
      0.55: "#3b82f6", // Bright Blue (Moderate)
      0.8: "#8b5cf6",  // Velvet Purple (Busy)
      1.0: "#d946ef",  // Neon Pink/Fuchsia (High Activity levels)
    };

    const heatLayer = (L as any).heatLayer(points, {
      radius: 30,
      blur: 18,
      maxZoom: 16,
      gradient: gradient,
    });

    heatLayer.addTo(map);

    return () => {
      if (map && heatLayer) {
        map.removeLayer(heatLayer);
      }
    };
  }, [map, points, visible]);

  return null;
}

const Map = ({
  location,
  markers,
  routes,
  mapView,
}: {
  location: { latitude: number; longitude: number };
  markers: MapMarker[];
  routes: MapRoute[];
  mapView: MapView | null;
}) => {
  const clerkUser = useUser();
  const { latitude, longitude } = location;

  // Track heatmap states
  const [showHeatmap, setShowHeatmap] = useState<boolean>(false);
  const [heatmapPoints, setHeatmapPoints] = useState<any[]>([]);

  // Async load data context when layer UI toggles active
  useEffect(() => {
    if (showHeatmap) {
      fetch("/api/map/heatmap")
        .then((res) => res.json())
        .then((resData) => {
          if (resData.success) {
            setHeatmapPoints(resData.data);
          }
        })
        .catch((err) => console.error("Could not populate heatmap context", err));
    }
  }, [showHeatmap]);

  // Derive iconUrl directly from clerkUser state
  const iconUrl = useMemo(() => {
    if (clerkUser.isLoaded && clerkUser.user?.hasImage) {
      return clerkUser.user.imageUrl;
    } else if (clerkUser.isLoaded) {
      return "default";
    }
    return null;
  }, [clerkUser.isLoaded, clerkUser.user]);

  // Derive customIcon from iconUrl
  const customIcon = useMemo(() => {
    let html: string;

    if (iconUrl && iconUrl !== "default") {
      html = `<div class="image-marker" style="background-image: url(${iconUrl})"></div>`;
    } else {
      html = `<div class="default-dot-marker"></div>`;
    }

    return L.divIcon({
      className: "custom-user-marker",
      html: html,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  }, [iconUrl]);

  const center: [number, number] = [latitude, longitude];

  return (
<>
      <style dangerouslySetInnerHTML={{
        __html: `
        .custom-user-marker {
          /* This container itself doesn't need styles */
        }
        .image-marker {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background-size: cover;
          background-position: center;
          border: 3px solid #3b82f6; /* Blue border for dark theme */
          box-shadow: 0 0 10px rgba(59, 130, 246, 0.5), 0 2px 8px rgba(0, 0, 0, 0.5);
        }
        .default-dot-marker {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background-color: #3b82f6;
          border: 3px solid white;
          box-shadow: 0 0 10px rgba(59, 130, 246, 0.5), 0 2px 8px rgba(0, 0, 0, 0.5);
          /* Offset for iconAnchor */
          transform: translate(10px, 10px);
        }

        /* Fix for Next.js/Leaflet width/height bug */
        .leaflet-container {
          width: 100%;
          height: 100%;
          border-radius: 12px;
        }
        
        /* UPDATED: Target map tiles specifically so they don't hide the heatmap canvas */
        .leaflet-layer {
          filter: brightness(0.6) invert(1) contrast(3) hue-rotate(200deg) saturate(0.3) brightness(0.7);
        }

        /* NEW: Keeps the glowing canvas layer clean and visible */
        .leaflet-heatmap-layer {
          z-index: 400 !important;
          mix-blend-mode: screen;
          filter: none !important; /* Forces the browser to keep full color saturation */
        }
        
        /* Venue marker - circular dot */
        .venue-dot {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: linear-gradient(135deg, #8b5cf6, #6366f1);
          border: 3px solid white;
          box-shadow: 0 0 12px rgba(139, 92, 246, 0.6), 0 2px 8px rgba(0, 0, 0, 0.4);
          transform: translate(2px, 2px);
        }
        
        /* Destination pin marker */
        .destination-pin {
          width: 32px;
          height: 32px;
          border-radius: 50% 50% 50% 0;
          background: linear-gradient(135deg, #8b5cf6, #6366f1);
          transform: rotate(-45deg);
          border: 2px solid white;
          box-shadow: 0 0 12px rgba(139, 92, 246, 0.6), 0 4px 8px rgba(0, 0, 0, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .destination-pin span {
          transform: rotate(45deg);
          color: white;
          font-weight: bold;
          font-size: 14px;
        }
        
        /* Leaflet popup styling for dark theme */
        .leaflet-popup-content-wrapper {
          background: rgba(30, 30, 30, 0.95);
          color: white;
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        }
        .leaflet-popup-tip {
          background: rgba(30, 30, 30, 0.95);
        }
        .leaflet-popup-content {
          margin: 12px 16px;
        }
        
        /* Floating toggle position above canvas layers */
        .map-heatmap-toggle {
          position: absolute;
          top: 20px;
          right: 20px;
          z-index: 1000;
        }
      `}} />

      <MapContainer
        center={center}
        zoom={13}
        style={{
          width: "95%",
          height: "95%",
          borderRadius: "12px",
          position: "relative"
        }}
      >
        <div className="map-heatmap-toggle">
          <button
            type="button"
            onClick={() => setShowHeatmap(!showHeatmap)}
            className={`px-4 py-2 text-xs font-semibold rounded-lg shadow-md border transition-all duration-200 ${
              showHeatmap
                ? "bg-purple-600 text-white border-purple-500 hover:bg-purple-700"
                : "bg-zinc-900 text-zinc-300 border-zinc-700 hover:bg-zinc-800"
            }`}
          >
            {showHeatmap ? "📍 Show Venue Markers" : "🔥 Show Live Crowd Heatmap"}
          </button>
        </div>

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          className="map-tiles-dark"
        />
        <MapController mapView={mapView} />
        <AutoCenter markers={markers} userLocation={center} />

        {customIcon && (
          <Marker position={center} icon={customIcon}>
            <Popup>You are here!</Popup>
          </Marker>
        )}


        {showHeatmap ? (
          <HeatmapOverlay points={heatmapPoints} visible={showHeatmap} />
        ) : (
          markers
            .filter((marker) => marker && marker.position && marker.position.lat != null && marker.position.lng != null && !isNaN(Number(marker.position.lat)) && !isNaN(Number(marker.position.lng)))
            .map((marker) => (
              <Marker
                key={marker.id}
                position={[Number(marker.position.lat), Number(marker.position.lng)]}
                icon={marker.id.includes("dest") ? destinationIcon : venueIcon}
              >
                <Popup>
                  <div className="text-sm">
                    <div className="font-semibold text-white">{marker.name}</div>
                    {marker.category && (
                      <div className="text-zinc-400">{marker.category}</div>
                    )}
                    {marker.address && (
                      <div className="text-zinc-500 text-xs mt-1">{marker.address}</div>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))
        )}

        {routes.map((route) => {
          const validPositions = (route.path || [])
            .filter((p) => p && p.lat != null && p.lng != null && !isNaN(Number(p.lat)) && !isNaN(Number(p.lng)))
            .map((p) => [Number(p.lat), Number(p.lng)] as [number, number]);

          if (validPositions.length < 2) return null;

          return (
            <Polyline
              key={route.id}
              positions={validPositions}
              pathOptions={{
                color: "#22c55e",
                weight: 6,
                opacity: 0.9,
                lineCap: "round",
                lineJoin: "round",
              }}
            >
              {route.distance && (
                <Popup>
                  <div className="text-sm">
                    Distance: {(route.distance / 1000).toFixed(1)} km
                    {route.duration && (
                      <div>Time: {Math.round(route.duration / 60)} min</div>
                    )}
                  </div>
                </Popup>
              )}
            </Polyline>
          );
        })}

        {markers.map((marker) => (
          <Marker
            key={marker.id}
            position={[marker.position.lat, marker.position.lng]}
            icon={marker.id.includes("dest") ? destinationIcon : venueIcon}
          >
            <Popup>
              <div className="text-sm">
                <div className="font-semibold text-white">{marker.name}</div>
                {marker.category && (
                  <div className="text-zinc-400">{marker.category}</div>
                )}
                {marker.address && (
                  <div className="text-zinc-500 text-xs mt-1">{marker.address}</div>
                )}
              </div>
            </Popup>
          </Marker>
        ))}

        {routes.map((route) => (
          <Polyline
            key={route.id}
            positions={route.path.map(p => [p.lat, p.lng])}
            pathOptions={{
              color: route.isHighlighted ? "#22c55e" : "#22c55e", // Green route like the reference
              weight: 6,
              opacity: 0.9,
              lineCap: "round",
              lineJoin: "round",
            }}
          >
            {route.distance && (
              <Popup>
                <div className="text-sm">
                  Distance: {(route.distance / 1000).toFixed(1)} km
                  {route.duration && (
                    <div>Time: {Math.round(route.duration / 60)} min</div>
                  )}
                </div>
              </Popup>
            )}
          </Polyline>
        ))}
      </MapContainer>
    </>
  );
};

export default Map;
