/**
 * Venue Data Cache
 * 
 * Caches venue search results from Overpass API to reduce API calls
 * and improve response times.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

interface VenueCacheKey {
  lat: number;
  lng: number;
  radius: number;
  categories: string[];
}

const venueCache = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100;

/**
 * Generate a cache key from search parameters
 */
function generateCacheKey(params: VenueCacheKey): string {
  // Round coordinates to 3 decimal places (~100m precision)
  const lat = Math.round(params.lat * 1000) / 1000;
  const lng = Math.round(params.lng * 1000) / 1000;
  const radius = params.radius;
  const categories = [...params.categories].sort().join(',');
  
  return `venues:${lat}:${lng}:${radius}:${categories}`;
}

/**
 * Get cached venue data
 */
export function getCachedVenues<T>(params: VenueCacheKey): T | null {
  const key = generateCacheKey(params);
  const entry = venueCache.get(key);
  
  if (!entry) {
    return null;
  }
  
  // Check if expired
  if (Date.now() > entry.expiresAt) {
    venueCache.delete(key);
    return null;
  }
  
  return entry.data as T;
}

/**
 * Set cached venue data
 */
export function setCachedVenues<T>(
  params: VenueCacheKey, 
  data: T, 
  ttl: number = DEFAULT_TTL
): void {
  const key = generateCacheKey(params);
  const now = Date.now();
  
  // Evict old entries if cache is full
  if (venueCache.size >= MAX_CACHE_SIZE) {
    evictOldestEntries();
  }
  
  venueCache.set(key, {
    data,
    timestamp: now,
    expiresAt: now + ttl,
  });
}

/**
 * Invalidate cached venues for a specific area
 */
export function invalidateVenueCache(params?: Partial<VenueCacheKey>): void {
  if (!params) {
    venueCache.clear();
    return;
  }
  
  // Delete matching entries
  for (const key of venueCache.keys()) {
    if (params.lat && params.lng) {
      const lat = Math.round(params.lat * 1000) / 1000;
      const lng = Math.round(params.lng * 1000) / 1000;
      if (key.includes(`${lat}:${lng}`)) {
        venueCache.delete(key);
      }
    }
  }
}

/**
 * Evict oldest entries when cache is full
 */
function evictOldestEntries(): void {
  const entries = Array.from(venueCache.entries());
  
  // Sort by timestamp (oldest first)
  entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
  
  // Remove oldest 20%
  const toRemove = Math.ceil(entries.length * 0.2);
  for (let i = 0; i < toRemove; i++) {
    venueCache.delete(entries[i][0]);
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  size: number;
  maxSize: number;
  hitRate: number;
} {
  return {
    size: venueCache.size,
    maxSize: MAX_CACHE_SIZE,
    hitRate: 0, // Would need to track hits/misses for accurate rate
  };
}

// ============================================
// User-specific caches (favorites, ratings)
// ============================================

const userFavoritesCache = new Map<string, CacheEntry<string[]>>();
const USER_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

/**
 * Get cached user favorites
 */
export function getCachedFavorites(userId: string): string[] | null {
  const entry = userFavoritesCache.get(userId);
  
  if (!entry || Date.now() > entry.expiresAt) {
    userFavoritesCache.delete(userId);
    return null;
  }
  
  return entry.data;
}

/**
 * Set cached user favorites
 */
export function setCachedFavorites(userId: string, favoriteIds: string[]): void {
  userFavoritesCache.set(userId, {
    data: favoriteIds,
    timestamp: Date.now(),
    expiresAt: Date.now() + USER_CACHE_TTL,
  });
}

/**
 * Invalidate user favorites cache
 */
export function invalidateFavoritesCache(userId: string): void {
  userFavoritesCache.delete(userId);
}

// ============================================
// Local Storage Cache (for client-side)
// ============================================

const STORAGE_KEY_PREFIX = 'worksphere:';

/**
 * Save data to local storage with expiration
 */
export function saveToLocalStorage<T>(key: string, data: T, ttl: number = DEFAULT_TTL): void {
  if (typeof window === 'undefined') return;
  
  try {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttl,
    };
    localStorage.setItem(STORAGE_KEY_PREFIX + key, JSON.stringify(entry));
  } catch (e) {
    console.error('Failed to save to localStorage:', e);
  }
}

/**
 * Get data from local storage
 */
export function getFromLocalStorage<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + key);
    if (!raw) return null;
    
    const entry: CacheEntry<T> = JSON.parse(raw);
    
    if (Date.now() > entry.expiresAt) {
      localStorage.removeItem(STORAGE_KEY_PREFIX + key);
      return null;
    }
    
    return entry.data;
  } catch (e) {
    console.error('Failed to read from localStorage:', e);
    return null;
  }
}

/**
 * Clear all cached data from local storage
 */
export function clearLocalStorageCache(): void {
  if (typeof window === 'undefined') return;
  
  const keysToRemove: string[] = [];
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_KEY_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  
  keysToRemove.forEach(key => localStorage.removeItem(key));
}
