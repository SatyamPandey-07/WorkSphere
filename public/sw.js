// Service Worker for WorkSphere PWA
const CACHE_NAME = "worksphere-v2";
const OFFLINE_URL = "/offline";

// Assets to cache on install
const PRECACHE_ASSETS = ["/", "/offline", "/icons/icon.svg", "/manifest.json"];

// Install event - precache essential assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }),
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
    }),
  );
  self.clients.claim();
});

// Handle Cache-First for maps and images, Network-First for everything else
self.addEventListener("fetch", (event) => {
  // Bypass caching and worker interception for non-GET requests (like POST/PUT/DELETE)
  if (event.request.method !== "GET") {
    return;
  }

  const isExternalAsset =
    event.request.url.includes("tile.openstreetmap.org") ||
    event.request.url.includes("images.unsplash.com");

  if (isExternalAsset) {
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
  if (event.tag === "sync-favorites") {
    event.waitUntil(syncFavorites());
  }
  if (event.tag === "sync-ratings") {
    event.waitUntil(syncRatings());
  }
});

// Sync favorites when back online
async function syncFavorites() {
  try {
    const db = await openIndexedDB();
    const pendingFavorites = await getPendingActions(db, "favorites");

    for (const action of pendingFavorites) {
      try {
        const response = await fetch("/api/favorites", {
          method: action.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action.data),
        });

        if (response.ok) {
          await removePendingAction(db, "favorites", action.id);
        }
      } catch (error) {
        console.error("Failed to sync favorite:", error);
      }
    }
  } catch (error) {
    console.error("Sync favorites failed:", error);
  }
}

// Sync ratings when back online
async function syncRatings() {
  try {
    const db = await openIndexedDB();
    const pendingRatings = await getPendingActions(db, "ratings");

    for (const action of pendingRatings) {
      try {
        const response = await fetch(`/api/venues/${action.venueId}/rate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action.data),
        });

        if (response.ok) {
          await removePendingAction(db, "ratings", action.id);
        }
      } catch (error) {
        console.error("Failed to sync rating:", error);
      }
    }
  } catch (error) {
    console.error("Sync ratings failed:", error);
  }
}

// IndexedDB helpers
function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("worksphere-offline", 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("pending-actions")) {
        db.createObjectStore("pending-actions", {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    };
  });
}

function getPendingActions(db, type) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pending-actions", "readonly");
    const store = tx.objectStore("pending-actions");
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const actions = request.result.filter((a) => a.type === type);
      resolve(actions);
    };
  });
}

function removePendingAction(db, type, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pending-actions", "readwrite");
    const store = tx.objectStore("pending-actions");
    const request = store.delete(id);

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
