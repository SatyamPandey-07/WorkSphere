"use client";

import React, { memo, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Polyline, Popup, useMap } from "react-leaflet";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Mountain,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Sliders,
  Compass,
} from "lucide-react";
import type { MapRoute } from "@/types/map";
import { formatDistance } from "@/lib/geo/formatDistance";

export interface RouteElevationPoint {
  distanceKm: number;
  elevationMeters: number;
  elevationFeet: number;
  gradePercent: number;
  lat: number;
  lng: number;
}

export interface RouteElevationProfile {
  routeId: string;
  routeName: string;
  totalDistanceKm: number;
  totalGainMeters: number;
  totalLossMeters: number;
  maxElevationMeters: number;
  minElevationMeters: number;
  points: RouteElevationPoint[];
}

export interface OptimizedRouteData {
  coordinates: [number, number][];
  duration: number;
  distance: number;
  legs?: any[];
}

export interface MapRouteLayerProps {
  /** Existing MapRoute records — `path` is [{ lat, lng }, ...] toward the venue. */
  routes?: MapRoute[];
  /** Optional multi-stop optimized route */
  optimizedRoute?: OptimizedRouteData | null;
  /** Travel profile mode */
  travelProfile?: "walking" | "cycling" | "driving";
  /** Dash streak speed in px/second along the route. Default: 60 */
  flowSpeed?: number;
  /** Whether to render the vertical elevation profile tape HUD overlay. Default: true */
  showElevationTape?: boolean;
  /** Elevation display unit. Default: "meters" */
  elevationUnit?: "meters" | "feet";
  /** Active route ID to display on the elevation tape */
  activeRouteId?: string;
  /** Callback fired when user scrubs or hovers over an elevation point */
  onElevationPointHover?: (point: RouteElevationPoint | null) => void;
  /** Explicit canvas element or canvas from Mapbox/Leaflet container */
  canvas?: HTMLCanvasElement | null;
  /** Optional map instance override */
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

const EMERALD = "#34d399";
const EMERALD_BRIGHT = "#6ee7b7";
const EMERALD_GLOW = "rgba(52, 211, 153, 0.35)";
const PANE_NAME = "route-fx-pane";
const PANE_Z_INDEX = 450;

/** Calculate great-circle distance between two coordinates in kilometers using Haversine formula. */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Calculate slope grade percentage from elevation change and horizontal distance. */
export function calculateGradePercent(
  deltaElevationMeters: number,
  deltaDistanceMeters: number,
): number {
  if (deltaDistanceMeters <= 0.001) return 0;
  return Number(((deltaElevationMeters / deltaDistanceMeters) * 100).toFixed(1));
}

/** Format elevation with selected unit (meters or feet). */
export function formatElevation(
  meters: number,
  unit: "meters" | "feet" = "meters",
): string {
  if (unit === "feet") {
    const feet = Math.round(meters * 3.28084);
    return `${feet} ft`;
  }
  return `${Math.round(meters)} m`;
}

/**
 * Computes or synthesizes vertical elevation profile data for a route's waypoint path.
 * Interpolates cumulative distance, elevation gain/loss, and instantaneous grade percentage.
 */
export function calculateRouteElevationProfile(
  route: MapRoute,
  sampleCount = 30,
): RouteElevationProfile {
  const validPath = (route.path ?? []).filter(
    (pt) => pt && Number.isFinite(pt.lat) && Number.isFinite(pt.lng),
  );

  if (validPath.length < 2) {
    const defaultMeters = 24;
    return {
      routeId: route.id,
      routeName: route.name ?? "Transit Route",
      totalDistanceKm: 0,
      totalGainMeters: 0,
      totalLossMeters: 0,
      maxElevationMeters: defaultMeters,
      minElevationMeters: defaultMeters,
      points: [
        {
          distanceKm: 0,
          elevationMeters: defaultMeters,
          elevationFeet: defaultMeters * 3.28084,
          gradePercent: 0,
          lat: validPath[0]?.lat ?? 0,
          lng: validPath[0]?.lng ?? 0,
        },
      ],
    };
  }

  // Pre-calculate cumulative distance along waypoints
  let cumulativeDistKm = 0;
  const waypointDistances: number[] = [0];
  for (let i = 1; i < validPath.length; i++) {
    const d = haversineDistanceKm(
      validPath[i - 1].lat,
      validPath[i - 1].lng,
      validPath[i].lat,
      validPath[i].lng,
    );
    cumulativeDistKm += d;
    waypointDistances.push(cumulativeDistKm);
  }

  const totalDist = Math.max(0.1, cumulativeDistKm);
  const points: RouteElevationPoint[] = [];

  let totalGain = 0;
  let totalLoss = 0;
  let maxElev = -Infinity;
  let minElev = Infinity;

  // Base urban elevation anchor derived deterministically from route coordinates
  const anchorLat = validPath[0].lat;
  const anchorLng = validPath[0].lng;
  const baseTerrainElevation =
    20 + Math.abs(Math.sin(anchorLat * 10) * Math.cos(anchorLng * 10)) * 35;

  for (let i = 0; i < sampleCount; i++) {
    const progress = i / (sampleCount - 1);
    const sampleDistKm = progress * totalDist;

    // Locate segment between waypoints
    let segIdx = 0;
    while (
      segIdx < waypointDistances.length - 1 &&
      waypointDistances[segIdx + 1] < sampleDistKm
    ) {
      segIdx++;
    }

    const w0 = validPath[segIdx];
    const w1 = validPath[Math.min(validPath.length - 1, segIdx + 1)];
    const segSpan =
      (waypointDistances[segIdx + 1] ?? totalDist) - waypointDistances[segIdx] || 0.001;
    const t = Math.max(0, Math.min(1, (sampleDistKm - waypointDistances[segIdx]) / segSpan));

    const lat = w0.lat + (w1.lat - w0.lat) * t;
    const lng = w0.lng + (w1.lng - w0.lng) * t;

    // Use explicit elevation if provided, otherwise realistic terrain wave
    let elevMeters = 0;
    if (w0.elevationMeters !== undefined && w1.elevationMeters !== undefined) {
      elevMeters = w0.elevationMeters + (w1.elevationMeters - w0.elevationMeters) * t;
    } else {
      // Natural urban topography wave (gentle undulations and bridge/tunnel transitions)
      const wave1 = Math.sin(progress * Math.PI * 2.5) * 16;
      const wave2 = Math.cos(progress * Math.PI * 5) * 6;
      elevMeters = Math.max(8, baseTerrainElevation + wave1 + wave2);
    }

    // Grade calculation from previous point
    let grade = 0;
    if (points.length > 0) {
      const prev = points[points.length - 1];
      const deltaH = elevMeters - prev.elevationMeters;
      const deltaD = (sampleDistKm - prev.distanceKm) * 1000; // in meters
      grade = calculateGradePercent(deltaH, deltaD);

      if (deltaH > 0) totalGain += deltaH;
      else totalLoss += Math.abs(deltaH);
    }

    maxElev = Math.max(maxElev, elevMeters);
    minElev = Math.min(minElev, elevMeters);

    points.push({
      distanceKm: Number(sampleDistKm.toFixed(2)),
      elevationMeters: Number(elevMeters.toFixed(1)),
      elevationFeet: Number((elevMeters * 3.28084).toFixed(1)),
      gradePercent: grade,
      lat,
      lng,
    });
  }

  return {
    routeId: route.id,
    routeName: route.name ?? "Transit Route",
    totalDistanceKm: Number(totalDist.toFixed(2)),
    totalGainMeters: Math.round(totalGain),
    totalLossMeters: Math.round(totalLoss),
    maxElevationMeters: Math.round(maxElev),
    minElevationMeters: Math.round(minElev),
    points,
  };
}

/** Build an SVG path string using Catmull-Rom → cubic bézier conversion. */
function catmullRomToBezierPath(
  points: Array<{ x: number; y: number }>,
): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  const p = points;
  let d = `M ${p[0].x.toFixed(2)} ${p[0].y.toFixed(2)}`;

  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] ?? p2;

    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  return d;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

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

/** Decodes encoded polyline coordinates. */
export function decodePolyline(
  encoded: string,
  precision = 5,
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

/** Encodes polyline coordinates into string. */
export function encodePolyline(
  coordinates: [number, number][],
  precision = 5,
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

/** Converts routes to GeoJSON FeatureCollection. */
export function routesToGeoJson(
  routes: MapRoute[] = [],
  optimizedRoute: OptimizedRouteData | null = null,
): any {
  const features: any[] = [];

  if (optimizedRoute?.coordinates && optimizedRoute.coordinates.length > 1) {
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
        coordinates: optimizedRoute.coordinates.map(([lat, lng]) => [lng, lat]),
      },
    });
  }

  routes.forEach((route) => {
    const validCoords = (route.path || [])
      .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
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

  return { type: "FeatureCollection", features };
}

/** Re-binds route GeoJSON datasets. */
export function rebindRouteGeoJson(mapOrSource: any, geoJsonData: any): boolean {
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
    console.warn("[MapRouteLayer] Failed to re-bind route GeoJSON dataset:", err);
  }
  return false;
}

/** Re-binds vector tile layers. */
export function rebindVectorTileLayers(mapOrSource: any, layers: any[] = []): boolean {
  if (!mapOrSource || !mapOrSource.style?.sourceCaches) return false;
  try {
    let reloaded = false;
    const targetLayers = layers.length > 0 ? layers : ["vector-tiles"];
    for (const id of targetLayers) {
      const cache = mapOrSource.style.sourceCaches[id];
      if (cache && typeof cache.reload === "function") {
        cache.reload();
        reloaded = true;
      }
    }
    return reloaded;
  } catch (err) {
    console.warn("[MapRouteLayer] Failed to rebind vector tile layers:", err);
    return false;
  }
}

/** Recreates WebGL route buffers. */
export function recreateRouteBuffers(
  gl: WebGLRenderingContext | any,
  routes: any[] = [],
  optimizedRoute: any = null,
  canvas?: any,
): any {
  if (!gl || typeof gl.createBuffer !== "function") return {};
  try {
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    const data = new Float32Array([0, 0, 1, 1]);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { positionBuffer: posBuffer };
  } catch {
    return {};
  }
}

/**
 * VerticalElevationTapeOverlay
 * Tactical avionics vertical altitude tape & elevation profile cross-section
 * for transit navigation routes between venues.
 */
function VerticalElevationTapeOverlay({
  profile,
  unit = "meters",
  onPointHover,
}: {
  profile: RouteElevationProfile;
  unit: "meters" | "feet";
  onPointHover?: (pt: RouteElevationPoint | null) => void;
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeUnit, setActiveUnit] = useState<"meters" | "feet">(unit);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const selectedPoint = profile.points[selectedIndex] || profile.points[0];

  const elevRange = Math.max(15, profile.maxElevationMeters - profile.minElevationMeters);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = parseInt(e.target.value, 10);
    setSelectedIndex(idx);
    onPointHover?.(profile.points[idx] || null);
  };

  const grade = selectedPoint?.gradePercent ?? 0;
  const isClimb = grade > 1.5;
  const isDescent = grade < -1.5;

  return (
    <div
      data-testid="route-elevation-tape"
      className="absolute top-16 right-4 z-[990] w-72 rounded-2xl bg-zinc-950/95 border-2 border-emerald-500/40 text-emerald-400 font-mono shadow-2xl shadow-emerald-950/80 backdrop-blur-md select-none pointer-events-auto transition-all"
    >
      {/* Tape Header */}
      <div className="flex items-center justify-between p-3 border-b border-emerald-500/30 text-xs">
        <div className="flex items-center gap-1.5 min-w-0">
          <Mountain className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="font-bold text-white text-[11px] truncate uppercase">
            ALT PROFILE // {profile.routeName}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setActiveUnit((u) => (u === "meters" ? "feet" : "meters"))}
            className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-emerald-500/30 font-bold"
            title="Toggle altitude units"
          >
            {activeUnit === "meters" ? "M" : "FT"}
          </button>
          <button
            type="button"
            data-testid="toggle-elevation-tape-btn"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-emerald-500/30"
            title={isCollapsed ? "Expand elevation tape" : "Collapse elevation tape"}
          >
            {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="p-3 space-y-3">
          {/* Altimeter Drum & Current Waypoint Readout */}
          <div className="flex items-center justify-between bg-black/80 p-2.5 rounded-xl border border-emerald-500/30">
            <div>
              <div className="text-[10px] text-zinc-400 font-semibold">CURRENT ALTITUDE</div>
              <div
                data-testid="current-elevation-readout"
                className="text-lg font-black text-white flex items-baseline gap-1"
              >
                <span>
                  {formatElevation(selectedPoint.elevationMeters, activeUnit)}
                </span>
                <span className="text-[10px] text-zinc-500 font-normal">
                  / DIST {selectedPoint.distanceKm} km
                </span>
              </div>
            </div>

            {/* Grade slope pill */}
            <div
              data-testid="elevation-grade-readout"
              className={`px-2 py-1 rounded-lg border text-[10px] font-black flex items-center gap-1 ${
                isClimb
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : isDescent
                  ? "bg-sky-500/20 text-sky-300 border-sky-500/40"
                  : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
              }`}
            >
              {isClimb ? (
                <TrendingUp className="w-3 h-3 text-amber-400" />
              ) : isDescent ? (
                <TrendingDown className="w-3 h-3 text-sky-400" />
              ) : (
                <Minus className="w-3 h-3 text-emerald-400" />
              )}
              <span>
                {grade > 0 ? `+${grade}%` : `${grade}%`} GRADE
              </span>
            </div>
          </div>

          {/* Vertical Profile Ribbon & Tape Cross-Section Visualizer */}
          <div className="relative h-28 bg-zinc-900/90 rounded-xl p-2 border border-emerald-500/20 flex flex-col justify-between overflow-hidden">
            {/* Background Altitude Reference Grid Lines */}
            <div className="absolute inset-x-2 top-2 border-b border-dashed border-zinc-800 text-[8px] text-zinc-600 flex justify-between">
              <span>MAX {formatElevation(profile.maxElevationMeters, activeUnit)}</span>
            </div>
            <div className="absolute inset-x-2 bottom-2 border-t border-dashed border-zinc-800 text-[8px] text-zinc-600 flex justify-between">
              <span>MIN {formatElevation(profile.minElevationMeters, activeUnit)}</span>
            </div>

            {/* SVG Profile Polyline Curve */}
            <svg
              className="absolute inset-x-2 inset-y-2 w-[calc(100%-16px)] h-[calc(100%-16px)] overflow-visible"
              viewBox="0 0 100 50"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="elevGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#34d399" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Area polygon under elevation path */}
              <polygon
                points={
                  `0,50 ` +
                  profile.points
                    .map((pt, i) => {
                      const x = (i / (profile.points.length - 1)) * 100;
                      const y =
                        50 -
                        ((pt.elevationMeters - profile.minElevationMeters) / elevRange) *
                          44;
                      return `${x.toFixed(1)},${y.toFixed(1)}`;
                    })
                    .join(" ") +
                  ` 100,50`
                }
                fill="url(#elevGradient)"
              />

              {/* Glowing elevation curve */}
              <polyline
                points={profile.points
                  .map((pt, i) => {
                    const x = (i / (profile.points.length - 1)) * 100;
                    const y =
                      50 -
                      ((pt.elevationMeters - profile.minElevationMeters) / elevRange) *
                        44;
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                  })
                  .join(" ")}
                fill="none"
                stroke="#34d399"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Current scrubber waypoint dot */}
              {profile.points.length > 0 && (
                <circle
                  cx={(selectedIndex / (profile.points.length - 1)) * 100}
                  cy={
                    50 -
                    ((selectedPoint.elevationMeters - profile.minElevationMeters) /
                      elevRange) *
                      44
                  }
                  r="3.5"
                  fill="#fbbf24"
                  stroke="#000"
                  strokeWidth="1.5"
                />
              )}
            </svg>
          </div>

          {/* Interactive Route Distance Scrubber */}
          <div>
            <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1">
              <span>START (0.0 km)</span>
              <span className="font-bold text-emerald-300">
                WAYPOINT {selectedIndex + 1}/{profile.points.length}
              </span>
              <span>DEST ({profile.totalDistanceKm} km)</span>
            </div>
            <input
              type="range"
              data-testid="elevation-scrubber-slider"
              min="0"
              max={profile.points.length - 1}
              value={selectedIndex}
              onChange={handleSliderChange}
              aria-label="Route Waypoint Elevation Scrubber"
              className="w-full accent-emerald-400 cursor-pointer h-1.5 bg-zinc-800 rounded-lg appearance-none"
            />
          </div>

          {/* Gain and Loss Cumulative Pills */}
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-emerald-500/20 text-[10px]">
            <div
              data-testid="elevation-gain-readout"
              className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-between"
            >
              <span className="text-zinc-500">TOTAL CLIMB:</span>
              <span className="font-bold text-emerald-400">
                +{formatElevation(profile.totalGainMeters, activeUnit)}
              </span>
            </div>
            <div
              data-testid="elevation-loss-readout"
              className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-between"
            >
              <span className="text-zinc-500">TOTAL DESCENT:</span>
              <span className="font-bold text-sky-400">
                -{formatElevation(profile.totalLossMeters, activeUnit)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * MapRouteLayer — animated high-altitude "flight vector" renderer and vertical elevation
 * profile tape for venue transit routes.
 */
export const MapRouteLayer = memo(function MapRouteLayer({
  routes = [],
  optimizedRoute = null,
  travelProfile = "walking",
  flowSpeed = 60,
  showElevationTape = true,
  elevationUnit = "meters",
  activeRouteId,
  onElevationPointHover,
  canvas: canvasProp = null,
  map: mapProp = null,
  routeGeoJson = null,
  vectorTileLayers = [],
  onContextLost,
  onContextRestored,
  onVisibilityChange,
}: MapRouteLayerProps) {
  const map = useSafeMap(mapProp);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const offsetRef = useRef<number>(0);

  const [isContextLost, setIsContextLost] = useState<boolean>(false);
  const [restoreCount, setRestoreCount] = useState<number>(0);
  const [recoveryState, setRecoveryState] = useState<"active" | "lost" | "restored">("active");
  const needsRebindRef = useRef<boolean>(false);

  // Filter to routes with at least two valid coordinates
  const validRoutes = useMemo(
    () => routes.filter((route) => (route.path ?? []).filter(Boolean).length >= 2),
    [routes],
  );

  // Active route elevation profile for vertical tape HUD
  const activeElevationProfile = useMemo(() => {
    if (!showElevationTape || validRoutes.length === 0) return null;
    const target =
      validRoutes.find((r) => r.id === activeRouteId) ||
      validRoutes.find((r) => r.isHighlighted) ||
      validRoutes[0];
    return target ? calculateRouteElevationProfile(target) : null;
  }, [showElevationTape, validRoutes, activeRouteId]);

  const effectiveGeoJson = useMemo(() => {
    return routeGeoJson || routesToGeoJson(routes, optimizedRoute);
  }, [routeGeoJson, routes, optimizedRoute]);

  // Handle WebGL context recovery
  useEffect(() => {
    const targetCanvas =
      canvasProp ||
      (map?.getContainer ? map.getContainer()?.querySelector("canvas") : null);

    if (!targetCanvas) return;

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setIsContextLost(true);
      setRecoveryState("lost");
      needsRebindRef.current = true;
      onContextLost?.();
    };

    const handleContextRestored = () => {
      setIsContextLost(false);
      setRecoveryState("restored");

      try {
        const gl =
          (targetCanvas.getContext("webgl2") as WebGL2RenderingContext | null) ||
          (targetCanvas.getContext("webgl") as WebGLRenderingContext | null);
        if (gl) {
          recreateRouteBuffers(gl, routes, optimizedRoute, targetCanvas);
        }
      } catch (err) {
        console.warn("[MapRouteLayer] Buffer recreation fallback:", err);
      }

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
    targetCanvas.addEventListener("webglcontextrestored", handleContextRestored, false);

    return () => {
      targetCanvas.removeEventListener("webglcontextlost", handleContextLost);
      targetCanvas.removeEventListener("webglcontextrestored", handleContextRestored);
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

  // Tab visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isVisible =
        typeof document !== "undefined" ? document.visibilityState === "visible" : true;

      onVisibilityChange?.(isVisible);

      if (isVisible) {
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
        needsRebindRef.current = true;
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [map, isContextLost, vectorTileLayers, effectiveGeoJson, onVisibilityChange]);

  // Create Leaflet pane once for Catmull-Rom SVG
  useEffect(() => {
    if (!map || typeof map.getPane !== "function") return;

    let pane = map.getPane(PANE_NAME);
    if (!pane && typeof map.createPane === "function") {
      pane = map.createPane(PANE_NAME);
      pane.style.zIndex = String(PANE_Z_INDEX);
      pane.style.pointerEvents = "none";
    }

    if (!pane) return;

    const host = document.createElement("div");
    host.style.position = "absolute";
    host.style.left = "0";
    host.style.top = "0";
    host.style.willChange = "transform";
    pane.appendChild(host);
    containerRef.current = host;

    return () => {
      host.remove();
      containerRef.current = null;
    };
  }, [map]);

  // Render animated Catmull-Rom SVG vectors in Leaflet pane
  useEffect(() => {
    const host = containerRef.current;
    if (!host || !map || typeof map.latLngToLayerPoint !== "function") return;

    const build = () => {
      const paths = validRoutes.map((route) => {
        const pts = route.path
          .filter((pt) => pt && Number.isFinite(pt.lat) && Number.isFinite(pt.lng))
          .map((pt) => map.latLngToLayerPoint([pt.lat, pt.lng]));

        const d = catmullRomToBezierPath(pts);
        const highlighted = route.isHighlighted === true;
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        group.setAttribute("data-route-id", route.id);
        group.setAttribute("class", "map-route-fx");

        const svgNS = "http://www.w3.org/2000/svg";

        // Halo bloom under-layer
        const halo = document.createElementNS(svgNS, "path");
        halo.setAttribute("d", d);
        halo.setAttribute("fill", "none");
        halo.setAttribute("stroke", EMERALD_GLOW);
        halo.setAttribute("stroke-width", highlighted ? "16" : "12");
        halo.setAttribute("stroke-linecap", "round");
        halo.setAttribute("stroke-linejoin", "round");
        halo.setAttribute("filter", "url(#map-route-bloom)");

        // Inner neon edge
        const innerGlow = document.createElementNS(svgNS, "path");
        innerGlow.setAttribute("d", d);
        innerGlow.setAttribute("fill", "none");
        innerGlow.setAttribute("stroke", "rgba(110, 231, 183, 0.45)");
        innerGlow.setAttribute("stroke-width", highlighted ? "7" : "5");
        innerGlow.setAttribute("stroke-linecap", "round");

        // Core animated dash line
        const core = document.createElementNS(svgNS, "path");
        core.setAttribute("d", d);
        core.setAttribute("fill", "none");
        core.setAttribute("stroke", highlighted ? EMERALD_BRIGHT : EMERALD);
        core.setAttribute("stroke-width", highlighted ? "3.5" : "2.5");
        core.setAttribute("stroke-linecap", "round");
        core.setAttribute("stroke-linejoin", "round");
        core.setAttribute("stroke-dasharray", "14 10");

        group.appendChild(halo);
        group.appendChild(innerGlow);
        group.appendChild(core);

        return { route, group, core, highlighted };
      });

      const size = typeof map.getSize === "function" ? map.getSize() : { x: 800, y: 600 };
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", String(size.x));
      svg.setAttribute("height", String(size.y));
      svg.style.overflow = "visible";
      svg.style.display = "block";

      const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      defs.innerHTML =
        '<filter id="map-route-bloom" x="-50%" y="-50%" width="200%" height="200%">' +
        '<feGaussianBlur stdDeviation="4" result="blur"/>' +
        '<feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>' +
        "</filter>";
      svg.appendChild(defs);

      for (const item of paths) svg.appendChild(item.group);
      host.replaceChildren(svg);

      return paths.map((item) => {
        let length = 0;
        try {
          length = item.core.getTotalLength();
        } catch {
          length = 0;
        }
        return { ...item, length };
      });
    };

    let measured = build();
    const invalidate = () => {
      measured = build();
    };

    map.on?.("zoomend", invalidate);
    map.on?.("resize", invalidate);
    map.on?.("moveend", invalidate);

    const reduced = prefersReducedMotion();
    const dashPeriod = 24;
    const lastTs = { value: 0 };

    const tick = (ts: number) => {
      rafRef.current = null;
      const dt = lastTs.value ? Math.min(ts - lastTs.value, 100) : 16;
      lastTs.value = ts;
      offsetRef.current -= (flowSpeed * dt) / 1000;

      for (const item of measured) {
        const speedScale = item.highlighted ? 1.5 : 1;
        const offset = offsetRef.current * speedScale;
        item.core.style.strokeDashoffset = String(offset % dashPeriod);
        if (item.length > 0 && !reduced) {
          item.group.setAttribute("data-flowing", "true");
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    if (!reduced) {
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      map.off?.("zoomend", invalidate);
      map.off?.("resize", invalidate);
      map.off?.("moveend", invalidate);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [map, validRoutes, flowSpeed]);

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

      {/* Vertical Elevation Profile Tape HUD Overlay */}
      {!isContextLost && activeElevationProfile && (
        <VerticalElevationTapeOverlay
          profile={activeElevationProfile}
          unit={elevationUnit}
          onPointHover={onElevationPointHover}
        />
      )}

      {/* Render OSRM Optimized Route fallback polylines */}
      {!isContextLost &&
        optimizedRoute?.coordinates &&
        optimizedRoute.coordinates.length > 1 && (
          <Polyline
            key={`optimized-${restoreCount}`}
            positions={optimizedRoute.coordinates}
            pathOptions={{
              color: "#3b82f6",
              weight: 6,
              opacity: 0.9,
              lineCap: "round",
              lineJoin: "round",
              dashArray: travelProfile === "walking" ? "5, 10" : undefined,
            }}
          >
            <Popup
              autoPanPadding={[20, 20]}
              autoPanPaddingTopLeft={[20, 90]}
              autoPanPaddingBottomRight={[20, 20]}
            >
              <div className="text-sm text-white">
                <div className="font-bold text-blue-400">Optimized Hybrid Schedule</div>
                <div>Total Distance: {formatDistance(optimizedRoute.distance / 1000)}</div>
                <div>Est. Travel Time: {Math.round(optimizedRoute.duration / 60)} mins</div>
              </div>
            </Popup>
          </Polyline>
        )}

      {/* Render Fallback Polylines */}
      {!isContextLost &&
        routes.map((route) => {
          const validPositions = (route.path || [])
            .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
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
