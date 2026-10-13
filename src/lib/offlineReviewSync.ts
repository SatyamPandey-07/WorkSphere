"use client";

import { withWebLock, OFFLINE_WRITE_LOCK } from "./webLock";
import { syncQueueManager } from "./offline/SyncQueueManager";

export const DB_NAME = "worksphere-offline";
export const DB_VERSION = 7;
export const REVIEW_STORE_NAME = "pendingReviews";
export const QUEUED_REVIEWS_STORE_NAME = "queued_reviews";
export const REVIEW_SYNC_CHANNEL = "worksphere:review-sync";

// Register review sync handler with consolidated SyncQueueManager
syncQueueManager.registerHandler("review", async (item) => {
  const review = item.payload as QueuedVenueReview;
  if (!review?.venueId) return;

  let csrfToken = "";
  try {
    const csrfRes = await fetch("/api/auth/csrf-token");
    if (csrfRes.ok) {
      const csrfData = await csrfRes.json();
      csrfToken = csrfData.csrfToken || "";
    }
  } catch {}

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Idempotency-Key": review.id,
  };
  if (csrfToken) {
    headers["x-csrf-token"] = csrfToken;
  }

  const baseVersionTimestamp =
    review.baseVersionTimestamp ||
    review.baseReviewUpdatedAt ||
    review.baseVenueUpdatedAt;

  const res = await fetch(
    `/api/venues/${encodeURIComponent(review.venueId)}/reviews`,
    {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify({
        ...review.data,
        idempotencyKey: review.id,
        reviewId: review.reviewId,
        baseVenueUpdatedAt: review.baseVenueUpdatedAt,
        baseReviewUpdatedAt: review.baseReviewUpdatedAt || baseVersionTimestamp,
        baseVersion: review.baseVersion || baseVersionTimestamp,
        baseVersionTimestamp,
      }),
    },
  );

  if (res.ok) {
    await removeQueuedReview(review.id);
    broadcastReviewSyncEvent({
      type: "REVIEW_SYNC_SUCCESS",
      id: review.id,
      venueId: review.venueId,
      venueName: review.venueName,
    });
    return true;
  }

  if (res.status === 409) {
    const conflictJson = await res.json().catch(() => ({}));
    await updateQueuedReviewStatus(review.id, "CONFLICT", conflictJson);
    broadcastReviewSyncEvent({
      type: "REVIEW_SYNC_CONFLICT",
      id: review.id,
      venueId: review.venueId,
      venueName: review.venueName,
      conflictDetails: conflictJson,
    });
    return false;
  }

  throw new Error(`Review sync HTTP error: ${res.status}`);
});

export type QueuedReviewStatus =
  | "PENDING"
  | "SYNCING"
  | "FAILED"
  | "CONFLICT"
  | "AUTH_REQUIRED";

export interface QueuedVenueReview {
  id: string; // Client-generated UUID (idempotency key)
  venueId: string;
  venueName?: string;
  reviewId?: string; // Existing review ID if updating
  baseVenueUpdatedAt?: string;
  baseReviewUpdatedAt?: string;
  baseVersionTimestamp?: string;
  baseVersion?: string;
  data: {
    wifiQuality: number;
    hasOutlets: boolean;
    noiseLevel: "quiet" | "moderate" | "loud";
    avgDecibels?: number;
    peakDecibels?: number;
    comment?: string;
    hasErgonomic?: boolean;
    outletDensity?: string;
    wifiSpeed?: number;
    downloadSpeed?: number;
    uploadSpeed?: number;
    latency?: number;
    crowdLevel?: string;
    lighting?: string;
    musicStyle?: string;
    powerTypes?: string[];
    outletLocations?: string[];
    petsAllowedIndoors?: boolean;
    patioOnly?: boolean;
    waterBowlsProvided?: boolean;
    dogFriendly?: boolean;
    catsAllowed?: boolean;
    speedtestPhoto?: string;
    telemetry?: {
      download: number;
      upload: number;
      latency: number;
      crowdLevel: string;
      timestamp: string;
    };
  };
  createdAt: number;
  retryCount: number;
  status: QueuedReviewStatus;
  conflictDetails?: {
    conflictType?: string;
    serverReview?: Record<string, unknown>;
    message?: string;
  };
}

export interface ReviewSyncBroadcastEvent {
  type:
    | "REVIEW_QUEUED"
    | "REVIEW_DEQUEUED"
    | "REVIEW_SYNC_SUCCESS"
    | "REVIEW_SYNC_CONFLICT"
    | "REVIEW_SYNC_AUTH_REQUIRED"
    | "REVIEW_SYNC_FAILED";
  id?: string;
  venueId?: string;
  venueName?: string;
  conflictDetails?: QueuedVenueReview["conflictDetails"];
  error?: string;
}

let dbInstance: IDBDatabase | null = null;

if (typeof window !== "undefined") {
  window.addEventListener(
    "beforeunload",
    () => {
      dbInstance?.close();
      dbInstance = null;
    },
    { once: true },
  );
}

/**
 * Open worksphere-offline IndexedDB ensuring version 7 schema upgrade.
 */
export function openReviewDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("IndexedDB is not available in this environment"),
    );
  }

  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        dbInstance = null;
        console.warn("[offlineReviewSync] IndexedDB open timed out (likely Safari Private Browsing)");
        reject(new DOMException("IndexedDB open timed out", "SecurityError"));
      }
    }, 3000);

    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onblocked = () => {
        console.warn("[offlineReviewSync] IndexedDB upgrade blocked by open connection, closing inactive connections");
        if (dbInstance) {
          try {
            dbInstance.close();
          } catch {
            // ignore
          }
          dbInstance = null;
        }
      };

      request.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (dbInstance) {
          try {
            dbInstance.close();
          } catch {
            // ignore
          }
          dbInstance = null;
        }
        const err = request.error || new Error("Failed to open IndexedDB");
        if (err.name === "AbortError") {
          console.warn("[offlineReviewSync] Transaction abort error during schema upgrade handled gracefully", err);
        }
        reject(err);
      };

      request.onsuccess = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        dbInstance = request.result;
        dbInstance.onversionchange = () => {
          console.warn("[offlineReviewSync] Database version change detected, closing connection gracefully");
          try {
            dbInstance?.close();
          } catch {
            // ignore
          }
          dbInstance = null;
        };
        resolve(dbInstance);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = (event.target as IDBOpenDBRequest).transaction;

        if (transaction) {
          transaction.onabort = (e) => {
            console.warn("[offlineReviewSync] Upgrade transaction aborted", transaction.error || e);
          };
          transaction.onerror = (e) => {
            console.warn("[offlineReviewSync] Upgrade transaction error", transaction.error || e);
          };
        }

        db.onversionchange = () => {
          console.warn("[offlineReviewSync] Database version change during upgrade, closing connection gracefully");
          try {
            db.close();
          } catch {
            // ignore
          }
          dbInstance = null;
        };

        // Existing stores preserved
        if (!db.objectStoreNames.contains("venues")) {
          const venuesStore = db.createObjectStore("venues", { keyPath: "id" });
          venuesStore.createIndex("type", "type", { unique: false });
          venuesStore.createIndex("savedAt", "savedAt", { unique: false });
        }
        if (!db.objectStoreNames.contains("favorites")) {
          const favoritesStore = db.createObjectStore("favorites", { keyPath: "id" });
          favoritesStore.createIndex("savedAt", "savedAt", { unique: false });
        }
        if (!db.objectStoreNames.contains("searches")) {
          const searchesStore = db.createObjectStore("searches", { keyPath: "query" });
          searchesStore.createIndex("timestamp", "timestamp", { unique: false });
        }
        if (!db.objectStoreNames.contains("pendingActions")) {
          db.createObjectStore("pendingActions", { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("imageCacheLRU")) {
          const lruStore = db.createObjectStore("imageCacheLRU", { keyPath: "url" });
          lruStore.createIndex("lastAccessed", "lastAccessed", { unique: false });
        }
        if (!db.objectStoreNames.contains("receiptExports")) {
          const receiptStore = db.createObjectStore("receiptExports", { keyPath: "bookingId" });
          receiptStore.createIndex("status", "status", { unique: false });
          receiptStore.createIndex("createdAt", "createdAt", { unique: false });
        }
        if (!db.objectStoreNames.contains("pendingFavorites")) {
          db.createObjectStore("pendingFavorites", { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("availabilityDeltas")) {
          const deltaStore = db.createObjectStore("availabilityDeltas", { keyPath: "venueId" });
          deltaStore.createIndex("timestamp", "timestamp", { unique: false });
        }
        if (!db.objectStoreNames.contains("preference_rankings")) {
          db.createObjectStore("preference_rankings", { keyPath: "id" });
        }

        // Dedicated offline reviews store (Issue #3366, #3469)
        if (!db.objectStoreNames.contains(REVIEW_STORE_NAME)) {
          const reviewStore = db.createObjectStore(REVIEW_STORE_NAME, {
            keyPath: "id",
          });
          reviewStore.createIndex("venueId", "venueId", { unique: false });
          reviewStore.createIndex("status", "status", { unique: false });
          reviewStore.createIndex("createdAt", "createdAt", { unique: false });
        }
        if (!db.objectStoreNames.contains(QUEUED_REVIEWS_STORE_NAME)) {
          const queuedStore = db.createObjectStore(QUEUED_REVIEWS_STORE_NAME, {
            keyPath: "id",
          });
          queuedStore.createIndex("venueId", "venueId", { unique: false });
          queuedStore.createIndex("status", "status", { unique: false });
          queuedStore.createIndex("createdAt", "createdAt", { unique: false });
        }
      };
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      dbInstance = null;
      reject(err);
    }
  });
}

export function broadcastReviewSyncEvent(event: ReviewSyncBroadcastEvent): void {
  if (typeof window === "undefined") return;

  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(REVIEW_SYNC_CHANNEL);
      channel.postMessage(event);
      channel.close();
    }
  } catch (err) {
    console.warn("[offlineReviewSync] BroadcastChannel error:", err);
  }

  try {
    window.dispatchEvent(
      new CustomEvent("worksphere:review-sync-event", { detail: event }),
    );
  } catch {}
}

/**
 * Generate a random UUID safely across browser & node test runtimes.
 */
export function generateClientReviewId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `rev-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Queues a review in IndexedDB under Web Locks serialization.
 */
export async function queueOfflineReview(
  item: Omit<QueuedVenueReview, "id" | "createdAt" | "retryCount" | "status"> & {
    id?: string;
  },
): Promise<QueuedVenueReview> {
  return withWebLock(async () => {
    const db = await openReviewDB();
    const id = item.id || generateClientReviewId();

    const baseVersionTimestamp =
      item.baseVersionTimestamp ||
      item.baseReviewUpdatedAt ||
      item.baseVenueUpdatedAt;

    const queuedReview: QueuedVenueReview = {
      ...item,
      baseVersionTimestamp,
      baseVersion: item.baseVersion || baseVersionTimestamp,
      id,
      createdAt: Date.now(),
      retryCount: 0,
      status: "PENDING",
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([REVIEW_STORE_NAME], "readwrite");
      const store = tx.objectStore(REVIEW_STORE_NAME);
      const req = store.put(queuedReview);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    broadcastReviewSyncEvent({
      type: "REVIEW_QUEUED",
      id: queuedReview.id,
      venueId: queuedReview.venueId,
      venueName: queuedReview.venueName,
    });

    // Request Service Worker Background Sync where supported
    await requestReviewBackgroundSync();

    // Also register with consolidated SyncQueueManager
    void syncQueueManager
      .enqueue<QueuedVenueReview>({
        id: queuedReview.id,
        entity: "review",
        action: "create",
        payload: queuedReview,
        timestamp: queuedReview.createdAt,
      })
      .catch(() => {});

    return queuedReview;
  }, OFFLINE_WRITE_LOCK);
}

/**
 * Retrieve queued reviews, optionally filtered by status.
 */
export async function getQueuedReviews(
  statusFilter?: QueuedReviewStatus,
): Promise<QueuedVenueReview[]> {
  return withWebLock(async () => {
    const db = await openReviewDB();

    return new Promise<QueuedVenueReview[]>((resolve, reject) => {
      const tx = db.transaction([REVIEW_STORE_NAME], "readonly");
      const store = tx.objectStore(REVIEW_STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        let results = (req.result || []) as QueuedVenueReview[];
        if (statusFilter) {
          results = results.filter((r) => r.status === statusFilter);
        }
        // FIFO order
        results.sort((a, b) => a.createdAt - b.createdAt);
        resolve(results);
      };
      req.onerror = () => reject(req.error);
    });
  }, OFFLINE_WRITE_LOCK);
}

/**
 * Get queued reviews for a specific venue.
 */
export async function getQueuedReviewsByVenue(
  venueId: string,
): Promise<QueuedVenueReview[]> {
  const all = await getQueuedReviews();
  return all.filter((r) => r.venueId === venueId);
}

/**
 * Remove a review from the queue after successful sync or dismissal.
 */
export async function removeQueuedReview(id: string): Promise<void> {
  return withWebLock(async () => {
    const db = await openReviewDB();

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([REVIEW_STORE_NAME], "readwrite");
      const store = tx.objectStore(REVIEW_STORE_NAME);
      const req = store.delete(id);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    broadcastReviewSyncEvent({
      type: "REVIEW_DEQUEUED",
      id,
    });
  }, OFFLINE_WRITE_LOCK);
}

/**
 * Update the status and optional conflict details of a queued review.
 */
export async function updateQueuedReviewStatus(
  id: string,
  status: QueuedReviewStatus,
  conflictDetails?: QueuedVenueReview["conflictDetails"],
): Promise<void> {
  return withWebLock(async () => {
    const db = await openReviewDB();

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([REVIEW_STORE_NAME], "readwrite");
      const store = tx.objectStore(REVIEW_STORE_NAME);
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const item = getReq.result as QueuedVenueReview | undefined;
        if (!item) {
          resolve();
          return;
        }

        item.status = status;
        if (conflictDetails !== undefined) {
          item.conflictDetails = conflictDetails;
        }

        const putReq = store.put(item);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };

      getReq.onerror = () => reject(getReq.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }, OFFLINE_WRITE_LOCK);
}

/**
 * Return count of active queued reviews (PENDING or FAILED).
 */
export async function getPendingReviewCount(): Promise<number> {
  const reviews = await getQueuedReviews();
  return reviews.filter(
    (r) => r.status === "PENDING" || r.status === "FAILED" || r.status === "CONFLICT",
  ).length;
}

/**
 * Trigger Background Sync using ServiceWorkerRegistration.sync if available.
 */
export async function requestReviewBackgroundSync(): Promise<boolean> {
  if (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "SyncManager" in window
  ) {
    try {
      const swReg = await navigator.serviceWorker.ready;
      if (swReg && "sync" in swReg) {
        await (swReg as any).sync.register("sync-reviews");
        return true;
      }
    } catch (err) {
      console.warn("[offlineReviewSync] Background sync registration failed:", err);
    }
  }
  return false;
}

/**
 * Fallback client sync for browsers lacking Background Sync API (Safari, iOS, Firefox).
 */
export async function flushPendingReviewsClientFallback(
  options: { force?: boolean } = {},
): Promise<{ flushed: number; conflicts: number; failures: number }> {
  if (typeof navigator !== "undefined" && !navigator.onLine && !options.force) {
    return { flushed: 0, conflicts: 0, failures: 0 };
  }

  let flushed = 0;
  let conflicts = 0;
  let failures = 0;

  const reviews = await getQueuedReviews();
  const candidates = reviews.filter(
    (r) => r.status === "PENDING" || r.status === "FAILED",
  );

  for (const item of candidates) {
    try {
      await updateQueuedReviewStatus(item.id, "SYNCING");

      // Acquire CSRF token
      let csrfToken = "";
      try {
        const csrfRes = await fetch("/api/auth/csrf-token");
        if (csrfRes.ok) {
          const csrfData = await csrfRes.json();
          csrfToken = csrfData.csrfToken || "";
        }
      } catch {}

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Idempotency-Key": item.id,
      };
      if (csrfToken) {
        headers["x-csrf-token"] = csrfToken;
      }

      const baseVersionTimestamp =
        item.baseVersionTimestamp ||
        item.baseReviewUpdatedAt ||
        item.baseVenueUpdatedAt;

      const res = await fetch(
        `/api/venues/${encodeURIComponent(item.venueId)}/reviews`,
        {
          method: "POST",
          headers,
          credentials: "same-origin",
          body: JSON.stringify({
            ...item.data,
            idempotencyKey: item.id,
            reviewId: item.reviewId,
            baseVenueUpdatedAt: item.baseVenueUpdatedAt,
            baseReviewUpdatedAt: item.baseReviewUpdatedAt || baseVersionTimestamp,
            baseVersion: item.baseVersion || baseVersionTimestamp,
            baseVersionTimestamp,
          }),
        },
      );

      if (res.ok) {
        await removeQueuedReview(item.id);
        flushed++;
        broadcastReviewSyncEvent({
          type: "REVIEW_SYNC_SUCCESS",
          id: item.id,
          venueId: item.venueId,
          venueName: item.venueName,
        });
        continue;
      }

      if (res.status === 409) {
        conflicts++;
        const conflictJson = await res.json().catch(() => ({}));
        await updateQueuedReviewStatus(item.id, "CONFLICT", conflictJson);
        broadcastReviewSyncEvent({
          type: "REVIEW_SYNC_CONFLICT",
          id: item.id,
          venueId: item.venueId,
          venueName: item.venueName,
          conflictDetails: conflictJson,
        });
        continue;
      }

      if (res.status === 401 || res.status === 403) {
        await updateQueuedReviewStatus(item.id, "AUTH_REQUIRED");
        broadcastReviewSyncEvent({
          type: "REVIEW_SYNC_AUTH_REQUIRED",
          id: item.id,
          venueId: item.venueId,
        });
        break;
      }

      if (res.status >= 500) {
        failures++;
        const nextRetry = (item.retryCount || 0) + 1;
        const newStatus: QueuedReviewStatus =
          nextRetry >= 3 ? "FAILED" : "PENDING";
        await withWebLock(async () => {
          const db = await openReviewDB();
          const tx = db.transaction([REVIEW_STORE_NAME], "readwrite");
          const store = tx.objectStore(REVIEW_STORE_NAME);
          await new Promise<void>((resolve, reject) => {
            const req = store.put({
              ...item,
              retryCount: nextRetry,
              status: newStatus,
            });
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          });
        });
        continue;
      }

      // 400, 422 etc
      failures++;
      await updateQueuedReviewStatus(item.id, "FAILED");
      broadcastReviewSyncEvent({
        type: "REVIEW_SYNC_FAILED",
        id: item.id,
        venueId: item.venueId,
        error: "Validation error",
      });
    } catch (err: any) {
      const isNetError =
        err?.name === "TypeError" ||
        err?.message?.includes("fetch") ||
        err?.message?.includes("Network");
      if (isNetError) {
        // Retain PENDING without penalty
        await updateQueuedReviewStatus(item.id, "PENDING");
        break;
      }
      failures++;
      await updateQueuedReviewStatus(item.id, "FAILED");
    }
  }

  return { flushed, conflicts, failures };
}

/**
 * Detects whether a concurrent remote update occurred by comparing
 * client baseVersionTimestamp against server updatedAt.
 */
export function detectConcurrentUpdate(
  baseVersionTimestamp?: string,
  serverUpdatedAt?: string,
): boolean {
  if (!baseVersionTimestamp || !serverUpdatedAt) return false;
  return new Date(serverUpdatedAt).getTime() > new Date(baseVersionTimestamp).getTime();
}

export interface ThreeWayMergeOptions {
  baseData?: Partial<QueuedVenueReview["data"]>;
  baseVersionTimestamp?: string;
  serverUpdatedAt?: string;
  preferNewer?: boolean;
}

/**
 * Applies three-way merge or preserves newer edits between local queued edits and server review.
 */
export function applyThreeWayMerge(
  localData: QueuedVenueReview["data"],
  serverReview: Record<string, unknown>,
  options: ThreeWayMergeOptions = {},
): QueuedVenueReview["data"] {
  const merged: QueuedVenueReview["data"] = { ...localData };
  const baseData = options.baseData;
  const isServerNewer =
    options.preferNewer !== false &&
    detectConcurrentUpdate(
      options.baseVersionTimestamp,
      options.serverUpdatedAt || (serverReview.updatedAt as string),
    );

  const allKeys = Array.from(
    new Set([
      ...Object.keys(localData),
      ...Object.keys(serverReview),
      ...(baseData ? Object.keys(baseData) : []),
    ]),
  ) as (keyof QueuedVenueReview["data"])[];

  for (const key of allKeys) {
    if (
      key === ("id" as any) ||
      key === ("createdAt" as any) ||
      key === ("updatedAt" as any) ||
      key === ("venueId" as any) ||
      key === ("userId" as any)
    ) {
      continue;
    }

    const localVal = localData[key];
    const serverVal = serverReview[key as string] as any;
    const baseVal = baseData ? baseData[key] : undefined;

    if (serverVal === undefined) {
      if (localVal !== undefined) {
        (merged as any)[key] = localVal;
      }
      continue;
    }

    if (localVal === undefined) {
      (merged as any)[key] = serverVal;
      continue;
    }

    // Both defined:
    if (baseData && baseVal !== undefined) {
      const localChanged =
        JSON.stringify(localVal) !== JSON.stringify(baseVal);
      const serverChanged =
        JSON.stringify(serverVal) !== JSON.stringify(baseVal);

      if (serverChanged && !localChanged) {
        // Server changed, local did not -> preserve server update
        (merged as any)[key] = serverVal;
      } else if (!serverChanged && localChanged) {
        // Local changed, server did not -> keep local edit
        (merged as any)[key] = localVal;
      } else if (serverChanged && localChanged) {
        // Both changed:
        if (isServerNewer && key !== "comment") {
          (merged as any)[key] = serverVal;
        } else if (
          key === "comment" &&
          typeof localVal === "string" &&
          typeof serverVal === "string"
        ) {
          (merged as any)[key] =
            localVal === serverVal
              ? localVal
              : `${localVal} (Server update: ${serverVal})`;
        } else {
          (merged as any)[key] = isServerNewer ? serverVal : localVal;
        }
      }
    } else {
      // Without base data: if server is newer, preserve server update
      if (isServerNewer) {
        (merged as any)[key] = serverVal;
      } else {
        (merged as any)[key] = localVal !== undefined ? localVal : serverVal;
      }
    }
  }

  return merged;
}

/**
 * Resolve a review conflict deterministically: "KEEP_LOCAL", "USE_REMOTE", "MERGE_NEWER", or "THREE_WAY_MERGE".
 */
export async function resolveReviewConflict(
  id: string,
  resolution: "KEEP_LOCAL" | "USE_REMOTE" | "MERGE_NEWER" | "THREE_WAY_MERGE",
  options?: {
    baseData?: Partial<QueuedVenueReview["data"]>;
    preferNewer?: boolean;
  },
): Promise<boolean> {
  const reviews = await getQueuedReviews();
  const item = reviews.find((r) => r.id === id);
  if (!item) return false;

  if (resolution === "USE_REMOTE") {
    await removeQueuedReview(id);
    return true;
  }

  const serverReview = (item.conflictDetails?.serverReview || {}) as Record<string, unknown>;
  const serverUpdatedAt = (serverReview.updatedAt as string) || undefined;
  const baseVersionTimestamp = item.baseVersionTimestamp || item.baseReviewUpdatedAt;

  let payloadData: QueuedVenueReview["data"] = item.data;

  if (resolution === "MERGE_NEWER" || resolution === "THREE_WAY_MERGE") {
    payloadData = applyThreeWayMerge(item.data, serverReview, {
      baseData: options?.baseData,
      baseVersionTimestamp,
      serverUpdatedAt,
      preferNewer: options?.preferNewer ?? true,
    });
  }

  // KEEP_LOCAL or MERGE -> submit with forceOverwrite
  let csrfToken = "";
  try {
    const csrfRes = await fetch("/api/auth/csrf-token");
    if (csrfRes.ok) {
      const csrfData = await csrfRes.json();
      csrfToken = csrfData.csrfToken || "";
    }
  } catch {}

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Idempotency-Key": item.id,
  };
  if (csrfToken) {
    headers["x-csrf-token"] = csrfToken;
  }

  const res = await fetch(
    `/api/venues/${encodeURIComponent(item.venueId)}/reviews`,
    {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify({
        ...payloadData,
        idempotencyKey: item.id,
        forceOverwrite: true,
      }),
    },
  );

  if (res.ok) {
    await removeQueuedReview(id);
    broadcastReviewSyncEvent({
      type: "REVIEW_SYNC_SUCCESS",
      id: item.id,
      venueId: item.venueId,
      venueName: item.venueName,
    });
    return true;
  }

  return false;
}

/**
 * Subscribe to review sync events across BroadcastChannel and Service Worker postMessage.
 */
export function subscribeReviewSyncEvents(
  callback: (event: ReviewSyncBroadcastEvent) => void,
): () => void {
  let bc: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== "undefined") {
    try {
      bc = new BroadcastChannel(REVIEW_SYNC_CHANNEL);
      bc.onmessage = (e) => {
        if (e?.data) callback(e.data);
      };
    } catch {}
  }

  const handleSwMessage = (e: MessageEvent) => {
    if (
      e?.data &&
      typeof e.data.type === "string" &&
      e.data.type.startsWith("REVIEW_SYNC")
    ) {
      callback(e.data);
    }
  };

  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", handleSwMessage);
  }

  return () => {
    if (bc) {
      bc.close();
    }
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.removeEventListener("message", handleSwMessage);
    }
  };
}

export interface OfflineReviewSubmissionInput {
  venueId: string;
  venueName?: string;
  rating?: number;
  comment?: string;
  data?: QueuedVenueReview["data"];
  reviewId?: string;
  baseVenueUpdatedAt?: string;
  baseReviewUpdatedAt?: string;
  baseVersionTimestamp?: string;
  baseVersion?: string;
}

export interface OfflineReviewSubmissionResult {
  savedOffline: boolean;
  message: string;
  review?: QueuedVenueReview;
}

/**
 * Intercepts review submissions when offline:
 * - Checks if !navigator.onLine
 * - Stores review into IndexedDB queue
 * - Returns optimistic "Saved offline — will post when connected" pill message
 * - Registers background sync tag
 */
export async function submitReviewWithOfflineSync(
  input: OfflineReviewSubmissionInput,
): Promise<OfflineReviewSubmissionResult> {
  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;

  if (isOffline) {
    const reviewData: QueuedVenueReview["data"] = input.data || {
      wifiQuality: input.rating || 5,
      hasOutlets: true,
      noiseLevel: "moderate",
      comment: input.comment || "",
    };

    const queued = await queueOfflineReview({
      venueId: input.venueId,
      venueName: input.venueName,
      reviewId: input.reviewId,
      baseVenueUpdatedAt: input.baseVenueUpdatedAt,
      baseReviewUpdatedAt: input.baseReviewUpdatedAt,
      baseVersionTimestamp: input.baseVersionTimestamp || input.baseReviewUpdatedAt,
      baseVersion: input.baseVersion,
      data: reviewData,
    });

    return {
      savedOffline: true,
      message: "Saved offline — will post when connected",
      review: queued,
    };
  }

  // When online, queue or caller can post directly
  return {
    savedOffline: false,
    message: "Online",
  };
}


