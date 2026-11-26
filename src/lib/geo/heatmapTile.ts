/**
 * src/lib/geo/heatmapTile.ts
 *
 * Deterministic Web Mercator tile coordinates conversion, boundary validation,
 * antimeridian handling, and boundary half-open predicate (#10166).
 */

export interface TileBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface TileCoordinates {
  z: number;
  x: number;
  y: number;
}

export const MIN_ZOOM = 0;
export const MAX_ZOOM = 24;

/**
 * Validates zoom level and tile (x, y) coordinates according to standard Slippy Map / Web Mercator rules.
 */
export function validateTileCoordinates(
  z: number,
  x: number,
  y: number,
): { valid: boolean; error?: string } {
  if (!Number.isInteger(z) || z < MIN_ZOOM || z > MAX_ZOOM) {
    return {
      valid: false,
      error: `Zoom level must be an integer between ${MIN_ZOOM} and ${MAX_ZOOM}.`,
    };
  }

  const maxTiles = Math.pow(2, z);
  if (!Number.isInteger(x) || x < 0 || x >= maxTiles) {
    return {
      valid: false,
      error: `Tile X must be an integer between 0 and ${maxTiles - 1} at zoom ${z}.`,
    };
  }

  if (!Number.isInteger(y) || y < 0 || y >= maxTiles) {
    return {
      valid: false,
      error: `Tile Y must be an integer between 0 and ${maxTiles - 1} at zoom ${z}.`,
    };
  }

  return { valid: true };
}

/**
 * Converts tile coordinates (z, x, y) into geographical bounding box [minLat, maxLat, minLng, maxLng].
 * Note that in Web Mercator, tile y=0 is at the top (north / maxLat).
 */
export function tileToBoundingBox(z: number, x: number, y: number): TileBounds {
  const n = Math.pow(2, z);
  const minLng = (x / n) * 360 - 180;
  const maxLng = ((x + 1) / n) * 360 - 180;

  // Latitude from Mercator projection
  const minLatRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  const maxLatRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));

  const minLat = (minLatRad * 180) / Math.PI;
  const maxLat = (maxLatRad * 180) / Math.PI;

  return {
    minLat: Number(minLat.toFixed(7)),
    maxLat: Number(maxLat.toFixed(7)),
    minLng: Number(minLng.toFixed(7)),
    maxLng: Number(maxLng.toFixed(7)),
  };
}

/**
 * Converts latitude and longitude to tile (z, x, y).
 */
export function latLngToTile(lat: number, lng: number, zoom: number): TileCoordinates {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n,
  );
  const clampedX = Math.max(0, Math.min(n - 1, x));
  const clampedY = Math.max(0, Math.min(n - 1, y));
  return { z: zoom, x: clampedX, y: clampedY };
}

/**
 * Deterministically tests if a point belongs to a tile using half-open intervals
 * [minLat, maxLat) and [minLng, maxLng) to avoid duplicate inclusion on shared boundaries.
 */
export function isPointInTileBounds(
  lat: number,
  lng: number,
  bounds: TileBounds,
): boolean {
  const latMatch = lat >= bounds.minLat && lat < bounds.maxLat;
  // Handle standard bounds
  if (bounds.minLng <= bounds.maxLng) {
    return latMatch && lng >= bounds.minLng && lng < bounds.maxLng;
  }
  // Handle antimeridian crossing where tile spans across 180 / -180 longitude
  const lngMatch = lng >= bounds.minLng || lng < bounds.maxLng;
  return latMatch && lngMatch;
}
