# PWA Service Worker Specification

This document defines the Service Worker architecture for the WorkSphere Progressive Web App (PWA). It describes the caching strategies, lifecycle events, cache versioning rules, offline navigation behavior, storage management, and recommended Workbox configurations for future enhancements.

---

## 1. Service Worker Lifecycle

The Service Worker is responsible for improving application performance, offline reliability, and background synchronization. It follows the standard lifecycle of installation, activation, and request interception.

### Installation

During installation, essential application assets are precached using a temporary installation cache. The Service Worker attempts to cache the required assets before calling `self.skipWaiting()`. If precaching is incomplete, activation may still proceed depending on the implementation, and some resources may need to be fetched from the network later.

**Precached assets include:**

- `/`
- `/offline`
- `/icons/icon.svg`
- `/manifest.json`

```javascript
const CACHE_NAME = "worksphere-v3";
const OFFLINE_URL = "/offline";

const PRECACHE_ASSETS = [
  "/",
  "/offline",
  "/icons/icon.svg",
  "/manifest.json",
];
```

### Activation

When activated, the Service Worker:

- Removes outdated cache versions.
- Deletes temporary installation caches.
- Claims all active clients immediately.
- Ensures only the latest cache remains available.

This prevents stale cached resources from remaining after new deployments.

---

## 2. Caching Strategy Configuration

The Service Worker applies different caching strategies depending on the type of resource being requested. This balances application performance, offline availability, and data freshness.

### Network-First Strategy

**Applies to:**

- API endpoints
- HTML navigation requests
- Frequently changing local resources

The Service Worker attempts to retrieve the latest version from the network. If the request succeeds, the response is stored in the cache. If the network is unavailable, the cached response is returned instead.

**Benefits**

- Always prefers fresh content.
- Supports offline access after successful requests.
- Prevents stale application data whenever connectivity is available.

### Cache-First Strategy

**Applies to:**

- OpenStreetMap tiles
- External images
- Static assets that change infrequently

TThe Service Worker checks the cache before making a network request. If the resource is already cached, it is returned immediately. Otherwise, the Service Worker attempts to fetch the resource from the network and cache it for future requests. Since runtime cache writes are best-effort, external resources may not always be available from the cache on subsequent requests.

**Benefits**

- Faster loading of static resources.
- Reduced network bandwidth usage.
- Improved offline experience.

---

## 3. Cache Versioning Rules

The current Service Worker maintains a versioned cache using a single cache identifier.

```javascript
const CACHE_NAME = "worksphere-v3";
```

When a new Service Worker version is deployed:

1. A new cache version should be created.
2. Old cache versions should be removed during activation.
3. Temporary installation caches should also be deleted.
4. Clients should immediately switch to the newest Service Worker.

This versioning strategy prevents outdated resources from remaining after application updates and ensures users always receive the latest cached assets.

---

## 4. LRU Cache Eviction Policy

To prevent unlimited cache growth, the Service Worker should implement a Least Recently Used (LRU) eviction policy for runtime caches.

The current Service Worker implementation does not include automatic LRU cache eviction. The following policy describes a recommended approach for future enhancement to control runtime cache growth.

### Recommended Behavior

- Define a maximum cache size for runtime resources.
- Remove the least recently accessed entries when the limit is exceeded.
- Preserve critical application shell assets during eviction.
- Keep offline fallback resources permanently cached.

### Recommended Limits

| Cache Type | Suggested Limit |
|------------|----------------:|
| Static Assets | 100 entries |
| Images | 150 entries |
| API Responses | 50 entries |
| Map Tiles | 200 entries |

This policy helps reduce unnecessary storage consumption while keeping frequently accessed resources available offline.

If LRU eviction is introduced in the future, it should track resource access history rather than insertion order to ensure that the least recently used entries are removed first.

---

## 5. Offline Fallback Routes

When a network request cannot be completed, the Service Worker provides safe fallback responses.

### Navigation Requests

If the user navigates while offline:

```javascript
return caches.match("/offline");
```

The offline page allows users to understand that connectivity is unavailable while keeping the application responsive.

### API Requests

If no cached response exists:

```javascript
return new Response("Offline", {
  status: 503,
});
```

### Static Assets

If an external asset cannot be retrieved and no cached copy exists, the Service Worker returns a safe fallback response instead of allowing the request to fail silently.

This approach provides a predictable offline experience and prevents broken application states.

---

## 6. iOS WebKit Storage Quota Management

Safari on iOS applies stricter storage limits than most Chromium-based browsers. Cached data may be removed automatically when storage pressure increases or when the operating system reclaims space.

### Recommended Practices

- Cache only essential application resources.
- Avoid storing large media files in the Cache Storage API.
- Remove outdated cache versions during Service Worker activation.
- Prefer IndexedDB for structured offline data instead of Cache Storage.
- Keep the application shell small to reduce storage usage.
- Gracefully recover by downloading resources again if cached data has been evicted.

These practices improve compatibility with iOS WebKit while maintaining a reliable offline experience.

---

## 7. Recommended Workbox Configuration

The current implementation uses the native Cache Storage API instead of Workbox. If the project adopts Workbox in the future, the following strategy configuration is recommended.

| Resource Type | Recommended Strategy |
|--------------|----------------------|
| HTML Navigation | NetworkFirst |
| API Responses | NetworkFirst |
| Images | CacheFirst |
| Fonts | CacheFirst |
| Map Tiles | CacheFirst |
| Static JavaScript/CSS | StaleWhileRevalidate |

**Example (if Workbox is adopted):**

```javascript
registerRoute(
  ({ request }) => request.destination === "image",
  new CacheFirst({
    cacheName: "image-cache",
  }),
);
```

If Workbox is adopted in the future, the recommended strategies above represent a potential enhancement to the current caching behavior. Workbox can simplify runtime caching, cache expiration, route management, and long-term maintenance.

## Summary

The WorkSphere Service Worker is designed to provide a fast, reliable, and resilient Progressive Web App experience.

The current implementation includes:

- Service Worker lifecycle management
- Versioned cache handling
- Network-First strategy for dynamic resources
- Cache-First strategy for external assets
- Offline fallback handling
- Background Sync support

Future enhancements such as LRU cache eviction and Workbox-based runtime caching can further improve maintainability, storage efficiency, and long-term scalability.