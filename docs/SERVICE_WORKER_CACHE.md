# Service Worker & PWA Caching Guide

## 1. Cache Versioning & Precaching Rules

WorkSphere utilizes `public/sw.js` to manage asset caching and ensure a reliable offline experience.

**Precaching:** Critical assets (HTML, CSS, JS bundles, and core images) are precached during the Service Worker `install` event.
**Versioning:** Cache names are versioned (e.g., `worksphere-cache-v1`). During the `activate` event, the Service Worker compares the current cache version against old versions and deletes outdated caches to free up space.

**Strategies:**

- **Stale-While-Revalidate:** Used for frequently updated resources (like API GET requests). It serves the cached version immediately while fetching an updated version in the background to refresh the cache.
- **Cache-First:** Used for static assets (images, fonts). It checks the cache first and only goes to the network if the asset is missing.

## 2. Offline Fallback

When a user loses network connectivity, the Service Worker intercepts network requests via the `fetch` event. If a navigation request (e.g., loading a page) fails due to being offline, the Service Worker catches the error and serves the precached `/offline` fallback page instead of displaying the browser's default offline dinosaur screen.

## 3. Background Sync & IndexedDB

To ensure data consistency when the user is offline, we utilize the **Background Sync API** combined with **IndexedDB**.

1. When a user performs an action offline (like submitting a state-modifying form), the payload is saved locally to IndexedDB.
2. A background sync event is registered (e.g., `sw.sync.register('sync-forms')`).
3. Once the network connection is restored, the Service Worker's `sync` event fires, retrieves the pending actions from IndexedDB, and safely transmits them to the server.

## 4. Testing & Clearing Cache in Chrome DevTools

When developing or debugging PWA features, you may need to manually clear the cache:

1. Open Chrome DevTools (`F12` or `Ctrl+Shift+I` / `Cmd+Option+I`).
2. Navigate to the **Application** tab.
3. Under the **Application** sidebar on the left, click **Storage**.
4. Click the **Clear site data** button to wipe the Service Worker, Cache Storage, and IndexedDB.
5. To inspect specific caches, expand the **Cache Storage** section in the sidebar.
