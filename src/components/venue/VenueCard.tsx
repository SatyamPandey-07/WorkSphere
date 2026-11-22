'use client';

import React, { useEffect, useState } from 'react';

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

export interface ShortcutTooltipProps {
  label: string;
  shortcut?: string | null;
  children: React.ReactElement;
}

export const ShortcutTooltip: React.FC<ShortcutTooltipProps> = ({
  label,
  shortcut,
  children,
}) => {
  const [visible, setVisible] = useState(false);
  const normalizedShortcut =
    typeof shortcut === 'string' && shortcut.trim().length > 0
      ? shortcut.trim().toUpperCase()
      : null;

  if (!normalizedShortcut) {
    return children;
  }

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          data-testid="shortcut-tooltip"
          className="pointer-events-none absolute -top-9 right-0 z-30 inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-slate-900 px-2.5 py-1 text-xs font-medium text-white shadow-md dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        >
          <span>{label}</span>
          <kbd className="rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-100 dark:border-slate-500 dark:bg-slate-700">
            {normalizedShortcut}
          </kbd>
        </span>
      )}
    </span>
  );
};

export interface VenueCardProps {
  venue: VenueCardData;
  userLocation?: Coordinates | null;
  onSelect?: (venue: VenueCardData) => void;
  onBookNow?: (venue: VenueCardData) => void;
  bookingHotkey?: string | null;
  isKeyboardNavigationActive?: boolean;
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

export function normalizeBookingHotkey(hotkey: string | null | undefined): string | null {
  if (hotkey === null) return null;
  if (hotkey === undefined) return 'B';
  const trimmed = hotkey.trim();
  return trimmed.length > 0 ? trimmed.toUpperCase() : null;
}

export const VenueCard: React.FC<VenueCardProps> = ({
  venue,
  userLocation,
  onSelect,
  onBookNow,
  bookingHotkey = 'B',
  isKeyboardNavigationActive,
  className = '',
}) => {
  const [detectedKeyboardNav, setDetectedKeyboardNav] = useState(false);

  useEffect(() => {
    if (typeof isKeyboardNavigationActive === 'boolean') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.key.startsWith('Arrow')) {
        setDetectedKeyboardNav(true);
      }
    };
    const handlePointerDown = () => {
      setDetectedKeyboardNav(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isKeyboardNavigationActive]);

  const estimates = getVenueTravelEstimates(userLocation, venue);
  const activeHotkey = normalizeBookingHotkey(bookingHotkey);
  const showKeyboardBadge =
    Boolean(activeHotkey) &&
    (typeof isKeyboardNavigationActive === 'boolean'
      ? isKeyboardNavigationActive
      : detectedKeyboardNav);

  const bookButton = (
    <button
      type="button"
      data-testid="venue-book-now-btn"
      aria-keyshortcuts={activeHotkey ?? undefined}
      onClick={(e) => {
        e.stopPropagation();
        onBookNow?.(venue);
      }}
      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400"
    >
      <span>Book now</span>
      {showKeyboardBadge && activeHotkey && (
        <kbd
          data-testid="venue-book-hotkey-badge"
          className="rounded border border-indigo-300/60 bg-indigo-700/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-50 dark:border-indigo-200/50 dark:bg-indigo-600"
        >
          [{activeHotkey}]
        </kbd>
      )}
    </button>
  );

  return (
    <article
      data-testid={`venue-card-${venue.id}`}
      onClick={onSelect ? () => onSelect(venue) : undefined}
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 ${
        onSelect ? 'cursor-pointer' : ''
      } ${className}`.trim()}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {venue.name}
        </h3>

        <ShortcutTooltip label="Book now" shortcut={activeHotkey}>
          {bookButton}
        </ShortcutTooltip>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
        <span data-testid="venue-address">{venue.address}</span>

        {estimates && (
          <div
            data-testid="venue-travel-chips"
            className="inline-flex flex-wrap items-center gap-1.5"
          >
            <span
              data-testid="venue-walk-chip"
              className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
            >
              <span aria-hidden="true">🚶</span>
              <span>{estimates.walkLabel}</span>
            </span>
            <span
              data-testid="venue-transit-chip"
              className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
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