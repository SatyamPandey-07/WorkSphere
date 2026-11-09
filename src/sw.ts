/**
 * Service Worker Cache Strategy & Handlers for WorkSphere
 * Implements Stale-While-Revalidate caching strategy for venue gallery photos
 * from Cloudinary and Pexels with an LRU cache size limit of 100 images and 14-day max age.
 */

export const VENUE_PHOTO_CACHE_NAME = "worksphere-venue-photos-v1";
export const MAX_VENUE_PHOTO_ENTRIES = 100;
export const VENUE_PHOTO_MAX_AGE_SECONDS = 14 * 24 * 60 * 60; // 14 days (1,209,600 seconds)

export const SUPPORTED_PHOTO_DOMAINS = [
  "res.cloudinary.com",
  "images.pexels.com",
  "cloudinary.com",
  "pexels.com",
];

export interface CacheEntryMetadata {
  url: string;
  timestamp: number;
}

export interface ExpirationPluginConfig {
  maxEntries?: number;
  maxAgeSeconds?: number;
  purgeOnQuotaError?: boolean;
}

export type CacheLike = {
  match: (request: Request | string) => Promise<Response | undefined>;
  put: (request: Request | string, response: Response) => Promise<void>;
  delete: (request: Request | string) => Promise<boolean>;
  keys: () => Promise<readonly Request[] | Request[]>;
};

/**
 * Cache expiration plugin managing LRU count limits (maxEntries: 100)
 * and TTL eviction (maxAgeSeconds: 14 days).
 */
export class CacheExpirationPlugin {
  readonly maxEntries: number;
  readonly maxAgeSeconds: number;
  readonly purgeOnQuotaError: boolean;
  private metadataStore: Map<string, number>;

  constructor(config: ExpirationPluginConfig = {}) {
    this.maxEntries = config.maxEntries ?? MAX_VENUE_PHOTO_ENTRIES;
    this.maxAgeSeconds = config.maxAgeSeconds ?? VENUE_PHOTO_MAX_AGE_SECONDS;
    this.purgeOnQuotaError = config.purgeOnQuotaError ?? true;
    this.metadataStore = new Map<string, number>();
  }

  isExpired(timestamp: number, now: number = Date.now()): boolean {
    const ageSeconds = (now - timestamp) / 1000;
    return ageSeconds > this.maxAgeSeconds;
  }

  updateTimestamp(url: string, timestamp: number = Date.now()): void {
    // Re-insert to enforce LRU ordering (most recent access moves to the end)
    this.metadataStore.delete(url);
    this.metadataStore.set(url, timestamp);
  }

  getEntries(): CacheEntryMetadata[] {
    const entries: CacheEntryMetadata[] = [];
    for (const [url, timestamp] of this.metadataStore.entries()) {
      entries.push({ url, timestamp });
    }
    return entries;
  }

  hasEntry(url: string): boolean {
    return this.metadataStore.has(url);
  }

  getEntryCount(): number {
    return this.metadataStore.size;
  }

  /**
   * Expire stale entries past TTL or drop oldest LRU items exceeding maxEntries.
   * Returns list of deleted URLs.
   */
  async expireEntries(cache: CacheLike, now: number = Date.now()): Promise<string[]> {
    const deletedUrls: string[] = [];

    // 1. Evict entries that exceed maxAgeSeconds
    for (const [url, timestamp] of Array.from(this.metadataStore.entries())) {
      if (this.isExpired(timestamp, now)) {
        await cache.delete(new Request(url));
        this.metadataStore.delete(url);
        deletedUrls.push(url);
      }
    }

    // 2. Evict oldest entries if total exceeds maxEntries
    while (this.metadataStore.size > this.maxEntries) {
      const oldestUrl = this.metadataStore.keys().next().value;
      if (!oldestUrl) break;
      await cache.delete(new Request(oldestUrl));
      this.metadataStore.delete(oldestUrl);
      deletedUrls.push(oldestUrl);
    }

    return deletedUrls;
  }
}

export interface StaleWhileRevalidateOptions {
  cacheName?: string;
  expiration?: CacheExpirationPlugin;
}

/**
 * StaleWhileRevalidate caching strategy for venue photos.
 * Immediately returns cached response on cache hit while initiating
 * a silent background network fetch to revalidate and refresh the cache.
 */
export class StaleWhileRevalidate {
  readonly cacheName: string;
  readonly expiration: CacheExpirationPlugin;

  constructor(options: StaleWhileRevalidateOptions = {}) {
    this.cacheName = options.cacheName ?? VENUE_PHOTO_CACHE_NAME;
    this.expiration =
      options.expiration ??
      new CacheExpirationPlugin({
        maxEntries: MAX_VENUE_PHOTO_ENTRIES,
        maxAgeSeconds: VENUE_PHOTO_MAX_AGE_SECONDS,
      });
  }

  async handle({
    request,
    event,
    cacheInstance,
    fetchFn = fetch,
  }: {
    request: Request;
    event?: { waitUntil: (promise: Promise<any>) => void };
    cacheInstance?: CacheLike;
    fetchFn?: typeof fetch;
  }): Promise<Response> {
    const cache =
      cacheInstance ||
      (typeof caches !== "undefined"
        ? await caches.open(this.cacheName)
        : null);

    if (!cache) {
      return fetchFn(request);
    }

    const cachedResponse = await cache.match(request);

    const revalidatePromise = (async () => {
      try {
        const networkResponse = await fetchFn(request.clone());
        if (
          networkResponse &&
          (networkResponse.status === 200 || networkResponse.status === 0)
        ) {
          await cache.put(request, networkResponse.clone());
          this.expiration.updateTimestamp(request.url);
          await this.expiration.expireEntries(cache);
        }
        return networkResponse;
      } catch (error) {
        // Silently swallow network errors during background revalidation
        return null;
      }
    })();

    if (cachedResponse) {
      this.expiration.updateTimestamp(request.url);
      if (event && typeof event.waitUntil === "function") {
        event.waitUntil(revalidatePromise);
      } else {
        // Let revalidation proceed in background
        revalidatePromise.catch(() => {});
      }
      return cachedResponse;
    }

    // Cache miss: await network response directly
    const networkResponse = await revalidatePromise;
    if (networkResponse) {
      return networkResponse;
    }

    return new Response("Venue Photo Unavailable Offline", {
      status: 504,
      statusText: "Gateway Timeout",
    });
  }
}

/**
 * Checks if a request or URL targets Cloudinary or Pexels venue photos.
 */
export function isVenuePhotoUrl(urlOrRequest: string | Request | URL): boolean {
  const urlString =
    typeof urlOrRequest === "string"
      ? urlOrRequest
      : "url" in urlOrRequest
        ? urlOrRequest.url
        : urlOrRequest.toString();

  try {
    const parsed = new URL(urlString, "http://localhost");
    return SUPPORTED_PHOTO_DOMAINS.some(
      (domain) =>
        parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`),
    );
  } catch {
    return SUPPORTED_PHOTO_DOMAINS.some((domain) => urlString.includes(domain));
  }
}

export const venuePhotoExpirationPlugin = new CacheExpirationPlugin({
  maxEntries: MAX_VENUE_PHOTO_ENTRIES,
  maxAgeSeconds: VENUE_PHOTO_MAX_AGE_SECONDS,
});

export const venuePhotoStrategy = new StaleWhileRevalidate({
  cacheName: VENUE_PHOTO_CACHE_NAME,
  expiration: venuePhotoExpirationPlugin,
});

export async function handleVenuePhotoFetch(
  request: Request,
  event?: { waitUntil: (promise: Promise<any>) => void },
  cacheInstance?: CacheLike,
  fetchFn?: typeof fetch,
): Promise<Response> {
  return venuePhotoStrategy.handle({ request, event, cacheInstance, fetchFn });
}
