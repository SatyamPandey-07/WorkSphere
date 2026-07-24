async function withIdbLock(callback) {
  if ("locks" in self.navigator) {
    try {
      return await self.navigator.locks.request(
        "worksphere-offline-storage-lock",
        async () => callback(),
      );
    } catch {
      return callback();
    }
  }
  return callback();
}

const CACHE_NAME = "worksphere-v3";
const IMAGE_CACHE_NAME = "worksphere-images-v4";
const MAP_TILE_CACHE_NAME = "worksphere-maptiles-v1";
const VIDEO_CACHE_NAME = "worksphere-video-tours-v1";
const PREFETCH_CACHE_NAME = "worksphere-prefetch-v1";
const OFFLINE_URL = "/offline";
const AVAILABILITY_SYNC_TAG = "availability-sync";
const PERIODIC_AVAILABILITY_TAG = "workspace-availability";

// Cap image cache at 20MB so iOS Safari PWA (~50MB quota) doesn't get killed.
const MAX_IMAGE_CACHE_BYTES = 20 * 1024 * 1024;
// Fallback size for opaque cross-origin responses where Content-Length is hidden (approx 400KB).
const OPAQUE_RESPONSE_SIZE_ESTIMATE = 400 * 1024;

/**
 * Checks navigator.storage.estimate() before CacheStorage writes (e.g. pre-fetching venue video tours).
 * Prevents QuotaExceededError crashes on mobile Chrome/Android.
 */
async function hasSufficientStorageQuota(requiredBytes = 0) {
  if (
    typeof navigator !== "undefined" &&
    navigator.storage &&
    typeof navigator.storage.estimate === "function"
  ) {
    try {
      const estimate = await navigator.storage.estimate();
      if (estimate.quota !== undefined && estimate.usage !== undefined) {
        const availableBytes = estimate.quota - estimate.usage;
        const minRequiredBuffer = Math.max(requiredBytes, 5 * 1024 * 1024);
        return availableBytes >= minRequiredBuffer;
      }
    } catch (err) {
      console.warn("[SW] Failed to estimate storage quota:", err);
    }
  }
  return true;
}

/**
 * Pre-fetches venue video tour URLs after checking navigator.storage.estimate().
 * Halts safely if remaining storage quota is low to avoid QuotaExceededError crashes.
 */
async function prefetchVideoTours(urls) {
  if (!Array.isArray(urls) || urls.length === 0) return;

  const hasQuota = await hasSufficientStorageQuota(10 * 1024 * 1024);
  if (!hasQuota) {
    console.warn(
      "[SW] Insufficient storage quota before pre-fetching video tours. Skipping batch.",
    );
    return;
  }

  try {
    const cache = await caches.open(VIDEO_CACHE_NAME);
    for (const url of urls) {
      const canFit = await hasSufficientStorageQuota(5 * 1024 * 1024);
      if (!canFit) {
        console.warn(
          `[SW] Stopping video tour pre-fetch for ${url}: low storage quota remaining.`,
        );
        break;
      }

      try {
        const response = await fetch(url);
        if (response.ok) {
          const contentLength = response.headers.get("content-length");
          const size = contentLength
            ? parseInt(contentLength, 10)
            : 5 * 1024 * 1024;

          const exactQuotaCheck = await hasSufficientStorageQuota(size);
          if (!exactQuotaCheck) {
            console.warn(
              `[SW] Skipping video tour cache write for ${url}: required ${size} bytes exceeds quota.`,
            );
            continue;
          }

          await cache.put(url, response.clone());
        }
      } catch (err) {
        if (err.name === "QuotaExceededError") {
          console.warn(
            "[SW] QuotaExceededError caught during video tour pre-fetch. Halting pre-fetch queue.",
          );
          break;
        }
        console.error("[SW] Error pre-fetching video tour:", url, err);
      }
    }
  } catch (err) {
    console.error("[SW] Failed to open video tour cache:", err);
  }
}

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
        // DO NOT skip waiting automatically to prevent infinite loaders
        // Wait for the client to trigger it via SKIP_WAITING message
      })
      .catch((err) => {
        console.error("[SW] Install failed:", err);
      }),
  );
});

// Allow client to trigger skipWaiting
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
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
                name !== MAP_TILE_CACHE_NAME &&
                name !== VIDEO_CACHE_NAME &&
                name !== PREFETCH_CACHE_NAME &&
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
  if (event.request.method !== "GET") {
    return;
  }
  if (event.request.url.includes("/download")) {
    return;
  }

  event.respondWith(
    caches.open(PREFETCH_CACHE_NAME).then((prefetchCache) => {
      return prefetchCache.match(event.request).then((prefetchedResponse) => {
        if (prefetchedResponse) {
          return prefetchedResponse;
        }
        return handleFetch(event.request, event);
      });
    }),
  );
});

async function handleFetch(request, event) {
  const isVenuesApi = request.url.includes("/api/venues");
  const isMapTile =
    request.url.includes("tile.openstreetmap.org") ||
    request.url.includes("basemaps.cartocdn.com");
  const isExternalAsset = request.url.includes("images.unsplash.com");

  if (isVenuesApi) {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(request);
      return cached || new Response("Offline", { status: 503 });
    }
  } else if (isMapTile) {
    const cache = await caches.open(MAP_TILE_CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const networkResponse = await fetch(request);
      if (networkResponse.status === 200 || networkResponse.status === 0) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    } catch {
      return new Response("Map Tile Offline", { status: 503 });
    }
  } else if (isExternalAsset) {
    const cache = await caches.open(IMAGE_CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) {
      event.waitUntil(touchLRURecord(request.url).catch(console.error));
      return cached;
    }
    try {
      const networkResponse = await fetch(request);
      if (networkResponse.status === 200 || networkResponse.status === 0) {
        const responseToCache = networkResponse.clone();

        let size = OPAQUE_RESPONSE_SIZE_ESTIMATE;
        if (networkResponse.headers.has("content-length")) {
          const length = parseInt(
            networkResponse.headers.get("content-length") || "0",
            10,
          );
          if (!isNaN(length) && length > 0) size = length;
        }

        const cachePromise = cache
          .put(request, responseToCache)
          .then(async () => {
            await updateLRURecord(request.url, size);
            await enforceImageCacheQuota(cache);
          })
          .catch(async (err) => {
            if (err.name === "QuotaExceededError") {
              await enforceImageCacheQuota(cache, true);
              try {
                await cache.put(request, responseToCache);
                await updateLRURecord(request.url, size);
              } catch {
                // Retry attempt after quota enforcement - silently ignore
              }
            }
          });
        event.waitUntil(cachePromise);
      }
      return networkResponse;
    } catch {
      return new Response("Asset Offline", { status: 503 });
    }
  } else {
    // Existing Network-First logic for local assets
    try {
      const response = await fetch(request);
      if (response.ok && request.url.startsWith("http")) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        return caches.match(OFFLINE_URL);
      }
      return new Response("Offline", { status: 503 });
    }
  }
}
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
  if (event.tag === AVAILABILITY_SYNC_TAG) {
    event.waitUntil(syncAvailability());
  }
});

// Periodic Background Sync for workspace availability (Issue #1126)
self.addEventListener("periodicsync", (event) => {
  if (event.tag === PERIODIC_AVAILABILITY_TAG) {
    event.waitUntil(syncAvailability());
  }
});

/**
 * Determines whether a caught error from fetch() is a network-level failure.
 *
 * fetch() throws a TypeError when the network is unreachable:
 *   - DNS resolution failures
 *   - TCP connection timeouts / resets
 *   - TLS handshake failures
 *   - Premature connection close while reading body
 *
 * Server errors (4xx, 5xx) return a Response object and do NOT throw TypeError.
 * This distinction is critical: network errors should NOT exhaust retry quotas
 * or cause permanent data loss — the payload must stay in the queue.
 */
function isNetworkError(error) {
  return error instanceof TypeError;
}

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
    await withIdbLock(async () => {
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
    });
  } catch (error) {
    // If the entire batch failed due to a network outage, do NOT discard the
    // pending CRDT actions — they remain in the queue and will be retried on
    // the next Background Sync event. A network error (TypeError) means the
    // fetch never reached the server, so there is no risk of duplicate writes.
    if (isNetworkError(error)) {
      console.warn(
        "[SW] syncCrdt: Network error — preserving pending actions for next sync.",
      );
      return;
    }
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
 feat/1628-offline-favorites-sync
    const db = await openIndexedDB();

    const pendingFavorites = await new Promise((resolve, reject) => {
      const tx = db.transaction("pendingFavorites", "readonly");
      const store = tx.objectStore("pendingFavorites");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });

    if (pendingFavorites.length === 0) return;

    // Sort by timestamp
    pendingFavorites.sort((a, b) => a.timestamp - b.timestamp);

    const operations = pendingFavorites.map((fav) => ({
      venueId: fav.venueId,
      action: fav.action,
      timestamp: fav.timestamp,
    }));

    const response = await fetch("/api/favorites/tags/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operations }),
    });

    if (response.ok) {
      // Clear all synced favorites
      await new Promise((resolve, reject) => {
        const tx = db.transaction("pendingFavorites", "readwrite");
        const store = tx.objectStore("pendingFavorites");
        pendingFavorites.forEach((fav) => store.delete(fav.id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    await withIdbLock(async () => {
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
          // Network errors (TypeError) mean the fetch never reached the server.
          // Preserve the action in the queue — it will be retried on the next
          // Background Sync event without incrementing any retry counter.
          // Do NOT remove the action, as the server never received the request.
          if (isNetworkError(error)) {
            console.warn(
              `[SW] syncFavorites: Network error for action ${action.id} — preserving in queue.`,
            );
            continue;
          }
          console.error("Failed to sync favorite:", error);
        }
      }
    }); main
  } catch (error) {
    if (isNetworkError(error)) {
      console.warn(
        "[SW] syncFavorites: Network error — preserving pending actions for next sync.",
      );
      return;
    }
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
    await withIdbLock(async () => {
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
          if (isNetworkError(error)) {
            console.warn(
              `[SW] syncRatings: Network error for action ${action.id} — preserving in queue.`,
            );
            continue;
          }
          console.error("Failed to sync rating:", error);
        }
      }
    });
  } catch (error) {
    if (isNetworkError(error)) {
      console.warn(
        "[SW] syncRatings: Network error — preserving pending actions for next sync.",
      );
      return;
    }
    console.error("Sync ratings failed:", error);
  } finally {
    isSyncingRatings = false;
  }
}

// Sync queued conversation renames/deletes when back online (issue #266)
async function syncConversations() {
  try {
    await withIdbLock(async () => {
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
            a.type === "conversation-rename" ||
            a.type === "conversation-delete",
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
          // Network errors (TypeError) mean the fetch never reached the server.
          // Preserve the action in the queue; it will be retried on the next
          // Background Sync event without data loss or duplication.
          if (isNetworkError(error)) {
            console.warn(
              `[SW] syncConversations: Network error for action ${action.id} — preserving in queue.`,
            );
            continue;
          }
          console.error("Failed to sync conversation edit:", error);
        }
      }
    });
  } catch (error) {
    if (isNetworkError(error)) {
      console.warn(
        "[SW] syncConversations: Network error — preserving pending actions for next sync.",
      );
      return;
    }
    console.error("Sync conversations failed:", error);
  }
}

let isSyncingReceipts = false;
async function syncReceiptExports() {
  if (isSyncingReceipts) return;
  isSyncingReceipts = true;

  try {
    await withIdbLock(async () => {
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
          // First, check for network-level failure (TypeError from fetch()).
          // If the network dropped mid-flush, do NOT increment retryCount —
          // the server never received the download request, so no state was
          // mutated. We keep the job in its original state for the next sync.
          if (isNetworkError(err)) {
            console.warn(
              `[SW] syncReceiptExports: Network error for job ${job.bookingId} — preserving without incrementing retry count.`,
            );
            continue;
          }
          console.error(
            `[SW] Failed to sync receipt for ${job.bookingId}:`,
            err,
          );
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
    });
  } catch (error) {
    if (isNetworkError(error)) {
      console.warn(
        "[SW] syncReceiptExports: Network error — preserving receipt jobs for next sync.",
      );
      return;
    }
    console.error("[SW] Sync receipt exports failed:", error);
  } finally {
    isSyncingReceipts = false;
  }
}

// Periodic Background Sync: fetch seat availability for saved venues,
// diff against last-known state, and show a notification when seats open up.
let isSyncingAvailability = false;
async function syncAvailability() {
  if (isSyncingAvailability) return;
  isSyncingAvailability = true;

  try {
    await withIdbLock(async () => {
      const response = await fetch("/api/availability/delta", {
        credentials: "include",
      });

      if (!response.ok) return;

      const { venues } = await response.json();
      if (!Array.isArray(venues) || venues.length === 0) return;

      const db = await openIndexedDB();
      const tx = db.transaction("availabilityDeltas", "readwrite");
      const store = tx.objectStore("availabilityDeltas");

      const notifications = [];

      for (const venue of venues) {
        const prev = await new Promise((resolve, reject) => {
          const req = store.get(venue.venueId);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });

        const openedUp =
          prev &&
          (venue.count < prev.currentCount ||
            (prev.currentStatus === "red" && venue.status !== "red") ||
            (prev.currentStatus === "yellow" && venue.status === "green"));

        store.put({
          venueId: venue.venueId,
          venueName: venue.venueName,
          currentCount: venue.count,
          currentCapacity: venue.capacity,
          currentStatus: venue.status,
          timestamp: Date.now(),
        });

        if (openedUp) {
          notifications.push({
            venueId: venue.venueId,
            venueName: venue.venueName || "Workspace",
            availableSeats: venue.capacity - venue.count,
          });
        }
      }

      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });

      for (const n of notifications) {
        if (self.registration && "showNotification" in self.registration) {
          await self.registration.showNotification("Seat Available!", {
            body: `${n.venueName} now has ${n.availableSeats} seat${n.availableSeats !== 1 ? "s" : ""} available.`,
            icon: "/icons/icon.svg",
            badge: "/icons/icon.svg",
            vibrate: [200, 100, 200, 100, 200],
            tag: `venue-availability-${n.venueId}`,
            renotify: true,
            requireInteraction: true,
            data: { url: `/venues/${n.venueId}`, venueId: n.venueId },
            actions: [
              { action: "open", title: "Open" },
              { action: "dismiss", title: "Dismiss" },
            ],
          });
        }
      }
    });
  } catch (error) {
    console.error("[SW] Availability sync failed:", error);
  } finally {
    isSyncingAvailability = false;
  }
}

// IndexedDB helpers
let swDb = null;
function openIndexedDB() {
  if (swDb) return Promise.resolve(swDb);
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open("worksphere-offline", 6);
 feat/1628-offline-favorites-sync


      request.onblocked = () => {
        console.warn("[SW] IndexedDB upgrade blocked");
      };
 main

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        swDb = request.result;
        swDb.onversionchange = () => {
          swDb.close();
          swDb = null;
        };
        resolve(swDb);
      };

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

 feat/1628-offline-favorites-sync
        // Pending favorites store
        if (!db.objectStoreNames.contains("pendingFavorites")) {
          db.createObjectStore("pendingFavorites", {
            keyPath: "id",
          });

        // Availability deltas store for periodic background sync (Issue #1126)
        if (!db.objectStoreNames.contains("availabilityDeltas")) {
          const deltaStore = db.createObjectStore("availabilityDeltas", {
            keyPath: "venueId",
          });
          deltaStore.createIndex("timestamp", "timestamp", { unique: false });
 main
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

// Service Worker Client Messages (e.g. pre-fetching venue video tours, skip waiting)
self.addEventListener("message", (event) => {
  if (!event.data) return;

  if (event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  if (
    event.data.type === "PREFETCH_VIDEO_TOURS" ||
    event.data.type === "PREFETCH_VIDEOS"
  ) {
    const urls = event.data.urls || (event.data.url ? [event.data.url] : []);
    event.waitUntil(prefetchVideoTours(urls));
  }

  if (event.data.type === "PREFETCH_VENUE") {
    const { venueId, position } = event.data.payload;
    event.waitUntil(prefetchVenueData(venueId, position));
  }
});

async function prefetchVenueData(venueId, position) {
  try {
    const cache = await caches.open(PREFETCH_CACHE_NAME);

    // 1. Prefetch venue page (RSC payload heuristics for Next.js)
    const venueApiUrl = `/api/venues/enrich?venueId=${venueId}`;

    const fetches = [
      fetch(venueApiUrl)
        .then((res) => (res.ok ? cache.put(venueApiUrl, res) : null))
        .catch(() => null),
    ];

    // 2. Prefetch map tiles (Zoom 15)
    if (position && position.length === 2) {
      const [lat, lng] = position;
      const zoom = 15;
      const x = Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
      const y = Math.floor(
        ((1 -
          Math.log(
            Math.tan((lat * Math.PI) / 180) +
              1 / Math.cos((lat * Math.PI) / 180),
          ) /
            Math.PI) /
          2) *
          Math.pow(2, zoom),
      );

      const mapCache = await caches.open(MAP_TILE_CACHE_NAME);

      // Fetch a 3x3 grid around the center tile
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const tileUrl = `https://tile.openstreetmap.org/${zoom}/${x + dx}/${y + dy}.png`;
          fetches.push(
            fetch(tileUrl, { mode: "cors" })
              .then((res) => (res.ok ? mapCache.put(tileUrl, res) : null))
              .catch(() => null),
          );
        }
      }
    }

    await Promise.allSettled(fetches);
  } catch (err) {
    console.error("[SW] Failed to prefetch venue data:", err);
  }
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

// Invalid import and duplicate syncFavoritesOutbox removed to fix SyntaxError

/**
 * Updates or inserts a record for an image in the LRU IDB store.
 */
async function updateLRURecord(url, size) {
  try {
    await withIdbLock(async () => {
      const db = await openIndexedDB();
      const tx = db.transaction("imageCacheLRU", "readwrite");
      const store = tx.objectStore("imageCacheLRU");
      store.put({ url, size, lastAccessed: Date.now() });
      return new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    });
  } catch (err) {
    console.error("[SW] Failed to update LRU record:", err);
  }
}

/**
 * Touches an existing record to update its lastAccessed time (True LRU).
 * Returns a promise that resolves when the IndexedDB transaction completes.
 */
async function touchLRURecord(url) {
  try {
    await withIdbLock(async () => {
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
    });
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
    await withIdbLock(async () => {
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

        const toEvict = [];
        for (const record of records) {
          if (totalSize <= targetSize) break;
          totalSize -= record.size;
          toEvict.push(record);
        }

        // Queue all IDB deletes while the transaction is still active
        for (const record of toEvict) {
          store.delete(record.url);
        }
        await new Promise((resolve, reject) => {
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });

        // Now remove from Cache Storage after IDB transaction completes
        for (const record of toEvict) {
          await cache.delete(record.url);
        }
        console.log(
          `[SW] True LRU: Evicted ${evictedCount} images to stay under ${targetSize / 1024 / 1024}MB quota.`,
        );
      }
    });
  } catch (err) {
    console.error("[SW] Failed to enforce image cache LRU quota:", err);
  } finally {
    isEnforcingQuota = false;
  }
}
