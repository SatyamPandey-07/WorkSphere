'use client';

import React, { memo, useState, useMemo, useCallback } from 'react';
import {
  clusterVenuesByH3Resolution,
  hexClustersToGeoJson,
  zoomToH3Resolution,
  type BoundingBox,
  type GeoCoordinate,
  type HexGeoJsonFeatureCollection,
  type HexVenueCluster,
  type VenueCandidate,
} from '@/lib/geospatial/spatialVenueClusterer';

export interface ViewportState {
  bbox?: BoundingBox;
  zoom: number;
  center?: GeoCoordinate;
}

export type HexColorMetric = 'density' | 'wifi' | 'quiet' | 'seats';

export interface VenueHexMapLayerProps {
  venues: readonly VenueCandidate[];
  viewport?: ViewportState;
  resolution?: number; // 7, 8, 9 override
  metricColorBy?: HexColorMetric;
  onHoverCluster?: (cluster: HexVenueCluster | null) => void;
  onClickCluster?: (cluster: HexVenueCluster) => void;
  onSelectVenue?: (venue: VenueCandidate) => void;
  width?: number | string;
  height?: number | string;
  className?: string;
  showLabels?: boolean;
  showLegend?: boolean;
  'data-testid'?: string;
}

function getMetricValue(cluster: HexVenueCluster, metric: HexColorMetric): number {
  switch (metric) {
    case 'density':
      return cluster.density;
    case 'wifi':
      return cluster.avgWifiMbps;
    case 'quiet':
      return cluster.avgQuietScore;
    case 'seats':
      return cluster.totalAvailableSeats;
  }
}

function getHexColor(
  cluster: HexVenueCluster,
  metric: HexColorMetric,
  maxMetricVal: number,
  isHovered: boolean
): { fill: string; fillOpacity: number; stroke: string; strokeWidth: number } {
  const val = getMetricValue(cluster, metric);
  const ratio = maxMetricVal > 0 ? Math.min(1, Math.max(0.1, val / maxMetricVal)) : 0.5;

  let baseFill = '#4f46e5'; // indigo
  if (metric === 'wifi') {
    // Green / Emerald ramp
    baseFill = ratio > 0.6 ? '#10b981' : ratio > 0.3 ? '#f59e0b' : '#ef4444';
  } else if (metric === 'quiet') {
    // Purple / Teal ramp
    baseFill = ratio > 0.7 ? '#06b6d4' : ratio > 0.4 ? '#8b5cf6' : '#64748b';
  } else if (metric === 'density') {
    // Density heatmap ramp (Indigo to Crimson)
    baseFill = ratio > 0.7 ? '#e11d48' : ratio > 0.35 ? '#8b5cf6' : '#6366f1';
  } else if (metric === 'seats') {
    // Cyan / Blue ramp
    baseFill = ratio > 0.6 ? '#0284c7' : ratio > 0.3 ? '#3b82f6' : '#94a3b8';
  }

  return {
    fill: baseFill,
    fillOpacity: isHovered ? 0.85 : 0.35 + ratio * 0.4,
    stroke: isHovered ? '#ffffff' : baseFill,
    strokeWidth: isHovered ? 2.5 : 1.2,
  };
}

export const VenueHexMapLayer = memo(function VenueHexMapLayer({
  venues,
  viewport,
  resolution: forcedResolution,
  metricColorBy = 'density',
  onHoverCluster,
  onClickCluster,
  onSelectVenue,
  width = '100%',
  height = 420,
  className = '',
  showLabels = true,
  showLegend = true,
  'data-testid': testIdOverride = 'venue-hex-map-layer',
}: VenueHexMapLayerProps) {
  const [hoveredClusterId, setHoveredClusterId] = useState<string | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  // Derive H3 resolution based on zoom or override
  const activeResolution = useMemo(() => {
    if (typeof forcedResolution === 'number') return forcedResolution;
    if (viewport?.zoom !== undefined) return zoomToH3Resolution(viewport.zoom);
    return 8;
  }, [forcedResolution, viewport?.zoom]);

  // Cluster venues within bounding box dynamically
  const clusters = useMemo(() => {
    return clusterVenuesByH3Resolution(venues, {
      resolution: activeResolution,
      bbox: viewport?.bbox,
      zoom: viewport?.zoom,
    });
  }, [venues, activeResolution, viewport?.bbox, viewport?.zoom]);

  const activeCluster = useMemo(
    () => clusters.find((c) => c.cellId === hoveredClusterId) || null,
    [clusters, hoveredClusterId]
  );

  const selectedCluster = useMemo(
    () => clusters.find((c) => c.cellId === selectedClusterId) || null,
    [clusters, selectedClusterId]
  );

  // Maximum metric value for scaling colors
  const maxMetric = useMemo(() => {
    if (clusters.length === 0) return 1;
    return Math.max(...clusters.map((c) => getMetricValue(c, metricColorBy)), 1);
  }, [clusters, metricColorBy]);

  // Calculate SVG projection bounds
  const svgBounds = useMemo(() => {
    const svgW = 800;
    const svgH = 450;

    if (viewport?.bbox) {
      return {
        minLng: viewport.bbox.minLng,
        maxLng: viewport.bbox.maxLng,
        minLat: viewport.bbox.minLat,
        maxLat: viewport.bbox.maxLat,
        svgW,
        svgH,
      };
    }

    if (clusters.length === 0) {
      return { minLng: 72.8, maxLng: 73.0, minLat: 19.0, maxLat: 19.2, svgW, svgH };
    }

    let minLat = Number.POSITIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;
    let minLng = Number.POSITIVE_INFINITY;
    let maxLng = Number.NEGATIVE_INFINITY;

    for (const c of clusters) {
      for (const pt of c.boundary) {
        if (pt.lat < minLat) minLat = pt.lat;
        if (pt.lat > maxLat) maxLat = pt.lat;
        if (pt.lng < minLng) minLng = pt.lng;
        if (pt.lng > maxLng) maxLng = pt.lng;
      }
    }

    const latPadding = Math.max((maxLat - minLat) * 0.1, 0.005);
    const lngPadding = Math.max((maxLng - minLng) * 0.1, 0.005);

    return {
      minLat: minLat - latPadding,
      maxLat: maxLat + latPadding,
      minLng: minLng - lngPadding,
      maxLng: maxLng + lngPadding,
      svgW,
      svgH,
    };
  }, [viewport?.bbox, clusters]);

  // Project lat/lng coordinate into SVG pixel plane
  const project = useCallback(
    (coord: GeoCoordinate): [number, number] => {
      const { minLng, maxLng, minLat, maxLat, svgW, svgH } = svgBounds;
      const lngSpan = maxLng - minLng || 0.001;
      const latSpan = maxLat - minLat || 0.001;

      const x = ((coord.lng - minLng) / lngSpan) * svgW;
      const y = ((maxLat - coord.lat) / latSpan) * svgH;
      return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    },
    [svgBounds]
  );

  const handleMouseEnterHex = (cluster: HexVenueCluster, e: React.MouseEvent) => {
    setHoveredClusterId(cluster.cellId);
    setMousePos({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
    onHoverCluster?.(cluster);
  };

  const handleMouseMoveHex = (e: React.MouseEvent) => {
    setMousePos({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
  };

  const handleMouseLeaveHex = () => {
    setHoveredClusterId(null);
    setMousePos(null);
    onHoverCluster?.(null);
  };

  const handleClickHex = (cluster: HexVenueCluster) => {
    setSelectedClusterId((prev) => (prev === cluster.cellId ? null : cluster.cellId));
    onClickCluster?.(cluster);
  };

  return (
    <div
      data-testid={testIdOverride}
      className={`relative flex flex-col rounded-2xl border border-slate-200 bg-slate-900 p-4 text-slate-100 shadow-xl overflow-hidden ${className}`}
      style={{ width, height: typeof height === 'number' ? `${height}px` : height }}
    >
      {/* Top Header / Status bar */}
      <div className="mb-2 flex items-center justify-between text-xs z-10">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-md bg-indigo-500/20 px-2 py-0.5 font-semibold text-indigo-400">
            H3 Res {activeResolution}
          </span>
          <span className="text-slate-400">
            {clusters.length} active cell{clusters.length === 1 ? '' : 's'} · {venues.length} venues
          </span>
        </div>
        {viewport?.zoom !== undefined && (
          <span className="text-slate-400">Zoom: {viewport.zoom.toFixed(1)}</span>
        )}
      </div>

      {/* SVG Map Canvas */}
      <div className="relative flex-1 w-full h-full min-h-[220px]">
        {clusters.length === 0 ? (
          <div
            data-testid="hex-empty-state"
            className="flex h-full w-full items-center justify-center text-sm text-slate-400"
          >
            No venues found in current viewport
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${svgBounds.svgW} ${svgBounds.svgH}`}
            className="w-full h-full select-none"
            preserveAspectRatio="xMidYMid meet"
            data-testid="hex-svg-canvas"
          >
            {/* Draw Hexagons */}
            {clusters.map((cluster) => {
              const isHovered = hoveredClusterId === cluster.cellId;
              const isSelected = selectedClusterId === cluster.cellId;
              const style = getHexColor(cluster, metricColorBy, maxMetric, isHovered || isSelected);

              const pointsString = cluster.boundary
                .map((pt) => {
                  const [px, py] = project(pt);
                  return `${px},${py}`;
                })
                .join(' ');

              const [cx, cy] = project(cluster.center);

              return (
                <g key={cluster.cellId} className="cursor-pointer transition-all duration-150">
                  <polygon
                    data-testid={`hex-polygon-${cluster.cellId}`}
                    points={pointsString}
                    fill={style.fill}
                    fillOpacity={style.fillOpacity}
                    stroke={isSelected ? '#facc15' : style.stroke}
                    strokeWidth={isSelected ? 3 : style.strokeWidth}
                    onMouseEnter={(e) => handleMouseEnterHex(cluster, e)}
                    onMouseMove={handleMouseMoveHex}
                    onMouseLeave={handleMouseLeaveHex}
                    onClick={() => handleClickHex(cluster)}
                  />

                  {/* Hexagon label showing venue count */}
                  {showLabels && (
                    <text
                      data-testid={`hex-label-${cluster.cellId}`}
                      x={cx}
                      y={cy + 4}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="11"
                      fontWeight="bold"
                      className="pointer-events-none drop-shadow-md"
                    >
                      {cluster.venueCount}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {/* Hover Tooltip Popup */}
        {activeCluster && mousePos && (
          <div
            data-testid="hex-tooltip"
            className="pointer-events-none absolute z-30 min-w-[190px] rounded-lg border border-slate-700 bg-slate-950/95 p-2.5 text-xs shadow-2xl backdrop-blur-md"
            style={{
              left: Math.min(mousePos.x + 12, 580),
              top: Math.min(mousePos.y + 12, 340),
            }}
          >
            <div className="font-bold text-indigo-300">
              {activeCluster.cellId} (Res {activeCluster.resolution})
            </div>
            <div className="mt-1 space-y-0.5 text-slate-300">
              <div className="flex justify-between">
                <span>Venues:</span>
                <span className="font-semibold text-white">{activeCluster.venueCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Density:</span>
                <span className="font-semibold text-white">{activeCluster.density} / km²</span>
              </div>
              <div className="flex justify-between">
                <span>Avg WiFi:</span>
                <span className="font-semibold text-emerald-400">
                  {activeCluster.avgWifiMbps} Mbps
                </span>
              </div>
              <div className="flex justify-between">
                <span>Quiet Score:</span>
                <span className="font-semibold text-cyan-400">
                  {activeCluster.avgQuietScore}/100
                </span>
              </div>
              <div className="flex justify-between">
                <span>Open Seats:</span>
                <span className="font-semibold text-white">
                  {activeCluster.totalAvailableSeats}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Selected Cluster Venue List Drawer */}
      {selectedCluster && (
        <div
          data-testid="hex-details-panel"
          className="mt-2 rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-xs"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div>
              <span className="font-bold text-white">{selectedCluster.cellId}</span>
              <span className="ml-2 text-slate-400">
                ({selectedCluster.venues.length} venues in hex)
              </span>
            </div>
            <button
              type="button"
              data-testid="close-hex-details-btn"
              onClick={() => setSelectedClusterId(null)}
              className="text-slate-400 hover:text-white"
            >
              ✕
            </button>
          </div>

          <div className="mt-2 max-h-32 overflow-y-auto space-y-1.5">
            {selectedCluster.venues.map((v) => (
              <div
                key={v.id}
                data-testid={`venue-item-${v.id}`}
                className="flex items-center justify-between rounded-lg bg-slate-900/90 p-2 border border-slate-800/60"
              >
                <div>
                  <div className="font-medium text-slate-200">{v.name}</div>
                  <div className="text-[10px] text-slate-400">
                    WiFi: {v.wifiMbps ?? '--'} Mbps · Seats: {v.availableSeats}
                    {v.quietScore !== undefined && ` · Quiet: ${v.quietScore}/100`}
                  </div>
                </div>

                {onSelectVenue && (
                  <button
                    type="button"
                    data-testid={`select-venue-${v.id}`}
                    onClick={() => onSelectVenue(v)}
                    className="rounded bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500"
                  >
                    Select
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metric Color Legend */}
      {showLegend && (
        <div
          data-testid="hex-legend"
          className="mt-2 flex items-center justify-between border-t border-slate-800 pt-2 text-[10px] text-slate-400"
        >
          <span>Color: {metricColorBy.toUpperCase()}</span>
          <div className="flex items-center gap-1.5">
            <span>Low</span>
            <span className="h-2 w-16 rounded bg-gradient-to-r from-indigo-500/30 to-indigo-500" />
            <span>High</span>
          </div>
        </div>
      )}
    </div>
  );
});

// Export helper to allow MapLibre GeoJSON layer integration
export const toHexGeoJsonFeatureCollection = hexClustersToGeoJson;

export default VenueHexMapLayer;
