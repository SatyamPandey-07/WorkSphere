"use client";

import React, { memo } from "react";
import { Polyline, Popup } from "react-leaflet";
import type { MapRoute } from "@/types/map";
import { formatDistance } from "@/lib/geo/formatDistance";

export interface OptimizedRouteData {
  coordinates: [number, number][];
  duration: number;
  distance: number;
  legs?: any[];
}

export interface MapRouteLayerProps {
  routes?: MapRoute[];
  optimizedRoute?: OptimizedRouteData | null;
  travelProfile?: "walking" | "cycling" | "driving";
}

/**
 * Decodes an encoded polyline string (Google / OSRM algorithm)
 * into an array of [latitude, longitude] coordinate tuples.
 */
export function decodePolyline(
  encoded: string,
  precision: number = 5,
): [number, number][] {
  if (!encoded) return [];

  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates: [number, number][] = [];
  const factor = Math.pow(10, precision);

  while (index < encoded.length) {
    let byte: number;
    let shift = 0;
    let result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    coordinates.push([lat / factor, lng / factor]);
  }

  return coordinates;
}

/**
 * Encodes an array of [latitude, longitude] coordinates into a polyline string.
 */
export function encodePolyline(
  coordinates: [number, number][],
  precision: number = 5,
): string {
  if (!coordinates || coordinates.length === 0) return "";

  const factor = Math.pow(10, precision);
  let output = "";
  let prevLat = 0;
  let prevLng = 0;

  for (const [lat, lng] of coordinates) {
    const latInt = Math.round(lat * factor);
    const lngInt = Math.round(lng * factor);

    let deltaLat = latInt - prevLat;
    let deltaLng = lngInt - prevLng;

    prevLat = latInt;
    prevLng = lngInt;

    for (let delta of [deltaLat, deltaLng]) {
      delta = delta < 0 ? ~(delta << 1) : delta << 1;
      while (delta >= 0x20) {
        output += String.fromCharCode((0x20 | (delta & 0x1f)) + 63);
        delta >>= 5;
      }
      output += String.fromCharCode(delta + 63);
    }
  }

  return output;
}

/**
 * Route rendering component displaying both multi-stop optimized routes
 * and standard custom navigation routes.
 */
export const MapRouteLayer = memo(function MapRouteLayer({
  routes = [],
  optimizedRoute = null,
  travelProfile = "walking",
}: MapRouteLayerProps) {
  return (
    <>
      {/* Render OSRM Optimized Multi-Stop Routing Layer Geometry */}
      {optimizedRoute &&
        optimizedRoute.coordinates &&
        optimizedRoute.coordinates.length > 1 && (
          <Polyline
            positions={optimizedRoute.coordinates}
            pathOptions={{
              color: "#3b82f6", // Electric Blue for Multi-Stop Leg paths
              weight: 6,
              opacity: 0.9,
              lineCap: "round",
              lineJoin: "round",
              dashArray: travelProfile === "walking" ? "5, 10" : undefined, // Dotted path line if walking
            }}
          >
            <Popup
              autoPanPadding={[20, 20]}
              autoPanPaddingTopLeft={[20, 90]}
              autoPanPaddingBottomRight={[20, 20]}
            >
              <div className="text-sm text-white">
                <div className="font-bold text-blue-400">
                  Optimized Hybrid Schedule
                </div>
                <div>
                  Total Distance:{" "}
                  {formatDistance(optimizedRoute.distance / 1000)}
                </div>
                <div>
                  Est. Travel Time: {Math.round(optimizedRoute.duration / 60)}{" "}
                  mins
                </div>
              </div>
            </Popup>
          </Polyline>
        )}

      {/* Render User Routes */}
      {routes.map((route) => {
        const validPositions = (route.path || [])
          .filter(
            (p) =>
              p &&
              p.lat != null &&
              p.lng != null &&
              !isNaN(Number(p.lat)) &&
              !isNaN(Number(p.lng)),
          )
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
              <Popup autoPanPadding={[20, 20]}>
                <div className="text-sm">
                  Distance: {formatDistance(route.distance / 1000)}
                  {route.duration && (
                    <div>Time: {Math.round(route.duration / 60)} min</div>
                  )}
                </div>
              </Popup>
            )}
          </Polyline>
        );
      })}
    </>
  );
});

export default MapRouteLayer;
