'use client';

import React, { useState, useMemo } from 'react';
import {
  generateWalkingIsochrone,
  IsochronePolygon,
  IsochronePresetMinutes,
  ISOCHRONE_PRESETS,
} from '@/lib/routing/ecoRoutingEngine';
import { useBleProximity, type BleProximityResult } from '@/hooks/useBleProximity';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface VenueCardData {
  id: string;
  name: string;
  address: string;
  lat?: number;
  lng?: number;
  latitude?: number;
  longitude?: number;
  neighborhood?: string;
}

export interface VenueCardProps {
  venue: VenueCardData;
  userLocation?: Coordinates | null;
  onSelect?: (venue: VenueCardData) => void;
  className?: string;
  showIsochroneMap?: boolean;
  enableBleProximity?: boolean;
}

export const WALKING_SPEED_KMH = 4.8;
export const TRANSIT_SPEED_KMH = 20;

export function hasValidCoordinates(
  coord: { lat?: unknown; lng?: unknown } | null | undefined
): coord is Coordinates {
  if (!coord) return false;
  return (
    typeof coord.lat === 'number' &&
    Number.isFinite(coord.lat) &&
    coord.lat >= -90 &&
    coord.lat <= 90 &&
    typeof coord.lng === 'number' &&
    Number.isFinite(coord.lng) &&
    coord.lng >= -180 &&
    coord.lng <= 180
  );
}

export function extractVenueCoordinates(venue: VenueCardData): Coordinates | null {
  const candidate: Coordinates = {
    lat: venue.lat ?? venue.latitude ?? Number.NaN,
    lng: venue.lng ?? venue.longitude ?? Number.NaN,
  };
  return hasValidCoordinates(candidate) ? candidate : null;
}

export function haversineDistanceKm(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function estimateMinutesForSpeed(
  distanceKm: number,
  speedKmh: number
): number {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 0;
  if (!Number.isFinite(speedKmh) || speedKmh <= 0) return 0;
  return Math.max(1, Math.round((distanceKm / speedKmh) * 60));
}

export function formatTravelDuration(totalMinutes: number): string {
  const safeMinutes = Math.max(0, Math.round(totalMinutes));
  if (safeMinutes < 60) {
    return `${safeMinutes} min`;
  }
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

export function getVenueTravelEstimates(
  userLocation: Coordinates | null | undefined,
  venue: VenueCardData
): {
  distanceKm: number;
  walkMinutes: number;
  transitMinutes: number;
  walkLabel: string;
  transitLabel: string;
} | null {
  if (!hasValidCoordinates(userLocation)) return null;
  const venueCoords = extractVenueCoordinates(venue);
  if (!venueCoords) return null;

  const distanceKm = haversineDistanceKm(userLocation, venueCoords);
  const walkMinutes = estimateMinutesForSpeed(distanceKm, WALKING_SPEED_KMH);
  const transitMinutes = estimateMinutesForSpeed(distanceKm, TRANSIT_SPEED_KMH);

  return {
    distanceKm,
    walkMinutes,
    transitMinutes,
    walkLabel: `${formatTravelDuration(walkMinutes)} walk`,
    transitLabel: `${formatTravelDuration(transitMinutes)} transit`,
  };
}

export const VenueCard: React.FC<VenueCardProps> = ({
  venue,
  userLocation,
  onSelect,
  className = '',
  showIsochroneMap = true,
  enableBleProximity = false,
}) => {
  const estimates = getVenueTravelEstimates(userLocation, venue);
  const venueCoords = extractVenueCoordinates(venue);
  const [selectedMinutes, setSelectedMinutes] = useState<IsochronePresetMinutes>(5);

  const bleProximity: BleProximityResult = useBleProximity();

  const hasGps = hasValidCoordinates(userLocation);

  // Generate isochrone polygon when userLocation is available
  const isochrone: IsochronePolygon | null = useMemo(() => {
    if (!hasGps || !userLocation) return null;
    return generateWalkingIsochrone(userLocation, selectedMinutes);
  }, [hasGps, userLocation, selectedMinutes]);

  // Compute SVG viewBox and polygon points to render overlay cleanly with a fixed scale
  const svgMapData = useMemo(() => {
    if (!isochrone || !userLocation) return null;

    const width = 280;
    const height = 140;
    const center = { x: width / 2, y: height / 2 };

    // Standard map projection scale: max 15-min walk is 1.25 km (~0.0112 degrees).
    // Use fixed degrees-per-pixel so that a 5-min, 10-min, and 15-min ring visibly expands.
    const maxSpanDeg = 0.035; // ~3.8 km total viewport span
    const scale = (height - 20) / maxSpanDeg; // pixels per degree

    const toSvgCoords = (pt: { lat: number; lng: number }) => {
      // Longitude correction for latitude cos factor
      const cosLat = Math.cos((userLocation.lat * Math.PI) / 180) || 1;
      const x = center.x + (pt.lng - userLocation.lng) * cosLat * scale;
      const y = center.y - (pt.lat - userLocation.lat) * scale;
      return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    };

    const originSvg = center;
    const venueSvg = venueCoords ? toSvgCoords(venueCoords) : null;
    const polyPoints = isochrone.coordinates
      .map((pt) => {
        const svgPt = toSvgCoords(pt);
        return `${svgPt.x},${svgPt.y}`;
      })
      .join(' ');

    return {
      width,
      height,
      originSvg,
      venueSvg,
      polyPoints,
    };
  }, [isochrone, userLocation, venueCoords]);

  return (
    <article
      data-testid={`venue-card-${venue.id}`}
      onClick={onSelect ? () => onSelect(venue) : undefined}
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 ${
        onSelect ? 'cursor-pointer' : ''
      } ${className}`.trim()}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">{venue.name}</h3>

        {enableBleProximity && (
          <div data-testid="venue-ble-proximity-indicator" className="inline-flex items-center gap-1.5">
            {bleProximity.status === 'nearby' && (
              <span
                data-testid="ble-proximity-nearby-badge"
                className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 animate-pulse"
                title={`Beacon nearby (~${bleProximity.distance}m, ${bleProximity.rssi} dBm)`}
              >
                <span aria-hidden="true">📡</span>
                <span>Nearby ({bleProximity.distance}m)</span>
              </span>
            )}
            {bleProximity.status === 'connected' && bleProximity.distance !== null && (
              <span
                data-testid="ble-proximity-connected-badge"
                className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
                title={`Beacon detected (~${bleProximity.distance}m)`}
              >
                <span aria-hidden="true">📶</span>
                <span>{bleProximity.distance}m away</span>
              </span>
            )}
            {bleProximity.status === 'searching' && (
              <span
                data-testid="ble-proximity-searching-badge"
                className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
              >
                <span aria-hidden="true">⏳</span>
                <span>Searching beacons...</span>
              </span>
            )}
            {bleProximity.status === 'idle' && bleProximity.isSupported && (
              <button
                type="button"
                data-testid="ble-proximity-scan-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  void bleProximity.startScanning();
                }}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition"
                title="Scan for partner hub BLE beacon"
              >
                <span aria-hidden="true">📡</span>
                <span>Detect Beacon</span>
              </button>
            )}
            {!bleProximity.isSupported && (
              <span
                data-testid="ble-proximity-unsupported-badge"
                className="text-[11px] text-slate-400"
                title="BLE proximity is unsupported in this browser"
              >
                BLE unavailable
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span data-testid="venue-address">{venue.address}</span>

        {estimates && (
          <div
            data-testid="venue-travel-chips"
            className="inline-flex flex-wrap items-center gap-1.5"
          >
            <span
              data-testid="venue-walk-chip"
              className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700"
            >
              <span aria-hidden="true">🚶</span>
              <span>{estimates.walkLabel}</span>
            </span>
            <span
              data-testid="venue-transit-chip"
              className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700"
            >
              <span aria-hidden="true">🚇</span>
              <span>{estimates.transitLabel}</span>
            </span>
          </div>
        )}
      </div>

      {showIsochroneMap && (
        <div data-testid="venue-isochrone-section" className="mt-3 border-t border-slate-100 pt-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-semibold text-slate-700 flex items-center gap-1">
              <span>Walking Reach</span>
              {isochrone && (
                <span className="text-[11px] font-normal text-slate-500">
                  (~{isochrone.radiusMeters}m)
                </span>
              )}
            </span>

            {/* Travel-time preset controls */}
            <div
              data-testid="isochrone-preset-controls"
              role="group"
              aria-label="Walking time radius"
              className="inline-flex rounded-lg bg-slate-100 p-0.5"
            >
              {ISOCHRONE_PRESETS.map((preset) => {
                const isSelected = selectedMinutes === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    data-testid={`isochrone-preset-${preset}`}
                    aria-pressed={isSelected}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedMinutes(preset);
                    }}
                    className={`rounded-md px-2 py-0.5 text-xs font-medium transition ${
                      isSelected
                        ? 'bg-white text-emerald-700 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {preset} min
                  </button>
                );
              })}
            </div>
          </div>

          {/* Interactive map display or location message */}
          {hasGps && svgMapData ? (
            <div
              data-testid="venue-isochrone-map"
              className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
            >
              <svg
                viewBox={`0 0 ${svgMapData.width} ${svgMapData.height}`}
                className="w-full h-28 block select-none"
                data-testid="isochrone-svg-overlay"
              >
                {/* Isochrone Polygon Ring */}
                <polygon
                  data-testid="isochrone-polygon"
                  points={svgMapData.polyPoints}
                  fill="rgba(16, 185, 129, 0.18)"
                  stroke="#10b981"
                  strokeWidth="2"
                  strokeDasharray="none"
                />

                {/* User Origin Pin */}
                <circle
                  data-testid="user-location-pin"
                  cx={svgMapData.originSvg.x}
                  cy={svgMapData.originSvg.y}
                  r="5"
                  fill="#059669"
                  stroke="#ffffff"
                  strokeWidth="2"
                />

                {/* Venue Target Pin */}
                {svgMapData.venueSvg && (
                  <g data-testid="venue-location-pin">
                    <circle
                      cx={svgMapData.venueSvg.x}
                      cy={svgMapData.venueSvg.y}
                      r="4"
                      fill="#4f46e5"
                      stroke="#ffffff"
                      strokeWidth="1.5"
                    />
                  </g>
                )}
              </svg>
            </div>
          ) : (
            <div
              data-testid="isochrone-gps-required"
              className="rounded-lg bg-amber-50/80 border border-amber-200/60 p-2 text-xs text-amber-800 flex items-center gap-1.5"
            >
              <span aria-hidden="true">📍</span>
              <span>Location access is required for walking radius overlay.</span>
            </div>
          )}
        </div>
      )}
    </article>
  );
};
