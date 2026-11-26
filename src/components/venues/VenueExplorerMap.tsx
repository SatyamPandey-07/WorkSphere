'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { MapPin, Wifi, Navigation, RotateCcw } from 'lucide-react';

export const MAP_VIEWPORT_DEBOUNCE_MS = 300;
export const BOUNDS_COORD_PRECISION = 5;

export interface MapBoundingBox {
    neLat: number;
    neLng: number;
    swLat: number;
    swLng: number;
}

export interface ExplorerVenueItem {
    id: string;
    name: string;
    address?: string | null;
    latitude: number;
    longitude: number;
    wifiSpeedMbps?: number | null;
    crowdLevel?: 'QUIET' | 'MODERATE' | 'BUSY';
}

export interface VenueExplorerMapProps {
    venues: ExplorerVenueItem[];
    defaultBounds?: MapBoundingBox;
    onBoundsChange?: (bounds: MapBoundingBox) => void;
    onSelectVenue?: (venueId: string) => void;
    className?: string;
}

// Default Pune metro bounding box when no URL bounds are present
export const DEFAULT_CITY_BOUNDS: MapBoundingBox = {
    neLat: 18.565,
    neLng: 73.915,
    swLat: 18.485,
    swLng: 73.765,
};

function parseFiniteCoord(raw: string | null, min: number, max: number): number | null {
    if (raw === null || raw.trim() === '') return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        return null;
    }
    return parsed;
}

/**
 * Parses and validates `neLat`, `neLng`, `swLat`, `swLng` from URLSearchParams,
 * falling back to `fallbackBounds` if any coordinate is missing or out of WGS84 range.
 */
export function parseBoundsFromSearchParams(
    searchParams: Pick<URLSearchParams, 'get'>,
    fallbackBounds: MapBoundingBox = DEFAULT_CITY_BOUNDS
): MapBoundingBox {
    const neLat = parseFiniteCoord(searchParams.get('neLat'), -90, 90);
    const neLng = parseFiniteCoord(searchParams.get('neLng'), -180, 180);
    const swLat = parseFiniteCoord(searchParams.get('swLat'), -90, 90);
    const swLng = parseFiniteCoord(searchParams.get('swLng'), -180, 180);

    if (
        neLat === null ||
        neLng === null ||
        swLat === null ||
        swLng === null ||
        neLat <= swLat
    ) {
        return fallbackBounds;
    }

    return {
        neLat: Number(neLat.toFixed(BOUNDS_COORD_PRECISION)),
        neLng: Number(neLng.toFixed(BOUNDS_COORD_PRECISION)),
        swLat: Number(swLat.toFixed(BOUNDS_COORD_PRECISION)),
        swLng: Number(swLng.toFixed(BOUNDS_COORD_PRECISION)),
    };
}

/**
 * Serializes updated map viewport bounds into a URLSearchParams clone while
 * preserving all existing filter parameters (`minWifiMbps`, `crowdLevel`, `q`, etc.).
 */
export function buildUrlWithViewportBounds(
    pathname: string,
    currentSearchParams: URLSearchParams | Readonly<URLSearchParams>,
    bounds: MapBoundingBox
): string {
    const nextParams = new URLSearchParams(currentSearchParams.toString());

    nextParams.set('neLat', bounds.neLat.toFixed(BOUNDS_COORD_PRECISION));
    nextParams.set('neLng', bounds.neLng.toFixed(BOUNDS_COORD_PRECISION));
    nextParams.set('swLat', bounds.swLat.toFixed(BOUNDS_COORD_PRECISION));
    nextParams.set('swLng', bounds.swLng.toFixed(BOUNDS_COORD_PRECISION));

    const queryString = nextParams.toString();
    return queryString ? `${pathname}?${queryString}` : pathname;
}

export function isSameBoundingBox(a: MapBoundingBox, b: MapBoundingBox): boolean {
    const eps = 1e-5;
    return (
        Math.abs(a.neLat - b.neLat) < eps &&
        Math.abs(a.neLng - b.neLng) < eps &&
        Math.abs(a.swLat - b.swLat) < eps &&
        Math.abs(a.swLng - b.swLng) < eps
    );
}

export function VenueExplorerMap({
    venues,
    defaultBounds = DEFAULT_CITY_BOUNDS,
    onBoundsChange,
    onSelectVenue,
    className = '',
}: VenueExplorerMapProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    // Hydrate initial viewport bounds from URL query params (restored on browser Back navigation)
    const initialBounds = useMemo(
        () => parseBoundsFromSearchParams(searchParams, defaultBounds),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );

    const [bounds, setBounds] = useState<MapBoundingBox>(initialBounds);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastSyncedBoundsRef = useRef<MapBoundingBox>(initialBounds);

    const onBoundsChangeRef = useRef(onBoundsChange);
    onBoundsChangeRef.current = onBoundsChange;

    const latestSearchParamsRef = useRef(searchParams);
    latestSearchParamsRef.current = searchParams;

    // Keep local state synchronized if URL search params change externally (e.g. Back/Forward popstate)
    useEffect(() => {
        const urlBounds = parseBoundsFromSearchParams(searchParams, defaultBounds);
        if (!isSameBoundingBox(urlBounds, lastSyncedBoundsRef.current)) {
            lastSyncedBoundsRef.current = urlBounds;
            setBounds(urlBounds);
            onBoundsChangeRef.current?.(urlBounds);
        }
    }, [searchParams, defaultBounds]);

    // Cleanup pending debounce timer on unmount
    useEffect(() => {
        return () => {
            if (debounceTimerRef.current !== null) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
        };
    }, []);

    /**
     * Handles map `moveend` events by updating local bounds immediately and debouncing
     * URL query synchronization by 300ms via `router.replace(..., { scroll: false })`.
     */
    const handleMapMoveEnd = useCallback(
        (nextRawBounds: MapBoundingBox) => {
            const normalizedBounds: MapBoundingBox = {
                neLat: Number(nextRawBounds.neLat.toFixed(BOUNDS_COORD_PRECISION)),
                neLng: Number(nextRawBounds.neLng.toFixed(BOUNDS_COORD_PRECISION)),
                swLat: Number(nextRawBounds.swLat.toFixed(BOUNDS_COORD_PRECISION)),
                swLng: Number(nextRawBounds.swLng.toFixed(BOUNDS_COORD_PRECISION)),
            };

            setBounds(normalizedBounds);
            onBoundsChangeRef.current?.(normalizedBounds);

            if (debounceTimerRef.current !== null) {
                clearTimeout(debounceTimerRef.current);
            }

            debounceTimerRef.current = setTimeout(() => {
                debounceTimerRef.current = null;

                if (isSameBoundingBox(normalizedBounds, lastSyncedBoundsRef.current)) {
                    return;
                }

                lastSyncedBoundsRef.current = normalizedBounds;
                const nextHref = buildUrlWithViewportBounds(
                    pathname,
                    latestSearchParamsRef.current,
                    normalizedBounds
                );

                router.replace(nextHref, { scroll: false });
            }, MAP_VIEWPORT_DEBOUNCE_MS);
        },
        [pathname, router]
    );

    const handleResetViewport = () => {
        handleMapMoveEnd(defaultBounds);
    };

    const visibleVenues = useMemo(() => {
        return venues.filter(
            (v) =>
                v.latitude <= bounds.neLat &&
                v.latitude >= bounds.swLat &&
                v.longitude <= bounds.neLng &&
                v.longitude >= bounds.swLng
        );
    }, [venues, bounds]);

    const centerLat = ((bounds.neLat + bounds.swLat) / 2).toFixed(4);
    const centerLng = ((bounds.neLng + bounds.swLng) / 2).toFixed(4);

    return (
        <section
            aria-label="Interactive venue map"
            data-testid="venue-explorer-map"
            data-ne-lat={bounds.neLat}
            data-ne-lng={bounds.neLng}
            data-sw-lat={bounds.swLat}
            data-sw-lng={bounds.swLng}
            className={`relative flex flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 ${className}`}
        >
            {/* Viewport Status HUD */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 bg-zinc-900/70 px-4 py-2.5 text-xs">
                <div className="flex items-center gap-2 text-zinc-300">
                    <Navigation className="h-3.5 w-3.5 text-violet-400" />
                    <span className="font-mono" data-testid="map-viewport-center">
                        Center: {centerLat}, {centerLng}
                    </span>
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
                        {visibleVenues.length} in view
                    </span>
                </div>

                <button
                    type="button"
                    onClick={handleResetViewport}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-violet-400"
                >
                    <RotateCcw className="h-3 w-3" />
                    <span>Reset Bounds</span>
                </button>
            </div>

            {/* Interactive Map Canvas / Pin Overlay */}
            <div
                data-testid="map-canvas-surface"
                onDoubleClick={() =>
                    handleMapMoveEnd({
                        neLat: bounds.neLat + 0.005,
                        neLng: bounds.neLng + 0.005,
                        swLat: bounds.swLat + 0.005,
                        swLng: bounds.swLng + 0.005,
                    })
                }
                className="relative min-h-[320px] flex-1 bg-[radial-gradient(circle_at_center,_rgba(139,92,246,0.08),_transparent_70%)] p-4"
            >
                {visibleVenues.length === 0 ? (
                    <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center text-zinc-500">
                        <MapPin className="mb-2 h-6 w-6 text-zinc-600" />
                        <p className="text-xs font-medium text-zinc-300">
                            No workspaces inside current map bounds
                        </p>
                        <p className="mt-1 text-[11px]">
                            Pan or zoom out to explore nearby neighborhoods
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        {visibleVenues.map((venue) => (
                            <button
                                key={venue.id}
                                type="button"
                                onClick={() => onSelectVenue?.(venue.id)}
                                className="flex flex-col items-start rounded-xl border border-zinc-800 bg-zinc-900/85 p-3 text-left transition-colors hover:border-violet-500/50 hover:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-violet-400"
                            >
                                <div className="flex w-full items-center justify-between gap-2">
                                    <span className="truncate text-xs font-semibold text-zinc-100">
                                        {venue.name}
                                    </span>
                                    {typeof venue.wifiSpeedMbps === 'number' && (
                                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-950/70 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                                            <Wifi className="h-2.5 w-2.5" />
                                            {venue.wifiSpeedMbps} Mbps
                                        </span>
                                    )}
                                </div>
                                {venue.address && (
                                    <span className="mt-1 truncate text-[11px] text-zinc-400">
                                        {venue.address}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}