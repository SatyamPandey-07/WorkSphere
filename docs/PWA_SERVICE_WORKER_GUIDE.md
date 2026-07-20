# PWA Service Worker Caching Strategies & WebPush Setup Guide

This document provides a comprehensive guide to Progressive Web App (PWA) service worker caching strategies, Web Push notification setup, and best practices within the WorkSphere codebase. It serves as a central reference for contributors implementing, maintaining, or debugging PWA functionality.

This document is intended for contributors working on the WorkSphere codebase.

---

## 1. Introduction

### What is a Progressive Web App (PWA)?

A Progressive Web App is a type of web application that leverages modern browser APIs and architectural patterns to deliver a native app-like experience. PWAs are built with progressive enhancement as a core principle, meaning they work for every user regardless of browser choice, while being fully functional on modern browsers that support advanced features.

A PWA is characterized by:

- **Installability** — Users can add the application to their home screen or desktop without going through an app store.
- **Offline capability** — The application remains functional under poor or absent network conditions through service worker caching.
- **Push notifications** — Re-engagement is supported via system-level push notifications.
- **Security** — PWAs must be served over HTTPS to ensure the integrity of service worker interception.

### Benefits of PWAs

- **Performance** — Cached assets load instantly, reducing time-to-interactive and eliminating redundant network requests.
- **Reliability** — The application functions offline or on unreliable networks through intelligent caching strategies.
- **Engagement** — Push notifications and home screen installation increase user retention.
- **Reduced bandwidth** — Only essential resources are fetched from the network; the rest are served from local cache.
- **Discoverability** — PWAs are indexed by search engines like any standard web application.

### How WorkSphere Uses PWA Features

WorkSphere implements a full PWA stack to ensure that workspace discovery, venue browsing, and collaborative editing remain available under poor connectivity conditions. The implementation includes:

| Component | File | Purpose |
| :--- | :--- | :--- |
| Service Worker | `public/sw.js` | Asset caching, network interception, Background Sync, push notifications |
| Web App Manifest | `public/manifest.json` | Installable metadata, display configuration, app shortcuts |
| PWA Hook | `src/hooks/usePWA.tsx` | Service Worker registration and network status tracking |
| Offline Page | `src/app/offline/page.tsx` | Fallback UI when the network is unavailable |
| Offline Storage | `src/lib/offlineStorage.ts` | IndexedDB schema and offline action queue helpers |

```mermaid
graph TD
    subgraph Client App
        UI[UI Views & React State] <--> SW[Service Worker]
        UI <--> IDB[(IndexedDB: worksphere-offline)]
    end

    subgraph Service Worker
        Cache[(Cache Storage)]
        SW — Cache-First --> Cache
        SW — Network-First --> API[Next.js API]
    end

    subgraph External
        Tiles[OpenStreetMap Tiles]
        Images[Unsplash Images]
        PushService[Push Service]
    end

    SW — Cache-First --> Tiles
    SW — Cache-First --> Images
    PushService — Push Event --> SW
    API <--> DB[(PostgreSQL Database)]
```

---

## 2. Web App Manifest

The Web App Manifest is a JSON file that tells the browser how the application should behave when installed on a device. WorkSphere's manifest is located at `public/manifest.json`.

### Manifest Fields

| Field | Value | Description |
| :--- | :--- | :--- |
| `name` | `"WorkSphere"` | The full name displayed during installation and on the home screen. |
| `short_name` | `"WorkSphere"` | A condensed name used where space is limited (e.g., home screen icon label). |
| `description` | `"AI-Powered Remote Workspace Finder..."` | A brief description of the application's purpose. |
| `start_url` | `"/"` | The URL loaded when the user launches the application from the home screen. |
| `display` | `"standalone"` | Removes browser UI elements (address bar, navigation) for a native app experience. |
| `background_color` | `"#000000"` | The background color shown during the application's loading phase. |
| `theme_color` | `"#2563eb"` | The browser's theme color applied to the title bar and system UI. |
| `orientation` | `"portrait-primary"` | Locks the display to portrait orientation. |
| `categories` | `["productivity", "utilities", "lifestyle"]` | Categories for app store discovery. |
| `scope` | `/` (implicit) | Defines the set of URLs that the application controls. When omitted, defaults to the manifest directory. |

### Icons

WorkSphere uses a single SVG icon with the `any` size and `maskable` purpose:

```json
{
  "src": "/icons/icon.svg",
  "sizes": "any",
  "type": "image/svg+xml",
  "purpose": "any maskable"
}
```

The `maskable` purpose ensures the icon renders correctly on Android adaptive icons, where the system applies a mask to the icon shape.

### Shortcuts

Shortcuts provide quick access to specific application features directly from the home screen:

```json
{
  "shortcuts": [
    {
      "name": "Find Workspace",
      "short_name": "Find",
      "description": "Find a workspace near you",
      "url": "/ai"
    }
  ]
}
```

### Screenshots

The `screenshots` field provides preview images for app store listings and browser install prompts. WorkSphere does not currently include screenshots in its manifest, but they can be added to improve install conversion rates:

```json
{
  "screenshots": [
    {
      "src": "/screenshots/desktop.png",
      "sizes": "1280x720",
      "type": "image/png",
      "form_factor": "wide",
      "label": "WorkSphere workspace discovery"
    },
    {
      "src": "/screenshots/mobile.png",
      "sizes": "720x1280",
      "type": "image/png",
      "form_factor": "narrow",
      "label": "WorkSphere on mobile"
    }
  ]
}
```

Screenshots with `form_factor: "wide"` are shown on desktop, while `form_factor: "narrow"` screenshots are shown on mobile.

### Display Modes

The `display` field controls how the application renders when launched from the home screen:

| Mode | Behavior |
| :--- | :--- |
| `standalone` | Full-screen application without browser chrome. Used by WorkSphere. |
| `fullscreen` | Completely fullscreen with no system UI visible. |
| `minimal-ui` | Browser UI is minimized but still partially visible. |
| `browser` | Opens in a regular browser tab (default behavior). |

### Best Practices

- Always include both `name` and `short_name` to handle varying display contexts.
- Use SVG icons where possible for crisp rendering at all resolutions, but include a PNG fallback (192x192 and 512x512) for broader compatibility.
- Set `theme_color` to match your brand and ensure visual consistency between the browser chrome and the application.
- Use `"any maskable"` for icon `purpose` to support Android adaptive icons.
- Keep `start_url` relative to the manifest location for consistent behavior across domains.
- Test the manifest using Chrome DevTools' **Application > Manifest** panel.

---

## 3. Service Worker Overview

A Service Worker is a background script that runs separately from the main browser thread. It intercepts all network requests made by the application, enabling caching, offline support, and background processing.

### Service Worker Lifecycle

The lifecycle consists of three primary phases: registration, installation, and activation.

```text
  Registration
       |
       v
  Download & Parse
       |
       v
  Install Event
  (Precache assets)
       |
       v
  Activate Event
  (Clean old caches)
       |
       v
  Fetch Interception
  (Serve cached / network)
```

### Install Event

The `install` event fires when the browser downloads a new service worker. During this phase, essential assets are precached to ensure the application shell is available offline.

```javascript
const CACHE_NAME = "worksphere-v3";
const PRECACHE_ASSETS = ["/", "/offline", "/icons/icon.svg", "/manifest.json"];

self.addEventListener("install", (event) => {
  const tempCacheName = `${CACHE_NAME}-installing`;
  event.waitUntil(
    caches
      .open(tempCacheName)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.error("[SW] Install failed:", err);
        return self.skipWaiting();
      }),
  );
});
```

WorkSphere uses a temporary installation cache (`worksphere-v3-installing`) to avoid locking the active cache during installation. The `skipWaiting()` call ensures the new service worker activates immediately rather than waiting for existing tabs to close.

### Activate Event

The `activate` event fires after installation. The service worker uses this phase to clean up outdated caches and claim all open clients so they immediately begin using the new version.

```javascript
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter(
              (name) =>
                name !== CACHE_NAME &&
                name !== IMAGE_CACHE_NAME &&
                !name.endsWith("-installing"),
            )
            .map((name) => caches.delete(name)),
        );
      })
      .then(() => self.clients.claim()),
  );
});
```

### Fetch Event

The `fetch` event intercepts every network request made by the application. WorkSphere routes requests through different caching strategies based on the request URL and resource type.

| Request Type | Strategy | Cache Name |
| :--- | :--- | :--- |
| `/api/venues` | Network-First | `worksphere-v3` |
| OpenStreetMap tiles | Cache-First | `worksphere-images-v4` |
| Unsplash images | Cache-First | `worksphere-images-v4` |
| Local assets and navigation | Network-First | `worksphere-v3` |
| Non-GET requests (`POST`, `PUT`, `DELETE`) | Bypass Service Worker | N/A |

### Update Flow

When the service worker script is modified, the browser detects the byte-difference and begins the update flow:

1. The browser downloads the new service worker script.
2. The `install` event fires and precaches assets into a temporary cache.
3. The new service worker enters a `waiting` state (unless `skipWaiting()` is called).
4. Once all open tabs are closed (or `skipWaiting()` is called), the `activate` event fires.
5. Old caches are deleted and `clients.claim()` hands control to the new worker.

### Cache Versioning

Cache versioning ensures that stale assets from previous deployments are not served to users. WorkSphere maintains two versioned caches:

| Cache Name | Version | Contents |
| :--- | :--- | :--- |
| `worksphere-v3` | 3 | Application shell assets and API responses |
| `worksphere-images-v4` | 4 | External map tiles and Unsplash images |

When a new version is deployed, the version suffix is incremented and old caches are purged during the `activate` event.

### Cache Invalidation

Cache invalidation occurs through two mechanisms:

1. **Activation cleanup** — The `activate` handler deletes any cache whose name does not match the current `CACHE_NAME` or `IMAGE_CACHE_NAME`.
2. **LRU eviction** — The image cache uses a Least Recently Used eviction policy enforced by `enforceImageCacheQuota()` to prevent unbounded cache growth. This is tracked through an `imageCacheLRU` IndexedDB store that records access timestamps and response sizes.

---

## 4. Caching Strategies

WorkSphere implements two primary caching strategies, each applied to specific resource types based on their update frequency and importance.

### Cache-First

The Cache-First strategy checks the local cache before making any network request. If the resource exists in the cache, it is returned immediately without contacting the network. If the cache misses, the resource is fetched from the network and written to the cache for future use.

**Request flow:**

```text
  Request
     |
     v
  Cache exists?
  +-- Yes -> Return cached response
  +-- No  -> Fetch from network
              +-- Success -> Cache response, return to client
              +-- Failure -> Return 503 fallback
```

**Advantages:**

- Immediate response times for previously cached resources.
- No network bandwidth consumed for cache hits.
- Fully functional offline after the first successful fetch.
- Reduces load on external services (map tile servers, image CDNs).

**Disadvantages:**

- Stale content may be served if the cached resource has been updated on the server.
- Cache may consume significant storage on the device.
- First-time visitors must wait for a full network fetch.

**Best use cases:**

- Resources that change infrequently or never change.
- External assets where the server does not provide versioned URLs.
- Large binary assets where re-downloading is expensive.

**WorkSphere implementation:**

```javascript
// Cache-First for OpenStreetMap tiles and Unsplash images
if (isExternalAsset) {
  event.respondWith(
    caches.open(IMAGE_CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          event.waitUntil(touchLRURecord(event.request.url));
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse.status === 200 || networkResponse.status === 0) {
            const responseToCache = networkResponse.clone();
            cache.put(event.request, responseToCache);
          }
          return networkResponse;
        });
      });
    }),
  );
}
```

**Example asset types:**

| Asset | Reason |
| :--- | :--- |
| OpenStreetMap tiles | Raster tiles are immutable; a tile at a given coordinate never changes. |
| Unsplash images | Venue photos are static once uploaded. |
| Fonts | Web fonts are versioned and rarely change within a deployment cycle. |

### Network-First

The Network-First strategy attempts to fetch the latest version of a resource from the network. If the network request succeeds, the response is cached and returned. If the network fails (offline or timeout), the cached version is returned as a fallback.

**Request flow:**

```text
  Request
     |
     v
  Fetch from network
  +-- Success -> Cache response, return to client
  +-- Failure -> Cache exists?
                +-- Yes -> Return cached response
                +-- No  -> Return offline fallback
```

**Advantages:**

- Always serves the most current content when connectivity is available.
- Provides graceful offline fallback for previously visited pages.
- Prevents stale data from being served in normal operating conditions.

**Disadvantages:**

- Slightly slower on first visit compared to Cache-First (requires network round-trip).
- Dependent on network quality for initial response time.
- Cache may become stale if the user has been offline for an extended period.

**Best use cases:**

- API endpoints that return frequently changing data.
- HTML navigation requests where content freshness is critical.
- Application shell routes that should always attempt to load the latest version.

**WorkSphere implementation:**

```javascript
// Network-First for local assets and navigation
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
```

### Strategy Comparison

| Aspect | Cache-First | Network-First |
| :--- | :--- | :--- |
| **Speed** | Immediate (cache hit) | Requires network round-trip |
| **Freshness** | May serve stale content | Always serves latest (when online) |
| **Offline support** | Full (after first fetch) | Partial (serves cached fallback) |
| **Bandwidth usage** | Minimal after first load | Higher (fetches every time) |
| **Best for** | Static external assets | Dynamic local content and APIs |
| **WorkSphere use** | Map tiles, images | Routes, API responses, navigation |
| **Cache name** | `worksphere-images-v4` | `worksphere-v3` |

---

## 5. Asset Precaching Rules

Precaching is the process of downloading and caching specific assets during the service worker installation phase. These assets are guaranteed to be available offline before the service worker activates.

### Files That Should Be Precached

| Asset | Path | Reason |
| :--- | :--- | :--- |
| Landing page | `/` | Entry point that users see first; must load offline. |
| Offline fallback | `/offline` | Displayed when navigation requests fail. |
| Application icon | `/icons/icon.svg` | Used in notifications, manifest, and UI branding. |
| Web App Manifest | `/manifest.json` | Required for installability and PWA metadata. |

### Precaching Configuration in WorkSphere

```javascript
const PRECACHE_ASSETS = ["/", "/offline", "/icons/icon.svg", "/manifest.json"];
```

### Assets NOT Precached

The following resources are cached at runtime rather than during installation:

- JavaScript bundles and CSS files — These are handled by Next.js build hashing and are fetched on demand.
- Fonts — Cached on first access via the Cache-First strategy.
- API responses — Fetched and cached dynamically by the Network-First strategy.
- External map tiles and images — Cached on demand via the Cache-First strategy.

### Exclusions

The following should never be precached:

- Large binary files (media, PDFs, zip archives).
- API responses that change frequently.
- Authentication tokens or session-specific data.
- Resources from third-party domains (cannot be precached due to CORS restrictions).
- Download endpoints (explicitly bypassed in the service worker).

```javascript
// Download endpoints are excluded from caching
if (event.request.url.includes("/download")) {
  return;
}
```

### Cache Naming Strategy

WorkSphere uses a prefix-plus-version format for cache names:

```text
worksphere-{type}-v{version}
```

| Cache Name | Purpose |
| :--- | :--- |
| `worksphere-v3` | Application shell and dynamic API responses |
| `worksphere-images-v4` | External map tiles and venue images |
| `worksphere-v3-installing` | Temporary cache used during the install phase |

### Cache Versioning Recommendations

- Increment the version number in the cache name whenever cached asset content changes.
- Include the version number in the service worker filename or use a build hash for cache-busting.
- Remove all old cache versions during the `activate` event.
- Use separate caches for static shell assets and dynamic runtime assets to avoid unintended eviction.

---

## 6. Runtime Caching

Runtime caching refers to the caching of resources as they are requested during normal application use, rather than during the installation phase.

### API Requests

WorkSphere applies a Network-First strategy to API requests, specifically the `/api/venues` endpoint. When the network is available, the response is fetched fresh and stored in the `worksphere-v3` cache. When offline, the last cached response is returned.

```javascript
const isVenuesApi = event.request.url.includes("/api/venues");

if (isVenuesApi) {
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
}
```

### Images

External images from `images.unsplash.com` are cached using the Cache-First strategy in the `worksphere-images-v4` cache. Each cached image is tracked in the `imageCacheLRU` IndexedDB store with a timestamp and estimated size to support LRU eviction.

### Third-Party Assets

External resources (map tiles, images) are cached separately from local application assets to prevent cache pollution. The `IMAGE_CACHE_NAME` cache is dedicated to third-party content and has its own eviction policy.

| Resource | Domain | Cache Strategy |
| :--- | :--- | :--- |
| Map tiles | `tile.openstreetmap.org` | Cache-First |
| Venue images | `images.unsplash.com` | Cache-First |

### Fonts

Web fonts are treated as static assets and are served from the Cache-First strategy when fetched. Once cached, fonts do not need to be re-downloaded until the cache is cleared or a new service worker version removes them.

### Dynamic Content

Navigation requests and general local assets use the Network-First strategy. When the network fails, navigation requests receive the offline fallback page (`/offline`), while other resources receive a `503 Service Unavailable` response.

### Expiration Policies

WorkSphere manages cache expiration through:

| Mechanism | Scope | Behavior |
| :--- | :--- | :--- |
| Activation cleanup | All caches | Old cache versions are deleted when a new service worker activates. |
| LRU eviction | Image cache | Images are evicted when the cache exceeds 20MB, targeting the least recently accessed entries. |
| IndexedDB cleanup | Offline data | Venues and searches older than 7 days are removed by `cleanupOldData()`. |

The image cache is capped at 20MB to prevent iOS Safari (which has a stricter storage quota) from automatically evicting all cached data.

```javascript
const MAX_IMAGE_CACHE_BYTES = 20 * 1024 * 1024; // 20MB
```

---

## 7. Offline Support

Offline support ensures the application remains functional and provides a meaningful user experience when the device has no network connectivity.

### Offline Fallback Page Configuration

WorkSphere includes a dedicated offline page at `src/app/offline/page.tsx` that is precached during the service worker installation phase. When a navigation request fails due to network unavailability, the service worker returns the cached offline page.

```javascript
if (event.request.mode === "navigate") {
  return caches.match(OFFLINE_URL);
}
```

The offline page provides:

- A clear visual indicator that the device is offline.
- A timestamp showing when the device was last connected.
- A retry button that tests connectivity before reloading.
- A list of features that remain available offline (e.g., viewing saved venues).

### Offline Navigation Handling

Navigation requests receive special treatment in the service worker:

```text
  Navigation request
       |
       v
  Fetch from network
  +-- Success -> Cache response, return
  +-- Failure -> Return cached page (if available)
                +-- Fallback: Return /offline page
```

This ensures users always see a meaningful page rather than a browser error.

### User Experience During Network Loss

When the user loses connectivity:

1. Previously cached pages continue to load normally (Network-First cache fallback).
2. Uncached navigation requests redirect to the offline page.
3. API requests that fail return a `503` status, which the application layer can detect and handle.
4. Background Sync queues any pending actions (favorites, ratings, CRDT updates) in IndexedDB and retries them when connectivity is restored.

### Recommended Offline Page Behavior

An effective offline fallback page should:

- Clearly communicate that the device is offline.
- Provide a mechanism to retry the connection.
- List features that remain available offline.
- Avoid breaking the application shell or layout.
- Include the application's branding and theme colors.
- Not rely on external resources (images, fonts, scripts) that may not be cached.

### Cache Fallback Flow

```text
  User navigates to /venues
       |
       v
  Service Worker intercepts
       |
       v
  Fetch from network
  +-- Success -> Cache response, return /venues
  +-- Failure -> Check cache for /venues
                +-- Hit -> Return cached /venues
                +-- Miss -> Return /offline page
```

---

## 8. Web Push Notifications

Web Push Notifications allow the application to send messages to the user even when the application is not actively open in a browser tab.

### Architecture

```text
  +----------------+
  |    Browser     |
  |   (Client)     |
  +-------+--------+
          | Subscribe
          v
  +----------------+      +----------------+
  |     Push       |<-----|  Application   |
  |    Service     | Push |    Server      |
  |   (FCM/VAPID) |      |   (Backend)    |
  +-------+--------+      +----------------+
          |
          v
  +----------------+
  |    Service     |
  |    Worker      |
  | (push event)   |
  +----------------+
```

The four components involved:

| Component | Role |
| :--- | :--- |
| **Browser** | Manages notification permissions, stores push subscriptions, and displays notifications. |
| **Service Worker** | Listens for `push` and `notificationclick` events. Renders notifications and handles user interaction. |
| **Push Service** | A vendor-provided service (e.g., Firebase Cloud Messaging) that manages message delivery from the server to the browser. |
| **Application Server** | Sends push messages by forwarding a payload to the Push Service using the stored subscription. |

### Setup Process

#### Generate VAPID Keys

VAPID (Voluntary Application Server Identification) keys authenticate the application server when sending push messages. A key pair consists of a public key (shared with the browser) and a private key (kept on the server).

WorkSphere uses two environment variables for VAPID keys:

| Variable | Location | Purpose |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Client-side | Used by the browser to subscribe to push notifications. |
| `VAPID_PRIVATE_KEY` | Server-side | Used by the application server to sign push messages. |

Generate a VAPID key pair using the `web-push` library:

```bash
npx web-push generate-vapid-keys
```

#### PushManager

The `PushManager` API is used to subscribe to push notifications. The subscription is created through the service worker's registration:

```javascript
const registration = await navigator.serviceWorker.ready;
const subscription = await registration.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
});
```

#### Notification Permission Flow

Before subscribing, the browser must request notification permission from the user:

```javascript
const permission = await Notification.requestPermission();

if (permission === "granted") {
  // Proceed with push subscription
}
```

The permission flow has three states:

| State | Meaning |
| :--- | :--- |
| `default` | The user has not been prompted yet. The permission dialog will be shown. |
| `granted` | The user has approved notifications. Subscriptions can be created. |
| `denied` | The user has blocked notifications. The browser will not prompt again. |

> [!WARNING]
> Permission requests must be triggered by a direct user action (button click, etc.). Browsers block programmatic permission requests and will silently reject them.

#### Push Subscription

The subscription object contains the endpoint URL and encryption keys needed to send push messages:

```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/...",
  "keys": {
    "p256dh": "...",
    "auth": "..."
  }
}
```

#### Store Subscription on Backend

The subscription object must be sent to the application server and stored for later use when sending push messages. The server associates the subscription with the user's account.

#### Send Notifications

The application server sends a push message by making an HTTP request to the subscription's endpoint, signed with the VAPID private key:

```javascript
const webPush = require("web-push");

webPush.setVapidDetails(
  "mailto:admin@worksphere.app",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
);

await webPush.sendNotification(
  subscription,
  JSON.stringify({
    title: "New venue nearby",
    body: "A cafe matching your search just opened.",
    url: "/ai",
  }),
);
```

#### Handle the push Event

The service worker listens for `push` events and displays a notification:

```javascript
self.addEventListener("push", (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || "New update from WorkSphere",
    icon: "/icons/icon.svg",
    badge: "/icons/icon.svg",
    vibrate: [100, 50, 100],
    data: { url: data.url || "/" },
    actions: [
      { action: "open", title: "Open" },
      { action: "dismiss", title: "Dismiss" },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "WorkSphere", options),
  );
});
```

#### Handle the notificationclick Event

When the user clicks a notification, the service worker focuses an existing tab or opens a new one:

```javascript
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") return;

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url === url && "focus" in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      }),
  );
});
```

### Security Considerations

- **HTTPS is mandatory** — Service workers and the Push API require a secure context. Push subscriptions will fail on non-HTTPS origins (except `localhost` for development).
- **VAPID private key protection** — Never expose the private key in client-side code or version control. Use environment variables and server-side only access.
- **Subscription validation** — Validate subscription objects on the server before storing them. Reject malformed or tampered endpoints.
- **CORS restrictions** — Cross-origin push message delivery is restricted by the browser. The push subscription endpoint must be associated with the same origin.
- **Rate limiting** — Implement server-side rate limiting on push notification dispatch to prevent abuse.

### HTTPS Requirements

| Requirement | Detail |
| :--- | :--- |
| Service Worker registration | Only available in secure contexts (HTTPS or `localhost`). |
| Push API subscription | Requires HTTPS; the browser will reject subscriptions on HTTP origins. |
| VAPID authentication | The application server must present a valid VAPID signature with each push request. |

---

## 9. Update Strategy

When a new version of the service worker is deployed, the browser must transition from the old version to the new one without serving stale content.

### Detecting a New Service Worker

The browser checks for service worker updates:

- On page navigation (when the document is loaded).
- On a manual call to `registration.update()`.
- At 24-hour intervals for active service workers.

When the browser downloads a new service worker script and detects a byte-level difference from the currently installed version, the update flow begins.

### skipWaiting

The `skipWaiting()` method tells the new service worker to activate immediately without waiting for existing tabs to close:

```javascript
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(tempCacheName)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});
```

WorkSphere calls `skipWaiting()` during installation to ensure updates are applied as quickly as possible.

### clients.claim

The `clients.claim()` method allows the newly activated service worker to immediately take control of all open browser tabs:

```javascript
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter(
              (name) => name !== CACHE_NAME && name !== IMAGE_CACHE_NAME,
            )
            .map((name) => caches.delete(name)),
        );
      })
      .then(() => self.clients.claim()),
  );
});
```

Without `clients.claim()`, the old service worker would continue controlling open tabs until those tabs are closed and reopened.

### Prompting Users to Refresh

For cases where `skipWaiting()` alone is insufficient (e.g., the application state needs user confirmation), consider implementing a refresh prompt:

1. The new service worker sends a message to the client via `postMessage()`.
2. The client displays a banner or dialog informing the user an update is available.
3. The user clicks "Refresh" to reload the page with the new version.

```javascript
// In the service worker
self.addEventListener("controllerchange", () => {
  self.clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      client.postMessage({ type: "UPDATE_AVAILABLE" });
    });
  });
});
```

### Avoiding Stale Caches

The activation handler ensures stale caches are removed immediately:

```javascript
// Delete all caches except the current version
cacheNames
  .filter(
    (name) =>
      name !== CACHE_NAME &&
      name !== IMAGE_CACHE_NAME &&
      !name.endsWith("-installing"),
  )
  .map((name) => caches.delete(name));
```

For additional protection, increment the cache version suffix whenever asset content changes:

```javascript
const CACHE_NAME = "worksphere-v3"; // Increment to v4 when content changes
```

---

## 10. Best Practices

### Cache Versioning

- Always include a version number in cache names.
- Increment the version when cached content changes.
- Use separate caches for static and dynamic resources.
- Clean up old cache versions during the `activate` event.

### Avoiding Cache Bloat

- Implement LRU eviction for runtime caches that grow unbounded.
- Cap the maximum size of individual caches (WorkSphere limits the image cache to 20MB).
- Set expiration policies for cached API responses.
- Remove temporary caches (e.g., installation caches) after they are no longer needed.

| Cache Type | Recommended Limit | WorkSphere Implementation |
| :--- | :--- | :--- |
| Static assets | 100 entries | Versioned, cleaned on activation |
| Images | 150 entries | 20MB cap with LRU eviction |
| API responses | 50 entries | Overwritten on each fresh fetch |
| Map tiles | 200 entries | Managed by image cache LRU |

### Security Recommendations

- Always serve the application over HTTPS.
- Never cache sensitive user data (authentication tokens, session cookies) in the Cache Storage API.
- Validate all push notification payloads before displaying them.
- Do not expose VAPID private keys in client-side code.
- Implement Content Security Policy (CSP) headers to restrict resource loading.
- Use the `Cache-Control` header to control how the browser caches responses before they reach the service worker.

### Testing Offline Mode

- Use Chrome DevTools' **Network > Offline** toggle to simulate disconnection.
- Verify that precached assets load while offline.
- Verify that the offline page appears for uncached navigation requests.
- Trigger Background Sync events manually through **Application > Service Workers > Sync**.
- Test on real devices with airplane mode for accurate network behavior.
- Use Safari's Web Inspector to verify iOS-specific PWA behavior.

### Lighthouse Recommendations

Run Lighthouse audits to validate PWA compliance:

- **Installability** — Verify the manifest is valid and the service worker registers correctly.
- **PWA Optimized** — Ensure the application redirects HTTP to HTTPS, has a valid viewport meta tag, and provides a splash screen.
- **Offline Experience** — Confirm the application works without network connectivity.
- **Push Notifications** — (If implemented) Verify the notification permission flow is handled correctly.

Target a score of 100 on the PWA Lighthouse audit category.

### Performance Optimization

- Keep the precached asset list minimal to reduce installation time.
- Use `event.waitUntil()` to prevent the service worker from terminating before asynchronous operations complete.
- Clone responses before caching or returning them (via `response.clone()`) to avoid consuming the response body twice.
- Use `fetch()` with appropriate `cache` options where applicable.
- Minimize the size of the service worker script to reduce download and parse time.

### Accessibility Considerations

- Ensure the offline page is fully accessible (proper heading hierarchy, screen reader support, keyboard navigation).
- Use `aria-live` regions to announce connectivity changes to screen readers.
- Provide meaningful text alternatives for notification actions.
- Ensure push notification content is concise and informative for assistive technologies.
- Test the offline page with screen readers (VoiceOver, NVDA, JAWS).

---

## 11. Troubleshooting

### Service Worker Not Registering

**Symptoms:** Service worker does not appear in DevTools, PWA features are non-functional.

**Possible causes and solutions:**

- The service worker file (`public/sw.js`) is not accessible. Verify the URL is correct and the file exists.
- The page is served over HTTP (not HTTPS). Service workers require a secure context.
- A JavaScript syntax error in the service worker prevents parsing. Check the browser console for registration errors.
- The service worker scope is restricted by the `Service-Worker-Allowed` header. Ensure the service worker is placed in the root or a permitted directory.

### Stale Cache After Deployment

**Symptoms:** Users see old content or functionality after a new version is deployed.

**Possible causes and solutions:**

- The cache version name has not been incremented. Update the `CACHE_NAME` constant in `public/sw.js`.
- The `activate` handler is not cleaning up old caches. Verify the filter logic removes all caches except the current version.
- `skipWaiting()` or `clients.claim()` is not called. Ensure both are present in the install and activate handlers.
- The browser has not yet detected the service worker update. Navigate to **Application > Service Workers** and click **update**.

### Push Notifications Not Received

**Symptoms:** Notifications do not appear after sending from the server.

**Possible causes and solutions:**

- Notification permission is `denied`. Reset the permission in the browser settings.
- The VAPID keys on the client and server do not match. Verify `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are correctly configured.
- The push subscription has expired or been invalidated. Re-subscribe the user.
- The push payload is not valid JSON. The service worker's `event.data.json()` call will throw on malformed input.
- The service worker is not active. Check **Application > Service Workers** to confirm activation status.

### Manifest Errors

**Symptoms:** The application cannot be installed, or Chrome DevTools reports manifest issues.

**Possible causes and solutions:**

- `manifest.json` is not accessible at the expected URL. Verify the `<link rel="manifest">` tag in the HTML.
- The manifest contains invalid JSON. Validate the JSON syntax.
- Required fields are missing. Ensure `name`, `start_url`, `display`, and `icons` are present.
- Icons do not meet minimum size requirements. Include at least a 192x192 PNG and a 512x512 PNG.

### HTTPS Problems

**Symptoms:** Service worker registration fails, or the Push API is unavailable.

**Possible causes and solutions:**

- The application is served over plain HTTP. Use HTTPS in production and ensure `localhost` is used for local development.
- A mixed-content issue exists (HTTPS page loading HTTP resources). Ensure all resources are served over HTTPS.
- A self-signed certificate is being used. Browsers reject service worker registrations on origins with invalid certificates.

### Cache Update Issues

**Symptoms:** New service worker installs but does not activate, or old content persists.

**Possible causes and solutions:**

- Open tabs are preventing the old service worker from releasing control. Close all tabs and reopen the application.
- `skipWaiting()` is not implemented. Add it to the install handler for immediate activation.
- `clients.claim()` is not implemented. Add it to the activate handler to take control of open tabs immediately.
- The browser is caching the service worker script itself. Add a cache-busting query parameter or use a content hash in the filename.

---

## 12. References

### MDN Web Docs

- [Progressive Web Apps (PWA)](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Cache API](https://developer.mozilla.org/en-US/docs/Web/API/Cache)
- [Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API)
- [Web App Manifest](https://developer.mozilla.org/en-US/docs/Web/Manifest)
- [Background Sync API](https://developer.mozilla.org/en-US/docs/Web/API/Background_Sync_API)

### Google web.dev

- [Learn PWA](https://web.dev/learn/pwa)
- [Service Workers: an Introduction](https://web.dev/articles/service-worker-lifecycle)
- [The Offline Cookbook](https://web.dev/articles/the-offline-cookbook)
- [Push Notifications](https://web.dev/push-notifications-overview/)
- [Web Push Notification Guidelines](https://web.dev/articles/push-notifications-notification-behaviour)

### W3C Specifications

- [Service Worker Specification](https://www.w3.org/TR/service-workers/)
- [Push API Specification](https://www.w3.org/TR/push-api/)
- [Web App Manifest Specification](https://www.w3.org/TR/appmanifest/)
- [Notifications API Specification](https://www.w3.org/TR/notifications/)
- [Background Sync Level 2](https://wicg.github.io/background-sync/spec/)

### WorkSphere Documentation

- [`PWA_STRATEGY.md`](./PWA_STRATEGY.md) — Overall PWA caching and offline synchronization strategy.
- [`PWA_ASSET_CACHING.md`](./PWA_ASSET_CACHING.md) — Detailed asset caching strategy documentation.
- [`PWA_SERVICE_WORKER_SPECIFICATION.md`](./PWA_SERVICE_WORKER_SPECIFICATION.md) — Service Worker architecture specification.
- [`PWA_TROUBLESHOOTING.md`](./PWA_TROUBLESHOOTING.md) — PWA troubleshooting guide.
- [`PWA_PUSH_DEBUG.md`](./PWA_PUSH_DEBUG.md) — Push notification debugging guide.
- [`PWA_SYNC_DEBUG.md`](./PWA_SYNC_DEBUG.md) — Background Sync debugging guide.
- [`PWA_TESTING_GUIDELINES.md`](./PWA_TESTING_GUIDELINES.md) — PWA testing guidelines.
