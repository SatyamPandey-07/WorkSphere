"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect, useMemo } from "react";
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
import { MapMarker, MapRoute, MapView } from "@/types/map";

const defaultIcon = L.icon({
  iconRetinaUrl: "/leaflet/marker-icon-2x.png",
  iconUrl: "/leaflet/marker-icon.png",
  shadowUrl: "/leaflet/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

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

const _routeStyles = {
  highlighted: { color: "#28a745", weight: 7, opacity: 1 }, // Green
  faded: { color: "#6c757d", weight: 5, opacity: 0.5 }, // Gray
  normal: { color: "#007bff", weight: 5, opacity: 0.8 }, // Blue
};

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
      <style jsx global>{`
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
      `}</style>

      <MapContainer
        center={center}
        zoom={13}
        style={{
          width: "95%",
          height: "95%",
          borderRadius: "12px",
        }}
      >
        {/* Dark theme with visible labels - CartoDB Voyager Dark */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png"
        />
        <MapController mapView={mapView} />
        <AutoCenter markers={markers} userLocation={center} />

        {customIcon && (
          <Marker position={center} icon={customIcon}>
            <Popup>You are here!</Popup>
          </Marker>
        )}

        {markers.map((marker) => (
          <Marker
            key={marker.id}
            position={[marker.position.lat, marker.position.lng]}
            icon={venueIcon}
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
