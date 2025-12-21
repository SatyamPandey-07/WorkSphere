/**
 * Offline Data Storage using IndexedDB
 * Provides persistent storage for venues, favorites, and search history
 */

const DB_NAME = 'worksphere-offline';
const DB_VERSION = 1;

interface OfflineVenue {
  id: string;
  name: string;
  location: string;
  latitude: number;
  longitude: number;
  type: string;
  rating: number;
  amenities: string[];
  savedAt: number;
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
export async function saveSearchOffline(query: string, results: OfflineVenue[]): Promise<void> {
  const database = await initOfflineDB();
  
  return new Promise((resolve, reject) => {
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
