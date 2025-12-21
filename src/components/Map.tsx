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
          border: 3px solid #007bff; /* Simple blue border */
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3);
        }
        .default-dot-marker {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background-color: #007bff;
          border: 3px solid white;
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3);
          /* Offset for iconAnchor */
          transform: translate(10px, 10px);
        }

        /* Fix for Next.js/Leaflet width/height bug */
        .leaflet-container {
          width: 100%;
          height: 100%;
          border-radius: 12px;
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
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
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
            icon={defaultIcon}
          >
            <Popup>
              <div className="text-sm">
                <div className="font-semibold">{marker.name}</div>
                {marker.category && (
                  <div className="text-zinc-600">{marker.category}</div>
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
              color: route.isHighlighted ? "#28a745" : "#007bff",
              weight: 5,
              opacity: 0.8,
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
