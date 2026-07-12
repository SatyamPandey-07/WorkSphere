# WorkSphere PWA Strategy & Offline Synchronization

This document details WorkSphere’s Progressive Web App (PWA) architecture, caching strategies, client-side offline storage schemas, and the background synchronization lifecycle using Yjs Conflict-Free Replicated Data Types (CRDTs).

---

## 1. Architecture Overview

WorkSphere is designed to operate seamlessly under poor connection states or total offline conditions. The client coordinates memory states, IndexedDB, and the Service Worker to capture and queue user actions, sync-merging them back to the database when connectivity is restored.

```mermaid
graph TD
    subgraph Client App (Browser Window)
        View[UI Views & React State] <--> YDoc[Y.Doc userDoc map]
        View <--> IDB[(IndexedDB: worksphere-offline)]
    end

    subgraph Service Worker (Background)
        SW[sw.js Service Worker]
        Cache[(Cache Storage: worksphere-v2)]
    end

    subgraph Backend Server
        API[Next.js API: /api/sync & /api/favorites]
        DB[(Prisma PostgreSQL Database)]
    end

    %% Caching Flow
    View -- HTTP GET requests --> SW
    SW -- Cache-First/Network-First --> Cache
    SW -- Network Fetch --> API

    %% CRDT update & storage
    YDoc -- Auto-Update Event --> IDB
    IDB -- Staged crdt-sync Action --> SW

    %% Offline Sync Flow
    SW -- Service Worker sync event --> API
    API <--> DB
```

---

## 2. Service Worker Caching Strategies

The service worker file [sw.js](file:///C:/Users/Rajasekar/.gemini/antigravity/scratch/WorkSphere/public/sw.js) implements cache management using target-specific strategies under the cache namespace `worksphere-v2`.

### Static Asset Precaching
During the `install` phase, the service worker pre-fetches and caches critical shell assets required to load the application layout:
* `/` (Landing Page)
* `/offline` (Offline Fallback Page)
* `/icons/icon.svg` (Global icon assets)
* `/manifest.json` (PWA application manifest config)

### Caching Behaviors
For dynamic requests, the fetch listener routes traffic using two primary caching patterns:

| Strategy | Target Assets | Description |
| :--- | :--- | :--- |
| **Cache-First** | `tile.openstreetmap.org`<br>`images.unsplash.com` | Maps tile sheets and venue placeholder images are served directly from the cache if present. If absent, they are fetched, written to `worksphere-v2`, and returned. |
| **Network-First** | Next.js routes, API GET requests, local assets | Requests hit the internet first to retrieve fresh real-time data. On network failure, it falls back to matching cached items, or displays the [offline route](file:///C:/Users/Rajasekar/.gemini/antigravity/scratch/WorkSphere/src/app/offline/page.tsx) for navigation commands. |

> [!NOTE]
> All non-`GET` HTTP methods (e.g. `POST`, `PUT`, `DELETE` operations) bypass the Service Worker cache completely to ensure mutations are not intercepted or stale-served.

---

## 3. Offline IndexedDB Storage

WorkSphere stores offline-capable data in the browser’s IndexedDB database named `worksphere-offline` (Version 1). The IndexedDB engine is initialized and managed by [offlineStorage.ts](file:///C:/Users/Rajasekar/.gemini/antigravity/scratch/WorkSphere/src/lib/offlineStorage.ts).

### Object Stores Breakdown

| Store Name | Key Path | Indices | Description |
| :--- | :--- | :--- | :--- |
| **`venues`** | `id` | `type`, `savedAt` | Caches details of coworking venues viewed or queried locally. |
| **`favorites`** | `id` | `savedAt` | Caches the user's favorite venues for instant listing. |
| **`searches`** | `query` | `timestamp` | Caches search queries and their results (invalidates automatically after 24 hours). |
| **`pendingActions`** | `id` (Auto-Increment) | *None* | Staging queue storing serialized CRDT state updates or fallback POST payloads. |

> [!TIP]
> IndexedDB database cleanups run periodically via `cleanupOldData()` to evict venues and search history older than 7 days to preserve storage quota limits.

---

## 4. CRDT Background Sync Lifecycle

Offline mutations are resolved securely using **Yjs CRDTs** to avoid version conflicts and ensure data integrity.

### Data Mutation Flow

1. **State Tracking**: A global `Y.Doc` (`userDoc`) manages favorites and ratings on the client.
2. **Incremental Capture**: Any change on `userDoc` automatically triggers a document update handler:
   ```typescript
   userDoc.on('update', async (update: Uint8Array) => {
     await queueCrdtUpdate(update);
   });
   ```
3. **Queueing Updates**: The serialized binary `Uint8Array` state difference is saved inside the `pendingActions` object store under the type `crdt-sync`.
4. **Registering Background Sync**: If supported, the app registers a background sync event with tag name `'sync-crdt'`:
   ```typescript
   navigator.serviceWorker.ready.then((reg) => {
     reg.sync.register('sync-crdt');
   });
   ```
5. **Background Transmission**: Once the browser detects active internet connection, the Service Worker fires the `sync` event, aggregates all base64-encoded updates, and POSTs them to `/api/sync`.
6. **Server Integration**: The sync API route [route.ts](file:///C:/Users/Rajasekar/.gemini/antigravity/scratch/WorkSphere/src/app/api/sync/route.ts) fetches the user's historical state from the PostgreSQL database, applies client increments to the reconstructed `Y.Doc`, and updates the `crdtState` database field.

---

## 5. Browser Testing & Debugging Guidelines

Developing and inspecting PWA capabilities requires specialized tooling configurations in browser devtools.

### Inspecting PWA Storage in Devtools (Chrome/Edge/Safari)

* **Service Worker Registry**:
  1. Open DevTools (`F12`) -> Go to the **Application** tab (Chrome/Edge) or **Storage** (Safari).
  2. Click **Service Workers** in the left sidebar to check activation status, register new events, or test push notifications.
  3. Toggle **Offline** checkbox to simulate network disconnects directly inside the page request chain.
* **Cache Storage**:
  1. Expand **Cache Storage** in the Application sidebar.
  2. Click `worksphere-v2` to inspect cached map tiles, assets, and page routes.
* **IndexedDB Databases**:
  1. Expand **IndexedDB** -> Click `worksphere-offline`.
  2. Inspect cached venues, queries, or check staged entries in `pendingActions` prior to background sync.

### Manual Background Sync Triggering

If the browser does not trigger the sync immediately, you can force it via DevTools:
1. Navigate to **Application** -> **Service Workers**.
2. Locate the **Sync** text input field.
3. Type `'sync-crdt'` (or `'sync-favorites'`) and click **Sync**. This triggers the service worker's `sync` event handler immediately.

> [!WARNING]
> **Safari Constraints**: Safari disables standard `SyncManager` background sync capabilities on iOS outside home-screen-installed applications (standalone mode). In these environments, WorkSphere falls back to manual sync-flushing on page reload or network online events.

### Completely Resetting App State
To perform a complete clean-slate reload:
1. Go to **Application** -> **Clear storage**.
2. Click **Clear site data** (this unregisters service workers, purges caches, and drops all IndexedDB schemas).
3. Reload the browser window (`Ctrl` + `F5`).
