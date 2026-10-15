/**
 * mapTilePreloader.ts
 * Background Fetch API & offline map vector tile caching for zoom levels 12-16.
 * Preloads vector tiles into CacheStorage for bookmarked destinations before users lose connectivity.
 */

export const MAP_TILES_CACHE_NAME = "worksphere-offline-map-tiles-v1";
export const DEFAULT_MIN_ZOOM = 12;
export const DEFAULT_MAX_ZOOM = 16;
export const DEFAULT_TILE_URL_TEMPLATE = "https://tiles.worksphere.internal/{z}/{x}/{y}.pbf";
export const MAX_TILES_PER_BATCH = 150;

export interface TileBoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface TileCoordinate {
  x: number;
  y: number;
  z: number;
}

export interface DestinationBookmark {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusKm?: number;
}

export interface PreloadOptions {
  minZoom?: number;
  maxZoom?: number;
  tileUrlTemplate?: string;
  maxTiles?: number;
  cacheName?: string;
  title?: string;
}

export interface PreloadResult {
  success: boolean;
  tileCount: number;
  method: "BACKGROUND_FETCH" | "STANDARD_FETCH";
  cacheName: string;
  fetchId?: string;
  failedUrls?: string[];
  urls: string[];
}

/**
 * Converts latitude, longitude, and zoom level into slippy map tile coordinates (x, y, z).
 */
export function latLngToTile(lat: number, lng: number, zoom: number): TileCoordinate {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
    z: zoom,
  };
}

/**
 * Generates an array of tile URLs across zoom levels 12-16 for a given geographic bounding box.
 */
export function generateTileUrlsForBounds(
  bounds: TileBoundingBox,
  minZoom: number = DEFAULT_MIN_ZOOM,
  maxZoom: number = DEFAULT_MAX_ZOOM,
  tileUrlTemplate: string = DEFAULT_TILE_URL_TEMPLATE,
  maxTiles: number = MAX_TILES_PER_BATCH
): string[] {
  const urls: string[] = [];

  for (let z = minZoom; z <= maxZoom; z++) {
    const nw = latLngToTile(bounds.north, bounds.west, z);
    const se = latLngToTile(bounds.south, bounds.east, z);

    const minX = Math.min(nw.x, se.x);
    const maxX = Math.max(nw.x, se.x);
    const minY = Math.min(nw.y, se.y);
    const maxY = Math.max(nw.y, se.y);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        if (urls.length >= maxTiles) {
          return urls;
        }
        const url = tileUrlTemplate
          .replace("{z}", z.toString())
          .replace("{x}", x.toString())
          .replace("{y}", y.toString());
        urls.push(url);
      }
    }
  }

  return urls;
}

/**
 * Creates a geographic bounding box from a center point and radius in kilometers.
 */
export function createBoundsFromPoint(lat: number, lng: number, radiusKm: number = 3): TileBoundingBox {
  const latDelta = radiusKm / 111;
  const safeCos = Math.cos((lat * Math.PI) / 180);
  const lngDelta = radiusKm / (111 * (Math.abs(safeCos) < 0.001 ? 0.001 : safeCos));

  return {
    north: Math.min(85, lat + latDelta),
    south: Math.max(-85, lat - latDelta),
    east: Math.min(180, lng + Math.abs(lngDelta)),
    west: Math.max(-180, lng - Math.abs(lngDelta)),
  };
}

/**
 * Feature-detects whether the Background Fetch API is supported in the current environment.
 */
export function isBackgroundFetchSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "BackgroundFetchManager" in window
  );
}

/**
 * Downloads and stores vector map tiles in CacheStorage using the Background Fetch API
 * with automatic fallback to standard fetch().
 */
export async function preloadMapTiles(
  urls: string[],
  options: PreloadOptions = {}
): Promise<PreloadResult> {
  const cacheName = options.cacheName || MAP_TILES_CACHE_NAME;

  if (urls.length === 0) {
    return {
      success: true,
      tileCount: 0,
      method: "STANDARD_FETCH",
      cacheName,
      urls: [],
    };
  }

  // 1. Attempt Background Fetch API if available and service worker is registered
  if (isBackgroundFetchSupported()) {
    try {
      const swRegistration = await navigator.serviceWorker.ready;
      if (swRegistration && "backgroundFetch" in swRegistration) {
        const fetchId = `map-tiles-${Date.now()}`;
        const title = options.title || `Preloading ${urls.length} Offline Map Tiles`;

        await (swRegistration as unknown as {
          backgroundFetch: {
            fetch: (id: string, requests: string[], opts: Record<string, unknown>) => Promise<unknown>;
          };
        }).backgroundFetch.fetch(fetchId, urls, {
          title,
          icons: [{ sizes: "192x192", src: "/icons/icon-192x192.png", type: "image/png" }],
          downloadTotal: urls.length * 30 * 1024, // ~30KB average vector tile size
        });

        return {
          success: true,
          tileCount: urls.length,
          method: "BACKGROUND_FETCH",
          cacheName,
          fetchId,
          urls,
        };
      }
    } catch {
      // Fall through to standard fetch fallback if background fetch fails or throws
    }
  }

  // 2. Standard Fetch Fallback: download directly and populate CacheStorage
  const failedUrls: string[] = [];
  let cache: Cache | null = null;

  if (typeof caches !== "undefined") {
    try {
      cache = await caches.open(cacheName);
    } catch {
      cache = null;
    }
  }

  const fetchPromises = urls.map(async (url) => {
    try {
      const response = await fetch(url, { mode: "cors" });
      if (!response.ok) {
        failedUrls.push(url);
        return;
      }
      if (cache) {
        await cache.put(url, response.clone());
      }
    } catch {
      failedUrls.push(url);
    }
  });

  await Promise.all(fetchPromises);

  return {
    success: failedUrls.length < urls.length,
    tileCount: urls.length - failedUrls.length,
    method: "STANDARD_FETCH",
    cacheName,
    failedUrls,
    urls,
  };
}

/**
 * Preloads map tiles for an array of bookmarked destination locations.
 */
export async function preloadTilesForDestinations(
  destinations: DestinationBookmark[],
  options: PreloadOptions = {}
): Promise<PreloadResult> {
  const allUrls: Set<string> = new Set();
  const minZoom = options.minZoom || DEFAULT_MIN_ZOOM;
  const maxZoom = options.maxZoom || DEFAULT_MAX_ZOOM;
  const template = options.tileUrlTemplate || DEFAULT_TILE_URL_TEMPLATE;
  const maxTiles = options.maxTiles || MAX_TILES_PER_BATCH;

  for (const dest of destinations) {
    const bounds = createBoundsFromPoint(dest.lat, dest.lng, dest.radiusKm || 2);
    const urls = generateTileUrlsForBounds(bounds, minZoom, maxZoom, template, maxTiles);
    for (const url of urls) {
      allUrls.add(url);
      if (allUrls.size >= maxTiles) break;
    }
    if (allUrls.size >= maxTiles) break;
  }

  const uniqueUrls = Array.from(allUrls);
  return preloadMapTiles(uniqueUrls, options);
}

/**
 * Retrieves a cached map tile Response from CacheStorage if available.
 */
export async function getCachedMapTile(url: string, cacheName: string = MAP_TILES_CACHE_NAME): Promise<Response | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(cacheName);
    const match = await cache.match(url);
    return match || null;
  } catch {
    return null;
  }
}

/**
 * Clears the offline map vector tile cache.
 */
export async function clearOfflineMapTileCache(cacheName: string = MAP_TILES_CACHE_NAME): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    return await caches.delete(cacheName);
  } catch {
    return false;
  }
}
