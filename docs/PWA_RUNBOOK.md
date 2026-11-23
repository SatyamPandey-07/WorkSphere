# PWA Runbook: Service Worker Lifecycle and IndexedDB Synchronization

This runbook explains how WorkSphere's offline layer works end to end: how the service worker is installed and updated, which caches it keeps, how requests are routed (network-first vs cache-first), how the IndexedDB database is created and upgraded, how background sync replays queued work, and how to debug stale state in DevTools.

It describes the code as it exists in the repository. When this document and the code disagree, the code wins. Please update this file in the same PR as any change to the files below.

## Source of truth

| Area                                                   | File                                                |
| ------------------------------------------------------ | --------------------------------------------------- |
| Service worker (registered at `/sw.js`)                | `public/sw.js`                                      |
| Service worker registration and sync tag registration  | `src/hooks/usePWA.tsx`                              |
| IndexedDB connection and schema (`worksphere-offline`) | `src/lib/offlineReviewSync.ts` & `public/sw.js`     |
| Secondary offline cache (`WorkSphereOfflineDB`)        | `src/lib/offline/db.ts` & `src/lib/offlineStore.ts` |
| Offline sync queue helpers                             | `src/lib/offline/`                                  |
| Image cache LRU helpers                                | `src/lib/swCacheLru.ts`                             |

Related guides: [PWA_SERVICE_WORKER_GUIDE.md](./PWA_SERVICE_WORKER_GUIDE.md), [PWA_TROUBLESHOOTING.md](./PWA_TROUBLESHOOTING.md), [OFFLINE_INDEXEDDB_SYNC.md](./OFFLINE_INDEXEDDB_SYNC.md).

## 1. Architecture at a glance

```mermaid
flowchart LR
  Page["Page (Next.js app)"] -->|register /sw.js| SW["Service worker (public/sw.js)"]
  Page -->|read and write| IDB[("IndexedDB worksphere-offline")]
  SW -->|fetch handler| Caches[("Cache Storage")]
  SW -->|sync events| IDB
  SW -->|replay queued work| API["API routes"]
  Page -->|online or offline| Net["Network"]
  SW --> Net
```

Three storage areas are involved:

1. **Cache Storage** holds HTTP responses (pages, API JSON, map tiles, images).
2. **IndexedDB** (`worksphere-offline`) holds app data and the queues of actions made while offline.
3. **The service worker registration itself**, which has its own install, waiting and active states.

## 2. Service worker lifecycle

`usePWA.tsx` registers the worker with `navigator.serviceWorker.register("/sw.js")`.

```mermaid
sequenceDiagram
  participant P as Page
  participant B as Browser
  participant SW as New service worker
  P->>B: register("/sw.js")
  B->>SW: install event
  SW->>SW: precache core assets into worksphere-v3-installing
  Note over SW: Does not call skipWaiting automatically
  SW-->>B: installed, enters waiting state
  P->>SW: postMessage({ type: "SKIP_WAITING" })
  SW->>SW: skipWaiting()
  B->>SW: activate event
  SW->>SW: delete caches not on the keep list
  SW->>SW: clients.claim()
  SW->>SW: delete any cache ending in -installing
```

| Phase    | What the code does                                                                                                                                                                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| install  | Opens a temporary cache named `worksphere-v3-installing` and calls `addAll` for `/`, `/offline`, `/icons/icon.svg`, `/manifest.json`. Errors are logged, they do not abort the install.                                                                                       |
| waiting  | The worker deliberately does **not** call `skipWaiting()` on its own. This avoids infinite loaders when a new version takes over mid session. The page must send a `SKIP_WAITING` message.                                                                                    |
| activate | Deletes every cache whose name is not one of `worksphere-v3`, `worksphere-images-v4`, `worksphere-maptiles-v1`, `worksphere-video-tours-v1`, `worksphere-prefetch-v1` (or ending in `-installing`), then calls `clients.claim()`, then removes leftover `-installing` caches. |

To ship a change that must invalidate old cached responses, bump the relevant cache name constant at the top of `public/sw.js`. The activate step then removes the old cache on every client.

## 3. Cache tiers

All names are constants at the top of `public/sw.js`.

| Cache name                   | Used for                                                              | Strategy                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `worksphere-v3`              | Pages, static assets, `/api/venues`, `/api/reservations/availability` | Network-first, falls back to cache                                                                           |
| `worksphere-images-v4`       | `images.unsplash.com` assets                                          | Cache-first with LRU eviction, capped at 20 MB (`MAX_IMAGE_CACHE_BYTES`) so iOS Safari does not kill the PWA |
| `worksphere-maptiles-v1`     | `tile.openstreetmap.org` and `basemaps.cartocdn.com` tiles            | Cache-first                                                                                                  |
| `worksphere-venue-photos-v1` | `res.cloudinary.com` and `images.pexels.com` photos                   | Stale-while-revalidate                                                                                       |
| `worksphere-video-tours-v1`  | Video tour assets                                                     | Managed by the video helpers in `sw.js`                                                                      |
| `worksphere-prefetch-v1`     | Routes and tiles prefetched by the page                               | Checked first for every GET                                                                                  |

Note on naming: the map tile cache is called `worksphere-maptiles-v1` in the code. If you see `worksphere-offline-map-tiles-v1` in older notes or tickets, that is not the name the service worker uses today.

## 4. Request routing: network-first vs cache-first

Every `GET` goes through the fetch handler. Non-GET requests and URLs containing `/download` are ignored by the worker and go straight to the network.

```mermaid
flowchart TD
  R["GET request"] --> D{"method GET and not /download?"}
  D -- no --> NET["Browser handles it, no interception"]
  D -- yes --> PF{"in worksphere-prefetch-v1?"}
  PF -- yes --> HIT["Return prefetched response"]
  PF -- no --> T{"Request type"}
  T -- "/api/venues or /api/reservations/availability" --> NF1["Network-first, cache successful responses in worksphere-v3"]
  T -- "map tiles" --> CF1["Cache-first in worksphere-maptiles-v1"]
  T -- "cloudinary or pexels photos" --> SWR["Stale-while-revalidate in worksphere-venue-photos-v1"]
  T -- "images.unsplash.com" --> CF2["Cache-first in worksphere-images-v4 with LRU quota"]
  T -- "everything else" --> NF2["Network-first, cache in worksphere-v3, navigations fall back to /offline"]
```

Details worth knowing:

- **API routes (network-first).** On failure the worker returns the cached response if one exists. If not, it answers `200` with `{ "venues": [], "offline": true, "cached": true }` for `/api/venues`, or `{ "seats": [], "offline": true, "cached": true }` for reservation availability. UI code should check the `offline` flag.
- **Map tiles (cache-first).** A cached tile is returned without hitting the network. Status `0` (opaque) responses are cached too. Offline misses return `503`.
- **Venue photos (stale-while-revalidate).** The cached photo is returned immediately and the network fetch refreshes the cache in the background through `event.waitUntil`.
- **Unsplash images (cache-first with quota).** Size comes from `content-length`, or a 400 KB estimate for opaque responses. On `QuotaExceededError` the worker evicts and retries once.
- **Everything else (network-first).** Successful responses are copied into `worksphere-v3`. When the network fails and nothing is cached, page navigations get the `/offline` page, other requests get `503`.

## 5. IndexedDB Databases

WorkSphere intentionally uses separate IndexedDB databases for distinct functional domains. Understanding this separation is critical when inspecting storage or making schema changes:

1. **`worksphere-offline` (Primary PWA Store)**: The primary offline storage for venues, cached searches, review queues, image LRU tracking, and generic pending actions. Defined in `src/lib/offlineReviewSync.ts` and mirrored in the service worker (`public/sw.js`).
2. **`WorkSphereOfflineDB` (Secondary Domain Outboxes)**: Dedicated outbox database for favorites, check-ins, and favorite tags. Defined in `src/lib/offline/db.ts` and used by `src/lib/offlineStore.ts`.

---

### Database 1: `worksphere-offline` (Version 9)

- **Database name:** `worksphere-offline`
- **Version constant:** `DB_VERSION = 9` in `src/lib/offlineReviewSync.ts`
- **Service Worker version:** Opened at version `9` via `openIndexedDB()` in `public/sw.js`
- **Open timeout:** 3 seconds. If `indexedDB.open` does not answer, the promise rejects with a `SecurityError`, which is what Safari Private Browsing causes. A one-time alert tells the user to leave Private Browsing.

#### Object Stores in `worksphere-offline`

Both the page-side code (`src/lib/offlineReviewSync.ts`) and the service worker (`public/sw.js`) define and maintain these 13 object stores:

| Store                  | Key Path              | Indexes                           | Purpose                                                           |
| ---------------------- | --------------------- | --------------------------------- | ----------------------------------------------------------------- |
| `venues`               | `id`                  | `type`, `savedAt`                 | Saved venue records                                               |
| `favorites`            | `id`                  | `savedAt`                         | Favorite venues (also updated by occupancy sync)                  |
| `searches`             | `query`               | `timestamp`                       | Search history                                                    |
| `pendingActions`       | `id` (auto-increment) | none                              | Generic queued actions (`crdt-sync`, `conversation-rename`, etc.) |
| `imageCacheLRU`        | `url`                 | `lastAccessed`                    | LRU bookkeeping for the image cache quota                         |
| `receiptExports`       | `bookingId`           | `status`, `createdAt`             | Receipt PDF export background jobs                                |
| `pendingFavorites`     | `id` (auto-increment) | none                              | Queued favorite mutations                                         |
| `availabilityDeltas`   | `venueId`             | `timestamp`                       | Last-known seat availability deltas                               |
| `recentlyViewedVenues` | `id`                  | `viewedAt`                        | Recently viewed venue history                                     |
| `pendingReviews`       | `id`                  | `venueId`, `status`, `createdAt`  | Offline review queue                                              |
| `preference_rankings`  | `id`                  | none                              | Ranked venue preferences                                          |
| `queued_reviews`       | `id`                  | `venueId`, `status`, `createdAt`  | Queued reviews for background replay                              |
| `unsyncedReviewDrafts` | `id`                  | `review.venueId`, `quarantinedAt` | Quarantined review drafts exceeding retry limit                   |

---

### Database 2: `WorkSphereOfflineDB` (Version 3)

- **Database name:** `WorkSphereOfflineDB`
- **Version constant:** `OFFLINE_DB_VERSION = 3` in `src/lib/offline/db.ts`
- **Opened by:** `src/lib/offlineStore.ts` and `src/lib/offline/db.ts`
- **Stores:** `favorites-outbox`, `checkins-outbox`, `favorite-tags-outbox`
- **Note:** `src/lib/offline/db.ts` is **not** the version authority for `worksphere-offline`.

---

### Schema Upgrade Protocol & VersionError Prevention

IndexedDB upgrades are additive and idempotent. Every store creation is guarded:

```ts
if (!database.objectStoreNames.contains("example")) {
  database.createObjectStore("example", { keyPath: "id" });
}
```

#### Understanding IndexedDB `VersionError`

Per the W3C IndexedDB specification, opening a database with a requested version lower than the version already established on disk triggers a fatal `VersionError`:

> `VersionError: The requested version (X) is less than the existing version (Y).`

This error occurs when page-side code upgrades `worksphere-offline` (e.g. to version 9) while the Service Worker in `public/sw.js` requests an older version (e.g. version 7). Because the Service Worker runs in a separate execution context, a version mismatch prevents the worker from opening the database, breaking background sync and offline action replay.

#### Upgrade Lifecycle Handling:

1. **`onversionchange`:** When a newer version is requested by another tab or context, the currently open connection closes itself gracefully and clears its cached instance (`swDb.close(); swDb = null;`), allowing the pending upgrade transaction to proceed.
2. **`onblocked`:** If another open connection fails to close immediately, the upgrade is blocked. Both client and worker log a warning and ensure inactive connections are closed.
3. **Upgrade Transaction Protection:** Errors on `transaction.onabort` and `transaction.onerror` are logged, rejecting the open request without corrupting database state.

### Developer Checklist for IndexedDB Schema Changes

When modifying the schema of `worksphere-offline`:

- [ ] 1. Update `src/lib/offlineReviewSync.ts`: add/update store in `request.onupgradeneeded` and increment `DB_VERSION`.
- [ ] 2. Update `public/sw.js`: mirror the store creation in `request.onupgradeneeded` and increment `indexedDB.open("worksphere-offline", NEW_VERSION)`.
- [ ] 3. Ensure both contexts implement `onversionchange` (`db.close()`) to avoid blocking upgrades.
- [ ] 4. Guard all store creations with `if (!db.objectStoreNames.contains("..."))`.
- [ ] 5. Run regression tests verifying that Service Worker opens the database without `VersionError`.
- [ ] 6. Update this runbook and `PWA_OFFLINE_GUIDE.md`.

## 6. Background sync

The page queues work in IndexedDB while offline, then asks the browser to wake the service worker when connectivity returns.

```mermaid
flowchart TD
  A["User action while offline"] --> Q["Write to a queue store in IndexedDB"]
  Q --> REG["registration.sync.register(tag)"]
  REG --> W["Browser fires sync event when online"]
  W --> H["sw.js sync handler picks function by tag"]
  H --> S["Read queue, POST to API, delete or update queue items"]
  S --> E{"Network error?"}
  E -- yes --> K["Keep items queued, browser retries the sync"]
  E -- no --> DONE["Queue drained"]
```

### One time sync tags

| Tag                   | Handler in `public/sw.js`                |
| --------------------- | ---------------------------------------- |
| `sync-crdt`           | `syncCrdt()`                             |
| `sync-favorites`      | `syncFavorites()` (older queue fallback) |
| `sync-ratings`        | `syncRatings()` (older queue fallback)   |
| `sync-reviews`        | `syncPendingReviews()`                   |
| `sync-conversations`  | `syncConversations()`                    |
| `receipt-export-sync` | `syncReceiptExports()`                   |
| `availability-sync`   | `syncAvailability()`                     |

### Periodic sync tags

| Tag                       | Handler                         |
| ------------------------- | ------------------------------- |
| `workspace-availability`  | `syncAvailability()`            |
| `refresh-favorite-venues` | `syncFavoriteVenuesOccupancy()` |

`usePWA.tsx` registers `availability-sync` and the periodic tags when the browser supports them. Periodic sync is only available in some Chromium based browsers, so every feature must also work without it.

### Failure handling

`isNetworkError(error)` in `sw.js` separates connectivity failures (a `TypeError` thrown by `fetch`) from server errors (a `Response` with 4xx or 5xx). Network errors must not use up retry quotas or delete queued items, the payload stays in the queue and the browser retries. Keep that rule when adding a new sync handler.

### Adding a new queue

1. Add the store and indexes in `src/lib/offlineReviewSync.ts` and bump `DB_VERSION`.
2. Mirror the store in the service worker's `onupgradeneeded` and bump its version to match.
3. Write the sync function in `public/sw.js`, using `isNetworkError` for failures.
4. Add the tag to the `sync` event handler.
5. Register the tag from the page code after writing to the queue.
6. Update the tables in this runbook.

## 7. Troubleshooting stale workers and caches

Open DevTools (F12) in Chrome or Edge, then the **Application** tab.

### See what is installed

- **Service workers** panel: shows the active worker, a waiting worker if an update is pending, and its source file.
- **Cache storage** panel: lists every cache. Anything not in the keep list from section 2 should disappear after an activate.
- **IndexedDB** panel: expand `worksphere-offline` to inspect stores and queued rows.

### Clear a stale service worker

1. Application, **Service workers**.
2. Tick **Update on reload** while developing, so each reload installs the newest `sw.js`.
3. Click **Skip waiting** if a new worker is stuck in the waiting state.
4. Click **Unregister** to remove the worker entirely, then reload.

### Clear stale caches

1. Application, **Cache storage**.
2. Right click a cache, **Delete**. Or delete all of them.
3. For a full reset, Application, **Storage**, then **Clear site data** (tick Cache storage, IndexedDB and Service workers).

You can also do it from the console:

```js
// list and delete all caches
caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))));

// unregister all service workers
navigator.serviceWorker
  .getRegistrations()
  .then((rs) => rs.forEach((r) => r.unregister()));

// delete the offline database (this removes queued offline actions too)
indexedDB.deleteDatabase("worksphere-offline");
```

Deleting the database also discards anything that was queued offline and not yet synced. Only do that on a development profile.

### Symptoms and fixes

| Symptom                                                              | Likely cause                                                                     | What to do                                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Old UI after a deploy                                                | New worker is waiting                                                            | Send `SKIP_WAITING` from the page, or Skip waiting in DevTools, then reload       |
| Console: `IndexedDB open timed out (likely Safari Private Browsing)` | Browser blocks IndexedDB, or the open request is stuck behind another connection | Leave Private Browsing, close other tabs, reload                                  |
| Console: `Database upgrade blocked by open connection`               | Another tab holds an older connection                                            | Close the other tabs, the upgrade then completes                                  |
| Console: `Database version change detected, closing connection`      | A newer version was requested elsewhere                                          | Expected during an upgrade, the next call reopens the database                    |
| Worker fails to open IndexedDB with a `VersionError`                 | Version number in `public/sw.js` is lower than the one on disk                   | Align it with `DB_VERSION` (section 5)                                            |
| `/offline` page not shown when offline                               | `/offline` was never cached by a successful fetch                                | Visit `/offline` once while online, then retest                                   |
| Map tiles missing offline                                            | Tiles for that area were never viewed or prefetched                              | Browse the area online first                                                      |
| Queued actions never sync                                            | Browser did not fire `sync`, or `sync` is unsupported                            | Check `registration.sync` exists, reconnect, or trigger the handler from the page |

### Testing offline behavior

1. Load the page online so the worker installs and caches.
2. DevTools, Network tab, set throttling to **Offline**.
3. Reload and navigate. Confirm cached pages load and `/offline` appears for uncached routes.
4. Perform an action that queues (for example a favorite), confirm a row in the matching IndexedDB store.
5. Set throttling back to **No throttling** and confirm the queue drains. In Application, Service workers, the **Sync** field can fire a sync tag manually.

## 8. Things to verify when changing this area

These came up while writing this runbook and are worth checking before relying on the behavior.

1. **Precache copy.** `install` writes the precache entries into `worksphere-v3-installing`, and `activate` deletes any cache ending in `-installing`. In the code reviewed, nothing copies those entries into `worksphere-v3`, so `/offline` becomes available offline only after it has been fetched once through the normal network-first path.
2. **Venue photo cache and activate.** `worksphere-venue-photos-v1` is used by the fetch handler but is not in the activate keep list, so the activate step would delete it. Confirm in Cache storage after an activate and add it to the keep list if it is meant to persist.
3. **Worker vs client DB version.** See section 5. The two numbers should always match.
