/**
 * Offline Data Storage using IndexedDB
 * Provides persistent storage for venues, favorites, and search history
 * Integrated with Yjs for CRDT-based offline state mutation and background sync.
 */
import * as Y from 'yjs';

// Initialize global Y.Doc for user state
export const userDoc = new Y.Doc();
export const yFavorites = userDoc.getMap<OfflineVenue>('favorites');
export const yRatings = userDoc.getMap<Record<string, unknown>>('ratings');

// Automatically queue Yjs incremental updates for Background Sync
userDoc.on('update', async (update: Uint8Array) => {
  try {
    await queueCrdtUpdate(update);
  } catch (err) {
    console.error('Failed to queue CRDT update:', err);
  }
});


const DB_NAME = 'worksphere-offline';
const DB_VERSION = 2;

export interface OfflineVenue {
  id: string;
  name: string;
  location?: string;
  latitude: number;
  longitude: number;
  type?: string;
  category?: string;
  address?: string;
  rating?: number;
  amenities?: string[];
  savedAt?: number;
}

interface OfflineSearch {
  query: string;
  results: OfflineVenue[];
  timestamp: number;
}

let db: IDBDatabase | null = null;

/**
 * Initialize IndexedDB
 */
export async function initOfflineDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[OfflineDB] Failed to open database');
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      console.log('[OfflineDB] Database opened successfully');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      // Venues store
      if (!database.objectStoreNames.contains('venues')) {
        const venuesStore = database.createObjectStore('venues', { keyPath: 'id' });
        venuesStore.createIndex('type', 'type', { unique: false });
        venuesStore.createIndex('savedAt', 'savedAt', { unique: false });
      }

      // Favorites store
      if (!database.objectStoreNames.contains('favorites')) {
        const favoritesStore = database.createObjectStore('favorites', { keyPath: 'id' });
        favoritesStore.createIndex('savedAt', 'savedAt', { unique: false });
      }

      // Search history store
      if (!database.objectStoreNames.contains('searches')) {
        const searchesStore = database.createObjectStore('searches', { keyPath: 'query' });
        searchesStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Pending actions store (for sync when back online)
      if (!database.objectStoreNames.contains('pendingActions')) {
        database.createObjectStore('pendingActions', { keyPath: 'id', autoIncrement: true });
      }

      console.log('[OfflineDB] Database schema created');
    };
  });
}

/**
 * Save venue to offline storage
 */
export async function saveVenueOffline(venue: OfflineVenue): Promise<void> {
  const database = await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['venues'], 'readwrite');
    const store = transaction.objectStore('venues');
    
    const request = store.put({
      ...venue,
      savedAt: Date.now(),
    });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get venue from offline storage
 */
export async function getVenueOffline(id: string): Promise<OfflineVenue | null> {
  const database = await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['venues'], 'readonly');
    const store = transaction.objectStore('venues');
    
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all offline venues
 */
export async function getAllVenuesOffline(): Promise<OfflineVenue[]> {
  const database = await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['venues'], 'readonly');
    const store = transaction.objectStore('venues');
    
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save favorite to offline storage
 */
export async function saveFavoriteOffline(venue: OfflineVenue): Promise<void> {
  // 1. Update CRDT state (triggers userDoc.on('update') automatically)
  yFavorites.set(venue.id, venue);

  // 2. Update local IndexedDB for immediate UI reads
  const database = await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['favorites'], 'readwrite');
    const store = transaction.objectStore('favorites');
    
    const request = store.put({
      ...venue,
      savedAt: Date.now(),
    });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Remove favorite from offline storage
 */
export async function removeFavoriteOffline(id: string): Promise<void> {
  // 1. Update CRDT state
  yFavorites.delete(id);

  // 2. Update local IndexedDB
  const database = await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['favorites'], 'readwrite');
    const store = transaction.objectStore('favorites');
    
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all offline favorites
 */
export async function getFavoritesOffline(): Promise<OfflineVenue[]> {
  const database = await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['favorites'], 'readonly');
    const store = transaction.objectStore('favorites');
    
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save search results for offline use
 */
const MAX_SEARCH_HISTORY = 15;

export async function saveSearchOffline(query: string, results: OfflineVenue[]): Promise<void> {
  const database = await initOfflineDB();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(['searches'], 'readwrite');
    const store = transaction.objectStore('searches');

    const request = store.put({
      query: query.toLowerCase().trim(),
      results,
      timestamp: Date.now(),
    });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  await trimSearchHistory();
}

/**
 * Keep only the most recent MAX_SEARCH_HISTORY cached searches
 */
async function trimSearchHistory(): Promise<void> {
  const database = await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['searches'], 'readwrite');
    const store = transaction.objectStore('searches');
    const index = store.index('timestamp');

    // Keys ordered oldest -> newest by the timestamp index
    const request = index.getAllKeys();

    request.onsuccess = () => {
      const keys = request.result as IDBValidKey[];
      if (keys.length > MAX_SEARCH_HISTORY) {
        const keysToDelete = keys.slice(0, keys.length - MAX_SEARCH_HISTORY);
        keysToDelete.forEach((key) => store.delete(key));
      }
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all cached searches, most recent first
 */
export async function getAllSearchesOffline(): Promise<OfflineSearch[]> {
  const database = await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['searches'], 'readonly');
    const store = transaction.objectStore('searches');
    const index = store.index('timestamp');

    const request = index.getAll();

    request.onsuccess = () => {
      const results = (request.result || []) as OfflineSearch[];
      resolve(results.reverse());
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get cached search results
 */
export async function getSearchOffline(query: string): Promise<OfflineSearch | null> {
  const database = await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['searches'], 'readonly');
    const store = transaction.objectStore('searches');
    
    const request = store.get(query.toLowerCase().trim());

    request.onsuccess = () => {
      const result = request.result;
      // Return cached results if less than 24 hours old
      if (result && Date.now() - result.timestamp < 24 * 60 * 60 * 1000) {
        resolve(result);
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Queue action for when back online
 */
export async function queuePendingAction(action: {
  type: 'favorite' | 'unfavorite' | 'rate';
  venueId: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  const database = await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['pendingActions'], 'readwrite');
    const store = transaction.objectStore('pendingActions');
    
    const request = store.add({
      ...action,
      timestamp: Date.now(),
    });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Queue a CRDT update payload
 */
export async function queueCrdtUpdate(update: Uint8Array): Promise<void> {
  const database = await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['pendingActions'], 'readwrite');
    const store = transaction.objectStore('pendingActions');
    
    const request = store.add({
      type: 'crdt-sync',
      data: update,
      timestamp: Date.now(),
    });

    request.onsuccess = () => {
      // Attempt to register background sync if Service Worker is available
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        navigator.serviceWorker.ready.then((swRegistration) => {
          // Type casting since TS doesn't fully support sync interface yet
          (swRegistration as any).sync.register('sync-crdt').catch((err: any) => {
            console.error('Background Sync registration failed:', err);
          });
        });
      }
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get and clear pending actions
 */
export async function processPendingActions(): Promise<Array<{
  type: string;
  venueId: string;
  data?: Record<string, unknown>;
}>> {
  const database = await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['pendingActions'], 'readwrite');
    const store = transaction.objectStore('pendingActions');
    
    const getRequest = store.getAll();
    
    getRequest.onsuccess = () => {
      const actions = getRequest.result;
      // Clear all pending actions
      store.clear();
      resolve(actions);
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

/**
 * Clear old cached data
 */
export async function cleanupOldData(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
  const database = await initOfflineDB();
  const cutoff = Date.now() - maxAge;
  
  // Clean old venues
  const venuesTx = database.transaction(['venues'], 'readwrite');
  const venuesStore = venuesTx.objectStore('venues');
  const venuesIndex = venuesStore.index('savedAt');
  
  const venuesCursor = venuesIndex.openCursor(IDBKeyRange.upperBound(cutoff));
  venuesCursor.onsuccess = (event) => {
    const cursor = (event.target as IDBRequest).result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };

  // Clean old searches
  const searchesTx = database.transaction(['searches'], 'readwrite');
  const searchesStore = searchesTx.objectStore('searches');
  const searchesIndex = searchesStore.index('timestamp');
  
  const searchesCursor = searchesIndex.openCursor(IDBKeyRange.upperBound(cutoff));
  searchesCursor.onsuccess = (event) => {
    const cursor = (event.target as IDBRequest).result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
}
