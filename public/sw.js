// Service Worker for WorkSphere PWA
const CACHE_NAME = "worksphere-v3";
const OFFLINE_URL = "/offline";

// Assets to cache on install
const PRECACHE_ASSETS = ["/", "/offline", "/icons/icon.svg", "/manifest.json"];

// Install event - precache essential assets
self.addEventListener("install", (event) => {
  // Use a temporary cache for installation to prevent locking the main cache
  const tempCacheName = `${CACHE_NAME}-installing`;
  event.waitUntil(
    caches.open(tempCacheName).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => {
      // Once assets are added, we can skip waiting immediately
      return self.skipWaiting();
    }).catch(err => {
      console.error("[SW] Install failed:", err);
      // Even if install fails, we skip waiting to avoid getting stuck in 'installing' state
      return self.skipWaiting();
    })
  );
});

// Activate event - clean up old caches and move temp assets
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && !name.endsWith("-installing"))
          .map((name) => caches.delete(name)),
      );
    }).then(() => {
      // Claim clients immediately to take control of the page
      return self.clients.claim();
    }).then(() => {
      // Clean up any stray installation caches
      return caches.keys().then(names => {
        return Promise.all(
          names.filter(n => n.endsWith("-installing")).map(n => caches.delete(n))
        );
      });
    })
  );
});

// Handle Cache-First for maps and images, Network-First for everything else
self.addEventListener("fetch", (event) => {
  // Bypass caching and worker interception for non-GET requests (like POST/PUT/DELETE)
  if (event.request.method !== "GET") {
    return;
  }

  // Bypass service worker interception for download endpoints to prevent binary stream locking
  if (event.request.url.includes("/download")) {
    return;
  }

  const isVenuesApi = event.request.url.includes("/api/venues");
  const isExternalAsset =
    event.request.url.includes("tile.openstreetmap.org") ||
    event.request.url.includes("images.unsplash.com");

  if (isVenuesApi) {
    // Network-First strategy for /api/venues
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            event.waitUntil(
              caches.open(CACHE_NAME).then((cache) => {
                return cache.put(event.request, responseClone);
              }),
            );
          }
          return response;
        })
        .catch(async () => {
          const cachedResponse = await caches.match(event.request);
          if (cachedResponse) return cachedResponse;
          return new Response("Offline", { status: 503 });
        }),
    );
  } else if (isExternalAsset) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          // Agar cache mein mil gaya, toh turant return karo
          if (cachedResponse) {
            return cachedResponse;
          }

          // Agar cache mein nahi hai, toh network se fetch karo aur cache mein daalo
          return fetch(event.request)
            .then((networkResponse) => {
              // Note: External requests sometimes return status 0 (opaque), we check response.status === 200 || response.status === 0
              if (
                networkResponse.status === 200 ||
                networkResponse.status === 0
              ) {
                cache.put(event.request, networkResponse.clone());
              }
              return networkResponse;
            })
            .catch(() => new Response("Asset Offline", { status: 503 }));
        });
      }),
    );
  } else {
    // Existing Network-First logic for local assets
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(async () => {
          const cachedResponse = await caches.match(event.request);
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === "navigate") {
            return caches.match(OFFLINE_URL);
          }
          return new Response("Offline", { status: 503 });
        }),
    );
  }
});
// Background Sync for offline actions
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-crdt") {
    event.waitUntil(syncCrdt());
  }
  // Fallbacks for older queues
  if (event.tag === "sync-favorites") {
    event.waitUntil(syncFavorites());
  }
  if (event.tag === "sync-ratings") {
    event.waitUntil(syncRatings());
  }
  if (event.tag === "sync-conversations") {
    event.waitUntil(syncConversations());
  }
});

// Helper to convert Uint8Array to base64 for fetch
function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

let isSyncingCrdt = false;
// Sync CRDT when back online
async function syncCrdt() {
  if (isSyncingCrdt) return;
  isSyncingCrdt = true;
  try {
    const db = await openIndexedDB();
    const pendingActions = await getPendingActions(db, "crdt-sync");

    if (pendingActions.length === 0) return;

    const updates = pendingActions.map((action) =>
      arrayBufferToBase64(action.data),
    );

    const response = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    });

    if (response.ok) {
      for (const action of pendingActions) {
        await removePendingAction(db, action.id);
      }
    }
  } catch (error) {
    console.error("Sync CRDT failed:", error);
  } finally {
    isSyncingCrdt = false;
  }
}

let isSyncingFavorites = false;
// Sync favorites when back online
async function syncFavorites() {
  if (isSyncingFavorites) return;
  isSyncingFavorites = true;
  try {
    const db = await openIndexedDB();
    const pendingFavorites = await getPendingActions(db, [
      "favorite",
      "unfavorite",
      "favorites",
    ]);

    for (const action of pendingFavorites) {
      try {
        const url =
          action.type === "unfavorite"
            ? `/api/favorites?venueId=${action.venueId}`
            : "/api/favorites";
        const method =
          action.type === "unfavorite" ? "DELETE" : action.method || "POST";
        const body =
          action.type === "favorite"
            ? JSON.stringify(action.data)
            : action.data
              ? JSON.stringify(action.data)
              : undefined;

        const response = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body,
        });

        if (response.ok) {
          await removePendingAction(db, action.id);
        }
      } catch (error) {
        console.error("Failed to sync favorite:", error);
      }
    }
  } catch (error) {
    console.error("Sync favorites failed:", error);
  } finally {
    isSyncingFavorites = false;
  }
}

let isSyncingRatings = false;
// Sync ratings when back online
async function syncRatings() {
  if (isSyncingRatings) return;
  isSyncingRatings = true;
  try {
    const db = await openIndexedDB();
    const pendingRatings = await getPendingActions(db, ["ratings", "rate"]);

    for (const action of pendingRatings) {
      try {
        const response = await fetch(`/api/venues/${action.venueId}/rate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action.data),
        });

        if (response.ok) {
          await removePendingAction(db, action.id);
        }
      } catch (error) {
        console.error("Failed to sync rating:", error);
      }
    }
  } catch (error) {
    console.error("Sync ratings failed:", error);
  } finally {
    isSyncingRatings = false;
  }
}

// Sync queued conversation renames/deletes when back online (issue #266)
async function syncConversations() {
  try {
    const db = await openIndexedDB();
    const tx = db.transaction("pendingActions", "readonly");
    const store = tx.objectStore("pendingActions");
    const allActions = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    const pending = allActions
      .filter(
        (a) =>
          a.type === "conversation-rename" || a.type === "conversation-delete",
      )
      .sort((a, b) => a.timestamp - b.timestamp);

    // Defensive de-dupe in case a rename and a later delete for the same
    // conversation both slipped into the queue (client-side queuing already
    // guards against this, but the service worker reads independently).
    const deletedIds = new Set(
      pending
        .filter((a) => a.type === "conversation-delete")
        .map((a) => a.conversationId),
    );

    for (const action of pending) {
      if (
        action.type === "conversation-rename" &&
        deletedIds.has(action.conversationId)
      ) {
        await removePendingAction(db, action.id);
        continue;
      }

      try {
        const response =
          action.type === "conversation-delete"
            ? await fetch(`/api/conversations/${action.conversationId}`, {
                method: "DELETE",
              })
            : await fetch(`/api/conversations/${action.conversationId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: action.title }),
              });

        if (response.ok) {
          await removePendingAction(db, action.id);
        }
      } catch (error) {
        console.error("Failed to sync conversation edit:", error);
      }
    }
  } catch (error) {
    console.error("Sync conversations failed:", error);
  }
}

// IndexedDB helpers
function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("worksphere-offline", 3);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Venues store
      if (!db.objectStoreNames.contains("venues")) {
        const venuesStore = db.createObjectStore("venues", { keyPath: "id" });
        venuesStore.createIndex("type", "type", { unique: false });
        venuesStore.createIndex("savedAt", "savedAt", { unique: false });
      }

      // Favorites store
      if (!db.objectStoreNames.contains("favorites")) {
        const favoritesStore = db.createObjectStore("favorites", {
          keyPath: "id",
        });
        favoritesStore.createIndex("savedAt", "savedAt", { unique: false });
      }

      // Search history store
      if (!db.objectStoreNames.contains("searches")) {
        const searchesStore = db.createObjectStore("searches", {
          keyPath: "query",
        });
        searchesStore.createIndex("timestamp", "timestamp", { unique: false });
      }

      // Migration
      if (db.objectStoreNames.contains("pending-actions")) {
        db.deleteObjectStore("pending-actions");
      }

      // Pending actions store (unified name)
      if (!db.objectStoreNames.contains("pendingActions")) {
        db.createObjectStore("pendingActions", {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    };
  });
}

function getPendingActions(db, type) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pendingActions", "readonly");
    const store = tx.objectStore("pendingActions");
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const actions = request.result.filter((a) => {
        if (Array.isArray(type)) return type.includes(a.type);
        return a.type === type;
      });
      resolve(actions);
    };
  });
}

function removePendingAction(db, typeOrId, id) {
  const actionId = id !== undefined ? id : typeOrId;
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pendingActions", "readwrite");
    const store = tx.objectStore("pendingActions");
    const request = store.delete(actionId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

// Push notifications
self.addEventListener("push", (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || "New update from WorkSphere",
    icon: "/icons/icon.svg",
    badge: "/icons/icon.svg",
    vibrate: [100, 50, 100],
    data: {
      url: data.url || "/",
    },
    actions: [
      { action: "open", title: "Open" },
      { action: "dismiss", title: "Dismiss" },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "WorkSphere", options),
  );
});

// Notification click handler
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") return;

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // Focus existing window if available
        for (const client of windowClients) {
          if (client.url === url && "focus" in client) {
            return client.focus();
          }
        }
        // Open new window
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      }),
  );
});

import {
  getQueuedFavorites,
  dequeueOfflineAction,
} from "../src/lib/offlineStore";

self.addEventListener("sync", (event) => {
  if (event.tag === "sync-favorites") {
    event.waitUntil(syncFavoritesOutbox());
  }
});

async function syncFavoritesOutbox() {
  try {
    const actions = await getQueuedFavorites();

    for (const action of actions) {
      const response = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueId: action.venueId,
          action: action.action,
        }),
      });

      if (response.ok && action.id) {
        // Remove from IndexedDB outbox queue on successful endpoint ingestion
        await dequeueOfflineAction(action.id);
      }
    }
  } catch (error) {
    console.error(
      "Background synchronization pipeline failed to complete:",
      error,
    );
  }
}
