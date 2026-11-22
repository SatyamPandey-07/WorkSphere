'use client';

import React from 'react';

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
}) => {
  const estimates = getVenueTravelEstimates(userLocation, venue);

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
    </article>
  );
};