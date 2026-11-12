"use client";

import React, { useCallback, useEffect, useRef } from "react";
import L from "leaflet";

export type TransitMode = "walking" | "cycling" | "driving";

export interface RouteCoordinate {
  lat: number;
  lng: number;
}

export interface CalculatedRoute {
  coordinates: RouteCoordinate[];
  distanceMeters: number;
  durationSeconds: number;
}

interface MapRouteLayerProps {
  map: L.Map | null;
  origin: RouteCoordinate | null;
  destination: RouteCoordinate | null;
  mode: TransitMode;
  routeEndpoint?: string;
  onRouteCalculated?: (route: CalculatedRoute) => void;
  onRouteError?: (error: Error) => void;
}

const MODE_COLORS: Record<TransitMode, string> = {
  walking: "#10b981", // Emerald
  cycling: "#06b6d4", // Cyan
  driving: "#6366f1", // Indigo
};

export const MapRouteLayer: React.FC<MapRouteLayerProps> = ({
  map,
  origin,
  destination,
  mode,
  routeEndpoint = "/api/routes",
  onRouteCalculated,
  onRouteError,
}) => {
  const polylineLayersRef = useRef<L.Polyline[]>([]);
  const markerLayersRef = useRef<L.Marker[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const clearRouteLayers = useCallback(() => {
    polylineLayersRef.current.forEach((layer) => {
      layer.unbindTooltip();
      layer.remove();
    });
    polylineLayersRef.current = [];

    markerLayersRef.current.forEach((marker) => {
      marker.unbindTooltip();
      marker.remove();
    });
    markerLayersRef.current = [];
  }, []);

  useEffect(() => {
    if (!map || !origin || !destination) {
      clearRouteLayers();
      return;
    }

    // Abort any in-flight route request before starting a new one
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Clear existing polylines and markers immediately on mode/endpoint change
    clearRouteLayers();

    const fetchAndRenderRoute = async () => {
      try {
        const params = new URLSearchParams({
          originLat: String(origin.lat),
          originLng: String(origin.lng),
          destLat: String(destination.lat),
          destLng: String(destination.lng),
          mode,
        });

        const response = await fetch(`${routeEndpoint}?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Route calculation failed (${response.status})`);
        }

        const data = (await response.json()) as CalculatedRoute;

        // Guard against stale responses resolving after abort
        if (controller.signal.aborted) return;

        // Ensure clean slate right before rendering newly calculated geometry
        clearRouteLayers();

        const latLngs: L.LatLngExpression[] = data.coordinates.map((pt) => [
          pt.lat,
          pt.lng,
        ]);

        if (latLngs.length === 0) return;

        const polyline = L.polyline(latLngs, {
          color: MODE_COLORS[mode],
          weight: 5,
          opacity: 0.9,
        }).addTo(map);

        const durationMinutes = Math.max(
          1,
          Math.round(data.durationSeconds / 60),
        );
        const distanceKm = (data.distanceMeters / 1000).toFixed(1);

        polyline.bindTooltip(
          `${mode.toUpperCase()}: ${durationMinutes} min (${distanceKm} km)`,
          {
            sticky: true,
          },
        );

        polylineLayersRef.current.push(polyline);

        const startMarker = L.marker([origin.lat, origin.lng])
          .bindTooltip("Start", { direction: "top" })
          .addTo(map);
        const endMarker = L.marker([destination.lat, destination.lng])
          .bindTooltip("Destination", { direction: "top" })
          .addTo(map);

        markerLayersRef.current.push(startMarker, endMarker);

        onRouteCalculated?.(data);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        onRouteError?.(
          err instanceof Error ? err : new Error("Failed to calculate route"),
        );
      }
    };

    void fetchAndRenderRoute();

    return () => {
      controller.abort();
    };
  }, [
    map,
    origin,
    destination,
    mode,
    routeEndpoint,
    clearRouteLayers,
    onRouteCalculated,
    onRouteError,
  ]);

  // Clean up all polylines, markers, tooltips, and pending requests on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      clearRouteLayers();
    };
  }, [clearRouteLayers]);

  return null;
};

export default MapRouteLayer;
