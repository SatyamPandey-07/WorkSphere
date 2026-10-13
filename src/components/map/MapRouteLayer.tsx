"use client";

import React, { memo, useEffect, useRef, useState, useMemo } from "react";
import { Polyline, Popup, useMap } from "react-leaflet";
import type { MapRoute } from "@/types/map";
import { formatDistance } from "@/lib/geo/formatDistance";
import {
  reinitializeWebGLBuffers,
  type WebGLBufferAttributes,
} from "@/lib/webgl/contextManager";

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
  /** Explicit canvas element or canvas from Mapbox/Leaflet container */
  canvas?: HTMLCanvasElement | null;
  /** Optional map instance override (e.g. Mapbox GL or Leaflet map) */
  map?: any;
  /** Optional GeoJSON dataset to bind to route source upon context restoration */
  routeGeoJson?: any;
  /** Vector tile layer IDs to reload upon context restoration */
  vectorTileLayers?: string[] | any[];
  /** Callback fired when WebGL context lost event is caught */
  onContextLost?: () => void;
  /** Callback fired when WebGL context restored and layers are rebound */
  onContextRestored?: () => void;
  /** Callback fired when tab visibility changes between foreground and background */
  onVisibilityChange?: (visible: boolean) => void;
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

    const deltaLat = latInt - prevLat;
    const deltaLng = lngInt - prevLng;

    prevLat = latInt;
    prevLng = lngInt;

    for (const delta of [deltaLat, deltaLng]) {
      let d = delta < 0 ? ~(delta << 1) : delta << 1;
      while (d >= 0x20) {
        output += String.fromCharCode((0x20 | (d & 0x1f)) + 63);
        d >>= 5;
      }
      output += String.fromCharCode(d + 63);
    }
  }

  return output;
}

/**
 * Converts route paths and optimized route to a GeoJSON FeatureCollection.
 */
export function routesToGeoJson(
  routes: MapRoute[] = [],
  optimizedRoute: OptimizedRouteData | null = null,
): any {
  const features: any[] = [];

  if (
    optimizedRoute &&
    optimizedRoute.coordinates &&
    optimizedRoute.coordinates.length > 1
  ) {
    features.push({
      type: "Feature",
      id: "optimized-route",
      properties: {
        type: "optimized",
        distance: optimizedRoute.distance,
        duration: optimizedRoute.duration,
      },
      geometry: {
        type: "LineString",
        // GeoJSON uses [longitude, latitude]
        coordinates: optimizedRoute.coordinates.map(([lat, lng]) => [lng, lat]),
      },
    });
  }

  routes.forEach((route) => {
    const validCoords = (route.path || [])
      .filter(
        (p) =>
          p &&
          p.lat != null &&
          p.lng != null &&
          !isNaN(Number(p.lat)) &&
          !isNaN(Number(p.lng)),
      )
      .map((p) => [Number(p.lng), Number(p.lat)]);

    if (validCoords.length >= 2) {
      features.push({
        type: "Feature",
        id: route.id,
        properties: {
          id: route.id,
          type: "user-route",
          name: route.name,
          distance: route.distance,
          duration: route.duration,
        },
        geometry: {
          type: "LineString",
          coordinates: validCoords,
        },
      });
    }
  });

  return {
    type: "FeatureCollection",
    features,
  };
}

/**
 * Re-binds route GeoJSON datasets to Mapbox or custom map sources upon restoration.
 */
export function rebindRouteGeoJson(
  mapOrSource: any,
  geoJsonData: any,
): boolean {
  if (!mapOrSource) return false;
  try {
    if (typeof mapOrSource.getSource === "function") {
      const source =
        mapOrSource.getSource("route-source") ||
        mapOrSource.getSource("routes") ||
        mapOrSource.getSource("route-dataset");
      if (source && typeof source.setData === "function") {
        source.setData(geoJsonData);
        return true;
      }
    } else if (typeof mapOrSource.setData === "function") {
      mapOrSource.setData(geoJsonData);
      return true;
    }
  } catch (err) {
    console.warn(
      "[MapRouteLayer] Failed to re-bind route GeoJSON dataset:",
      err,
    );
  }
  return false;
}

/**
 * Re-binds vector tile layers and reloads their tile caches upon restoration.
 */
export function rebindVectorTileLayers(
  map: any,
  layerIds?: string[] | any[],
): boolean {
  if (!map) return false;
  let rebindCount = 0;
  try {
    // Mapbox GL / MapLibre GL source cache reloading
    if (map.style && typeof map.style.sourceCaches === "object") {
      const caches = map.style.sourceCaches;
      const targetKeys =
        Array.isArray(layerIds) && layerIds.length > 0
          ? layerIds
          : Object.keys(caches);

      targetKeys.forEach((key: string) => {
        const cache = caches[key];
        if (cache) {
          if (typeof cache.reload === "function") {
            cache.reload();
            rebindCount++;
          } else if (typeof cache.clearTiles === "function") {
            cache.clearTiles();
            cache.update?.();
            rebindCount++;
          }
        }
      });
      map.triggerRepaint?.();
    }

    // Leaflet vector tile layers (or tile layer groups)
    if (typeof map.eachLayer === "function") {
      map.eachLayer((layer: any) => {
        if (typeof layer.redraw === "function") {
          layer.redraw();
          rebindCount++;
        }
      });
    }
  } catch (err) {
    console.warn("[MapRouteLayer] Failed to re-bind vector tile layers:", err);
  }
  return rebindCount > 0;
}

/**
 * Recreates WebGL buffers for route geometry cleanly upon context restoration.
 */
export function recreateRouteBuffers(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  routes: MapRoute[] = [],
  optimizedRoute: OptimizedRouteData | null = null,
  canvas?: HTMLCanvasElement,
): WebGLBufferAttributes {
  const points: Array<[number, number, number?]> = [];

  if (optimizedRoute?.coordinates) {
    optimizedRoute.coordinates.forEach(([lat, lng]) => {
      points.push([lat, lng, 1.0]);
    });
  }

  routes.forEach((route) => {
    (route.path || []).forEach((p) => {
      if (p && p.lat != null && p.lng != null) {
        points.push([Number(p.lat), Number(p.lng), 0.8]);
      }
    });
  });

  return reinitializeWebGLBuffers(gl, points, canvas);
}

/**
 * Hook to safely access Leaflet map context without throwing when rendered
 * standalone or in testing environments outside MapContainer.
 */
function useSafeMap(overrideMap?: any) {
  let contextMap: any = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    contextMap = useMap();
  } catch {
    contextMap = null;
  }
  return overrideMap ?? contextMap;
}

/**
 * Route rendering component displaying multi-stop optimized routes
 * and standard custom navigation routes. Automatically handles WebGL context loss
 * and restoration during mobile tab switching cycles without manual page refreshes.
 */
export const MapRouteLayer = memo(function MapRouteLayer({
  routes = [],
  optimizedRoute = null,
  travelProfile = "walking",
  canvas: canvasProp = null,
  map: mapProp = null,
  routeGeoJson = null,
  vectorTileLayers = [],
  onContextLost,
  onContextRestored,
  onVisibilityChange,
}: MapRouteLayerProps) {
  const map = useSafeMap(mapProp);
  const [isContextLost, setIsContextLost] = useState<boolean>(false);
  const [restoreCount, setRestoreCount] = useState<number>(0);
  const [recoveryState, setRecoveryState] = useState<
    "active" | "lost" | "restored"
  >("active");
  const needsRebindRef = useRef<boolean>(false);

  const effectiveGeoJson = useMemo(() => {
    return routeGeoJson || routesToGeoJson(routes, optimizedRoute);
  }, [routeGeoJson, routes, optimizedRoute]);

  // Listen for WebGL context lost & restored on the canvas
  useEffect(() => {
    const targetCanvas =
      canvasProp ||
      (map?.getContainer ? map.getContainer()?.querySelector("canvas") : null);

    if (!targetCanvas) return;

    const handleContextLost = (e: Event) => {
      // AC 1: Prevent default on webglcontextlost to allow browser recovery
      e.preventDefault();
      setIsContextLost(true);
      setRecoveryState("lost");
      needsRebindRef.current = true;
      onContextLost?.();
    };

    const handleContextRestored = () => {
      setIsContextLost(false);
      setRecoveryState("restored");

      // Recreate shaders & WebGL buffers cleanly upon restoration
      try {
        const gl =
          (targetCanvas.getContext(
            "webgl2",
          ) as WebGL2RenderingContext | null) ||
          (targetCanvas.getContext("webgl") as WebGLRenderingContext | null);
        if (gl) {
          recreateRouteBuffers(gl, routes, optimizedRoute, targetCanvas);
        }
      } catch (err) {
        console.warn("[MapRouteLayer] Buffer recreation fallback:", err);
      }

      // AC 2: Re-bind vector tile layers and route geojson datasets upon webglcontextrestored
      if (map) {
        rebindVectorTileLayers(map, vectorTileLayers);
        rebindRouteGeoJson(map, effectiveGeoJson);
        map.invalidateSize?.();
      }

      needsRebindRef.current = false;
      setRestoreCount((prev) => prev + 1);
      onContextRestored?.();
    };

    targetCanvas.addEventListener("webglcontextlost", handleContextLost, false);
    targetCanvas.addEventListener(
      "webglcontextrestored",
      handleContextRestored,
      false,
    );

    return () => {
      targetCanvas.removeEventListener("webglcontextlost", handleContextLost);
      targetCanvas.removeEventListener(
        "webglcontextrestored",
        handleContextRestored,
      );
    };
  }, [
    canvasProp,
    map,
    routes,
    optimizedRoute,
    vectorTileLayers,
    effectiveGeoJson,
    onContextLost,
    onContextRestored,
  ]);

  // AC 3: Background/foreground tab switching cycle on mobile viewports
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isVisible =
        typeof document !== "undefined"
          ? document.visibilityState === "visible"
          : true;

      onVisibilityChange?.(isVisible);

      if (isVisible) {
        // Tab returned to foreground
        if (isContextLost || needsRebindRef.current) {
          if (map) {
            rebindVectorTileLayers(map, vectorTileLayers);
            rebindRouteGeoJson(map, effectiveGeoJson);
            map.invalidateSize?.();
          }
          needsRebindRef.current = false;
          setRestoreCount((prev) => prev + 1);
        }
      } else {
        // Tab backgrounded
        needsRebindRef.current = true;
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("pageshow", handleVisibilityChange);
    }

    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("pageshow", handleVisibilityChange);
      }
    };
  }, [
    map,
    isContextLost,
    vectorTileLayers,
    effectiveGeoJson,
    onVisibilityChange,
  ]);

  return (
    <div
      data-testid="map-route-layer"
      data-context-lost={isContextLost ? "true" : "false"}
      data-restore-count={restoreCount}
      data-recovery-state={recoveryState}
      style={{ display: "contents" }}
    >
      {/* Context lost recovery overlay */}
      {isContextLost && (
        <div
          data-testid="map-route-context-lost"
          role="status"
          aria-live="polite"
          className="absolute inset-0 z-[500] pointer-events-none flex items-center justify-center bg-slate-900/60 backdrop-blur-sm text-xs font-medium text-amber-300"
        >
          Recovering WebGL graphics context...
        </div>
      )}

      {/* Render OSRM Optimized Multi-Stop Routing Layer Geometry */}
      {!isContextLost &&
        optimizedRoute &&
        optimizedRoute.coordinates &&
        optimizedRoute.coordinates.length > 1 && (
          <Polyline
            key={`optimized-${restoreCount}`}
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
      {!isContextLost &&
        routes.map((route) => {
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
              key={`${route.id}-${restoreCount}`}
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
    </div>
  );
});

export default MapRouteLayer;
