/**
 * src/lib/geo/heatmapAggregator.ts
 *
 * Zoom-aware spatial aggregation engine and tile caching layer for PostGIS heatmap (#10166).
 */

import { TileBounds, isPointInTileBounds } from "./heatmapTile";

export type HeatmapPoint = [number, number, number]; // [latitude, longitude, weight]

export interface HeatmapVenueInput {
  id: string;
  latitude: number;
  longitude: number;
}

export interface NoiseStats {
  loud: number;
  moderate: number;
  quiet: number;
  total: number;
}

export interface TileAggregationOptions {
  z: number;
  x: number;
  y: number;
  bounds: TileBounds;
  venues: HeatmapVenueInput[];
  activeBookings: Map<string, number>;
  venueNoiseStats: Map<string, NoiseStats>;
}

export const HEATMAP_CACHE_VERSION = "v1";
export const DEFAULT_CACHE_TTL_MS = 60 * 1000; // 60 seconds

interface CachedTileEntry {
  points: HeatmapPoint[];
  expiresAt: number;
}

const tileCache = new Map<string, CachedTileEntry>();
const inFlightTileRequests = new Map<string, Promise<HeatmapPoint[]>>();

export function getHeatmapTileCacheKey(
  z: number,
  x: number,
  y: number,
  periodKey: string = "today",
  version: string = HEATMAP_CACHE_VERSION,
): string {
  return `heatmap_tile:${z}:${x}:${y}:${periodKey}:${version}`;
}

export function clearHeatmapTileCache(prefix?: string): void {
  if (!prefix) {
    tileCache.clear();
    return;
  }
  for (const key of tileCache.keys()) {
    if (key.startsWith(prefix)) {
      tileCache.delete(key);
    }
  }
}

/**
 * Returns sub-grid subdivision count along each axis according to zoom level.
 * Higher zoom preserves individual venue detail; lower zoom aggregates into cells.
 */
export function getSubgridResolutionForZoom(zoom: number): number {
  if (zoom >= 15) return 0; // 0 indicates direct individual venue output
  if (zoom >= 11) return 32;
  if (zoom >= 7) return 16;
  return 8;
}

/**
 * Computes deterministic intensity weight from booking count and noise distribution.
 */
export function computeHeatmapWeight(
  bookingCount: number,
  noiseStats?: NoiseStats,
): number {
  let noiseScore = 0.2; // Baseline fallback score for unrated cells
  if (noiseStats && noiseStats.total > 0) {
    const loudRatio = noiseStats.loud / noiseStats.total;
    const moderateRatio = noiseStats.moderate / noiseStats.total;
    noiseScore = 0.1 + (loudRatio * 0.4 + moderateRatio * 0.2);
  }

  const rawWeight = 0.1 + bookingCount * 0.2 + noiseScore;
  return Number(Math.min(1.0, Math.max(0.1, rawWeight)).toFixed(4));
}

/**
 * Aggregates venue records belonging to a tile according to zoom-dependent cell resolution.
 */
export function aggregateHeatmapTile(
  options: TileAggregationOptions,
): HeatmapPoint[] {
  const { z, bounds, venues, activeBookings, venueNoiseStats } = options;

  // 1. Filter venues strictly bounded by tile (handling boundaries deterministically)
  const boundedVenues = venues.filter((v) =>
    isPointInTileBounds(v.latitude, v.longitude, bounds),
  );

  if (boundedVenues.length === 0) {
    return [];
  }

  const subgridSteps = getSubgridResolutionForZoom(z);

  // Zoom >= 15: individual venue detail
  if (subgridSteps === 0) {
    return boundedVenues.map((v) => {
      const bookings = activeBookings.get(v.id) ?? 0;
      const noise = venueNoiseStats.get(v.id);
      const weight = computeHeatmapWeight(bookings, noise);
      return [v.latitude, v.longitude, weight];
    });
  }

  // Zoom < 15: group venues into sub-cells within the tile
  const latSpan = bounds.maxLat - bounds.minLat;
  const lngSpan = bounds.maxLng - bounds.minLng;

  type CellBucket = {
    lats: number[];
    lngs: number[];
    totalBookings: number;
    combinedNoise: NoiseStats;
  };

  const buckets = new Map<string, CellBucket>();

  for (const v of boundedVenues) {
    const cellX = Math.min(
      subgridSteps - 1,
      Math.max(
        0,
        Math.floor(((v.longitude - bounds.minLng) / lngSpan) * subgridSteps),
      ),
    );
    const cellY = Math.min(
      subgridSteps - 1,
      Math.max(
        0,
        Math.floor(((v.latitude - bounds.minLat) / latSpan) * subgridSteps),
      ),
    );
    const cellKey = `${cellX}_${cellY}`;

    let bucket = buckets.get(cellKey);
    if (!bucket) {
      bucket = {
        lats: [],
        lngs: [],
        totalBookings: 0,
        combinedNoise: { loud: 0, moderate: 0, quiet: 0, total: 0 },
      };
      buckets.set(cellKey, bucket);
    }

    bucket.lats.push(v.latitude);
    bucket.lngs.push(v.longitude);
    bucket.totalBookings += activeBookings.get(v.id) ?? 0;

    const noise = venueNoiseStats.get(v.id);
    if (noise && noise.total > 0) {
      bucket.combinedNoise.loud += noise.loud;
      bucket.combinedNoise.moderate += noise.moderate;
      bucket.combinedNoise.quiet += noise.quiet;
      bucket.combinedNoise.total += noise.total;
    }
  }

  const aggregatedPoints: HeatmapPoint[] = [];

  for (const bucket of buckets.values()) {
    const meanLat =
      bucket.lats.reduce((a, b) => a + b, 0) / bucket.lats.length;
    const meanLng =
      bucket.lngs.reduce((a, b) => a + b, 0) / bucket.lngs.length;
    const weight = computeHeatmapWeight(
      bucket.totalBookings,
      bucket.combinedNoise.total > 0 ? bucket.combinedNoise : undefined,
    );

    aggregatedPoints.push([
      Number(meanLat.toFixed(5)),
      Number(meanLng.toFixed(5)),
      weight,
    ]);
  }

  return aggregatedPoints;
}

/**
 * Retrieves or calculates a cached heatmap tile, coalescing concurrent requests.
 */
export async function getOrComputeCachedTile(
  cacheKey: string,
  computeFn: () => Promise<HeatmapPoint[]>,
  ttlMs: number = DEFAULT_CACHE_TTL_MS,
): Promise<HeatmapPoint[]> {
  const cached = tileCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.points;
  }

  // Request coalescing for identical tile cache key
  const inFlight = inFlightTileRequests.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const promise = (async () => {
    try {
      const points = await computeFn();
      tileCache.set(cacheKey, {
        points,
        expiresAt: Date.now() + ttlMs,
      });
      return points;
    } finally {
      inFlightTileRequests.delete(cacheKey);
    }
  })();

  inFlightTileRequests.set(cacheKey, promise);
  return promise;
}
