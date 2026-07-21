// Service Worker for WorkSphere PWA
const CACHE_NAME = "worksphere-v3";
const IMAGE_CACHE_NAME = "worksphere-images-v4";
const OFFLINE_URL = "/offline";

// Cap image cache at 20MB so iOS Safari PWA (~50MB quota) doesn't get killed.
const MAX_IMAGE_CACHE_BYTES = 20 * 1024 * 1024;
// Fallback size for opaque cross-origin responses where Content-Length is hidden (approx 400KB).
const OPAQUE_RESPONSE_SIZE_ESTIMATE = 400 * 1024;

// Assets to cache on install
const PRECACHE_ASSETS = ["/", "/offline", "/icons/icon.svg", "/manifest.json"];

// Install event - precache essential assets
self.addEventListener("install", (event) => {
  // Use a temporary cache for installation to prevent locking the main cache
  const tempCacheName = `${CACHE_NAME}-installing`;
  event.waitUntil(
    caches
      .open(tempCacheName)
      .then((cache) => {
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        // Once assets are added, we can skip waiting immediately
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error("[SW] Install failed:", err);
        // Even if install fails, we skip waiting to avoid getting stuck in 'installing' state
        return self.skipWaiting();
      }),
  );
});

// Activate event - clean up old caches and move temp assets
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
      .then(() => {
        // Claim clients immediately to take control of the page
        return self.clients.claim();
      })
      .then(() => {
        // Clean up any stray installation caches
        return caches.keys().then((names) => {
          return Promise.all(
            names
              .filter((n) => n.endsWith("-installing"))
              .map((n) => caches.delete(n)),
          );
        });
      }),
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
      caches.open(IMAGE_CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          // Agar cache mein mil gaya, toh turant return karo
          if (cachedResponse) {
            // Asynchronously update the LRU timestamp for this hit
            event.waitUntil(
              touchLRURecord(event.request.url).catch(console.error),
            );
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
                const responseToCache = networkResponse.clone();

                // Calculate size for LRU tracking
                let size = OPAQUE_RESPONSE_SIZE_ESTIMATE;
                if (networkResponse.headers.has("content-length")) {
                  const length = parseInt(
                    networkResponse.headers.get("content-length") || "0",
                    10,
                  );
                  if (!isNaN(length) && length > 0) size = length;
                }

                // Wrap cache.put and IDB updates in a promise chain for waitUntil
                const cachePromise = cache
                  .put(event.request, responseToCache)
                  .then(async () => {
                    await updateLRURecord(event.request.url, size);
                    await enforceImageCacheQuota(cache);
                  })
                  .catch(async (err) => {
                    if (err.name === "QuotaExceededError") {
                      console.warn(
                        "[SW] Quota exceeded. Evicting older images...",
                      );
                      await enforceImageCacheQuota(cache, true);

                      try {
                        await cache.put(event.request, responseToCache);
                        await updateLRURecord(event.request.url, size);
                      } catch (retryErr) {
                        console.error(
                          "[SW] Still out of quota after eviction:",
                          retryErr,
                        );
                      }
                    } else {
                      console.error("[SW] Failed to cache asset:", err);
                    }
                  });

                event.waitUntil(cachePromise);
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
  if (event.tag === "receipt-export-sync") {
    event.waitUntil(syncReceiptExports());
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

let isSyncingReceipts = false;
async function syncReceiptExports() {
  if (isSyncingReceipts) return;
  isSyncingReceipts = true;

  try {
    const db = await openIndexedDB();
    const tx = db.transaction("receiptExports", "readonly");
    const store = tx.objectStore("receiptExports");
    const jobs = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result || []);
    });

    const pendingJobs = jobs.filter(
      (j) => j.status === "pending" || j.status === "downloading",
    );

    for (const job of pendingJobs) {
      try {
        const downloadUrl = `/api/bookings/${job.bookingId}/download`;
        const response = await fetch(downloadUrl);

        if (response.ok) {
          const pdfArrayBuffer = await response.arrayBuffer();

          // Store PDF ArrayBuffer and mark status ready in IndexedDB
          const writeTx = db.transaction("receiptExports", "readwrite");
          const writeStore = writeTx.objectStore("receiptExports");
          writeStore.put({
            ...job,
            status: "ready",
            pdf: pdfArrayBuffer,
            downloadedAt: Date.now(),
          });

          await new Promise((res, rej) => {
            writeTx.oncomplete = res;
            writeTx.onerror = () => rej(writeTx.error);
          });

          // Show Notification
          if (self.registration && "showNotification" in self.registration) {
            await self.registration.showNotification("Receipt ready", {
              body: "Your booking receipt has been downloaded.",
              icon: "/icons/icon.svg",
              badge: "/icons/icon.svg",
              tag: `receipt-ready-${job.bookingId}`,
              data: {
                url: `/api/bookings/${job.bookingId}/download`,
                bookingId: job.bookingId,
              },
            });
          }

          // Notify all open window clients via postMessage to trigger automatic download/save
          const windowClients = await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true,
          });

          for (const client of windowClients) {
            client.postMessage({
              type: "RECEIPT_SYNC_READY",
              bookingId: job.bookingId,
              filename: job.filename,
            });
          }
        } else {
          throw new Error(
            `Receipt fetch failed with status ${response.status}`,
          );
        }
      } catch (err) {
        console.error(`[SW] Failed to sync receipt for ${job.bookingId}:`, err);
        const retryCount = (job.retryCount || 0) + 1;
        const maxRetries = 3;
        const newStatus = retryCount >= maxRetries ? "failed" : "pending";

        const writeTx = db.transaction("receiptExports", "readwrite");
        const writeStore = writeTx.objectStore("receiptExports");
        writeStore.put({
          ...job,
          retryCount,
          status: newStatus,
        });

        await new Promise((res) => {
          writeTx.oncomplete = res;
          writeTx.onerror = res;
        });

        if (newStatus === "failed") {
          const windowClients = await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true,
          });
          for (const client of windowClients) {
            client.postMessage({
              type: "RECEIPT_SYNC_FAILED",
              bookingId: job.bookingId,
              attempts: retryCount,
            });
          }
        }
      }
    }
  } catch (error) {
    console.error("[SW] Sync receipt exports failed:", error);
  } finally {
    isSyncingReceipts = false;
  }
}

// IndexedDB helpers
function openIndexedDB() {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open("worksphere-offline", 5);

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
          searchesStore.createIndex("timestamp", "timestamp", {
            unique: false,
          });
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

        // Image Cache LRU store
        if (!db.objectStoreNames.contains("imageCacheLRU")) {
          const lruStore = db.createObjectStore("imageCacheLRU", {
            keyPath: "url",
          });
          lruStore.createIndex("lastAccessed", "lastAccessed", {
            unique: false,
          });
        }

        // Receipt exports store for offline background sync (Issue #1069)
        if (!db.objectStoreNames.contains("receiptExports")) {
          const receiptStore = db.createObjectStore("receiptExports", {
            keyPath: "bookingId",
          });
          receiptStore.createIndex("status", "status", { unique: false });
          receiptStore.createIndex("createdAt", "createdAt", { unique: false });
        }
      };
    } catch (err) {
      reject(err);
    }
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

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "WorkSphere", body: event.data.text() };
  }

  const isAvailability = data.tag?.startsWith("venue-availability-");
  const options = {
    body: data.body || "New update from WorkSphere",
    icon: data.icon || "/icons/icon.svg",
    badge: data.badge || "/icons/icon.svg",
    vibrate: isAvailability ? [200, 100, 200, 100, 200] : [100, 50, 100],
    tag: data.tag || "worksphere-notification",
    renotify: true,
    requireInteraction: isAvailability,
    data: {
      url: data.url || "/",
      ...(data.data || {}),
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

// Notification click handler — navigate to the target venue page
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") return;

  const targetUrl = event.notification.data?.url || "/";
  const fullUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (
            client.url.includes(new URL(fullUrl).pathname) &&
            "focus" in client
          ) {
            client.postMessage({
              type: "NAVIGATE_PUSH",
              url: fullUrl,
            });
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(fullUrl);
        }
      }),
  );
});

import {
  getQueuedFavorites,
  dequeueOfflineAction,
  incrementRetryCount,
  MAX_SYNC_RETRIES,
} from "../src/lib/offlineStore";

self.addEventListener("sync", (event) => {
  if (event.tag === "sync-favorites") {
    event.waitUntil(syncFavoritesOutbox());
  }
});

/**
 * Notify every open tab/window so the UI can surface a toast. The service
 * worker has no DOM access, so a permanently-failed sync can only be
 * surfaced by posting a message to clients rather than showing anything
 * itself. See usePWA.tsx's `useOfflineSyncNotice` for the listener. (Issue #712)
 */
async function notifyClientsOfPermanentFailure(action) {
  const allClients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of allClients) {
    client.postMessage({
      type: "OFFLINE_SYNC_FAILED",
      venueId: action.venueId,
      action: action.action,
      attempts: MAX_SYNC_RETRIES,
    });
  }
}

async function syncFavoritesOutbox() {
  const processQueue = async () => {
    try {
      const actions = await getQueuedFavorites();

      for (const action of actions) {
        if (!action.id) continue;

        try {
          const response = await fetch("/api/favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              venueId: action.venueId,
              action: action.action,
            }),
          });

          if (response.ok) {
            // Remove from IndexedDB outbox queue on successful endpoint ingestion
            await dequeueOfflineAction(action.id);
            continue;
          }

          // Non-OK response (e.g. 500) counts as a failed attempt, same as a
          // network-level throw below.
          throw new Error(`Sync request failed with status ${response.status}`);
        } catch (error) {
          console.error("Failed to sync favorite:", error);

          if (
            typeof self !== "undefined" &&
            self.navigator &&
            !self.navigator.onLine
          ) {
            console.warn("[SW] Offline network error; preserving outbox item.");
            break;
          }

          const attempts = await incrementRetryCount(action.id);

          if (attempts !== null && attempts >= MAX_SYNC_RETRIES) {
            // Give up after MAX_SYNC_RETRIES — but tell the user instead of
            // purging the action silently.
            await dequeueOfflineAction(action.id);
            await notifyClientsOfPermanentFailure(action);
          }
          // Otherwise leave it queued; the next "sync-favorites" event (or the
          // next reconnect) will retry it.
        }
      }
    } catch (err) {
      console.error("[SW] Error in processQueue:", err);
    }
  };

  try {
    if ("locks" in navigator) {
      await navigator.locks.request(
        "sync-favorites-queue",
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            console.log(
              "[SW] Queue is currently being processed by another agent. Skipping.",
            );
            return;
          }
          await processQueue();
        },
      );
    } else {
      await processQueue();
    }
  } catch (error) {
    console.error(
      "Background synchronization pipeline failed to complete:",
      error,
    );
  }
}

/**
 * Updates or inserts a record for an image in the LRU IDB store.
 */
async function updateLRURecord(url, size) {
  try {
    const db = await openIndexedDB();
    const tx = db.transaction("imageCacheLRU", "readwrite");
    const store = tx.objectStore("imageCacheLRU");
    store.put({ url, size, lastAccessed: Date.now() });
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("[SW] Failed to update LRU record:", err);
  }
}

/**
 * Touches an existing record to update its lastAccessed time (True LRU).
 */
async function touchLRURecord(url) {
  try {
    const db = await openIndexedDB();
    const tx = db.transaction("imageCacheLRU", "readwrite");
    const store = tx.objectStore("imageCacheLRU");
    const request = store.get(url);

    request.onsuccess = () => {
      const record = request.result;
      if (record) {
        record.lastAccessed = Date.now();
        store.put(record);
      }
    };
  } catch (err) {
    console.error("[SW] Failed to touch LRU record:", err);
  }
}

let isEnforcingQuota = false;

/**
 * Helper to keep image cache strictly below quota (~20MB) using True LRU.
 */
async function enforceImageCacheQuota(cache, aggressive = false) {
  // Wait if another sweep is concurrently running to avoid redundant IDB reads/writes
  while (isEnforcingQuota) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  isEnforcingQuota = true;

  try {
    const db = await openIndexedDB();
    const tx = db.transaction("imageCacheLRU", "readwrite");
    const store = tx.objectStore("imageCacheLRU");

    const request = store.getAll();
    const records = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    let totalSize = records.reduce((acc, r) => acc + (r.size || 0), 0);
    const targetSize = aggressive
      ? MAX_IMAGE_CACHE_BYTES * 0.6
      : MAX_IMAGE_CACHE_BYTES;

    if (totalSize > targetSize) {
      // Sort by oldest first
      records.sort((a, b) => a.lastAccessed - b.lastAccessed);

      let evictedCount = 0;
      for (const record of records) {
        if (totalSize <= targetSize) break;

        await cache.delete(record.url);
        store.delete(record.url);

        totalSize -= record.size || 0;
        evictedCount++;
      }
      console.log(
        `[SW] True LRU: Evicted ${evictedCount} images to stay under ${targetSize / 1024 / 1024}MB quota.`,
      );
    }
  } catch (err) {
    console.error("[SW] Failed to enforce image cache LRU quota:", err);
  } finally {
    isEnforcingQuota = false;
  }
}
