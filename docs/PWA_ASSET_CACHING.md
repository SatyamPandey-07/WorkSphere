# PWA Asset Caching Strategy

This document outlines the service worker caching strategies used in the WorkSphere Progressive Web App (PWA) to ensure offline reliability and optimal performance while handling network fallbacks.

---

## 1. Cache-First Strategy (External Mapping & Image Assets)

**Target:** External map tiles (e.g., `tile.openstreetmap.org`) and image/font assets.
**Reasoning:** These external map tiles and static assets rarely change. Serving them directly from the cache immediately improves initial load times, saves bandwidth, and ensures the UI structure and maps remain intact offline.

**Service Worker Implementation Pattern:**
The service worker intercepts the request, checks the cache first. If missing, it fetches from the network and saves the successful response into the cache for future offline use.

```javascript
// Example: Cache-First for external mapping tiles and images
self.addEventListener("fetch", (event) => {
  const isExternalMapTile = event.request.url.includes(
    "tile.openstreetmap.org",
  );
  const isImageAsset =
    event.request.destination === "image" ||
    event.request.destination === "font";

  if (isExternalMapTile || isImageAsset) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        // Return from cache if available
        if (cachedResponse) {
          return cachedResponse;
        }

        // Otherwise fetch from network and cache the response
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const responseToCache = networkResponse.clone();
            caches.open("static-asset-cache").then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        });
      }),
    );
  }
});
```

## 2. Network-First Strategy (Local Requests & API Endpoints)

**Target:** Local requests, HTML navigations, and dynamic API endpoints (e.g., `/api/venues`).
**Reasoning:** This local data updates frequently. We must always attempt to show the user the most up-to-date information directly from the server, falling back to the cached versions only if the network fails.

**Service Worker Implementation Pattern:**
The service worker attempts to fetch from the network first. If successful, it updates the cache. If the network fails, it returns the last known good state from the cache, or returns a safe 503 fallback response if the cache is empty.

```javascript
// Example: Network-First for local requests and API endpoints
self.addEventListener("fetch", (event) => {
  const isLocalApi =
    event.request.url.includes("/api/") || event.request.mode === "navigate";

  if (isLocalApi) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // Clone and cache only successful responses
          if (networkResponse && networkResponse.ok) {
            const responseToCache = networkResponse.clone();
            caches.open("dynamic-content-cache").then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Network failed, fallback to cache safely
          return caches.match(event.request).then((cachedResponse) => {
            return (
              cachedResponse ||
              new Response("Offline: Resource not cached.", {
                status: 503,
                statusText: "Service Unavailable",
              })
            );
          });
        }),
    );
  }
});
```
