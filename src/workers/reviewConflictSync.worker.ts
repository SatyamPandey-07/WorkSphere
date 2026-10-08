/// <reference lib="webworker" />

/**
 * Background Web Worker for Periodic Offline Review Conflict Resolution & Sync
 * (src/workers/reviewConflictSync.worker.ts)
 *
 * Runs off the main thread to periodically inspect IndexedDB for pending and conflicting
 * offline venue reviews, execute optimistic sync with exponential backoff, detect 409
 * edit collisions, and facilitate automated or manual conflict resolution.
 */

export const DB_NAME = "worksphere-offline";
export const REVIEW_STORE_NAME = "pendingReviews";
export const DEFAULT_CHECK_INTERVAL_MS = 30000;

export type ConflictResolutionStrategy =
  | "KEEP_LOCAL"
  | "USE_REMOTE"
  | "AUTO_MERGE"
  | "THREE_WAY_MERGE"
  | "CUSTOM_MERGE";

export interface QueuedReviewItem {
  id: string;
  venueId: string;
  venueName?: string;
  reviewId?: string;
  baseVenueUpdatedAt?: string;
  baseReviewUpdatedAt?: string;
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
    telemetry?: Record<string, unknown>;
  };
  createdAt: number;
  retryCount: number;
  status: "PENDING" | "SYNCING" | "FAILED" | "CONFLICT" | "AUTH_REQUIRED";
  conflictDetails?: {
    conflictType?: string;
    serverReview?: Record<string, unknown>;
    message?: string;
  };
}

export type ReviewConflictWorkerInboundMessage =
  | { type: "START_PERIODIC_CHECK"; intervalMs?: number; token?: string; csrfToken?: string }
  | { type: "STOP_PERIODIC_CHECK" }
  | { type: "TRIGGER_SYNC"; token?: string; csrfToken?: string }
  | {
      type: "RESOLVE_CONFLICT";
      id: string;
      resolution: ConflictResolutionStrategy;
      customData?: QueuedReviewItem["data"];
      token?: string;
      csrfToken?: string;
    }
  | { type: "SET_AUTH_TOKEN"; token: string | null }
  | { type: "SET_CSRF_TOKEN"; csrfToken: string | null };

export type ReviewConflictWorkerOutboundMessage =
  | { type: "SYNC_STARTED" }
  | { type: "SYNC_SUCCESS"; id: string; venueId: string; venueName?: string }
  | {
      type: "CONFLICT_DETECTED";
      id: string;
      venueId: string;
      venueName?: string;
      conflictDetails: QueuedReviewItem["conflictDetails"];
      localReview?: QueuedReviewItem;
    }
  | { type: "CONFLICT_RESOLVED"; id: string; resolution: ConflictResolutionStrategy; success: boolean }
  | { type: "PERIODIC_CHECK_COMPLETE"; flushed: number; conflicts: number; failures: number; timestamp: number }
  | { type: "AUTH_REQUIRED"; id?: string }
  | { type: "SYNC_ERROR"; error: string };

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

let currentToken: string | null = null;
let currentCsrfToken: string | null = null;
let periodicIntervalId: ReturnType<typeof setInterval> | null = null;
let isSyncInProgress = false;

/**
 * Open worksphere-offline IndexedDB safely within worker context.
 */
function openWorkerReviewDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      return reject(new Error("IndexedDB unavailable in worker"));
    }

    const req = indexedDB.open(DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

/**
 * Fetch all queued reviews from IndexedDB.
 */
async function getWorkerQueuedReviews(): Promise<QueuedReviewItem[]> {
  try {
    const db = await openWorkerReviewDB();
    if (!db.objectStoreNames.contains(REVIEW_STORE_NAME)) {
      db.close();
      return [];
    }

    const tx = db.transaction([REVIEW_STORE_NAME], "readonly");
    const store = tx.objectStore(REVIEW_STORE_NAME);

    const items = await new Promise<QueuedReviewItem[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as QueuedReviewItem[]) || []);
      req.onerror = () => reject(req.error);
    });

    db.close();
    return items;
  } catch (err) {
    console.warn("[reviewConflictSyncWorker] Error reading reviews from IDB:", err);
    return [];
  }
}

/**
 * Update review item status in IndexedDB.
 */
async function updateWorkerReviewStatus(
  id: string,
  status: QueuedReviewItem["status"],
  conflictDetails?: QueuedReviewItem["conflictDetails"],
): Promise<void> {
  try {
    const db = await openWorkerReviewDB();
    const tx = db.transaction([REVIEW_STORE_NAME], "readwrite");
    const store = tx.objectStore(REVIEW_STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const item = getReq.result as QueuedReviewItem;
        if (!item) return resolve();

        const updated: QueuedReviewItem = {
          ...item,
          status,
          conflictDetails: conflictDetails ?? item.conflictDetails,
        };

        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });

    db.close();
  } catch (err) {
    console.warn("[reviewConflictSyncWorker] Error updating review status:", err);
  }
}

/**
 * Remove review item from IndexedDB.
 */
async function removeWorkerQueuedReview(id: string): Promise<void> {
  try {
    const db = await openWorkerReviewDB();
    const tx = db.transaction([REVIEW_STORE_NAME], "readwrite");
    const store = tx.objectStore(REVIEW_STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    db.close();
  } catch (err) {
    console.warn("[reviewConflictSyncWorker] Error removing review:", err);
  }
}

/**
 * Main review synchronization & conflict detection routine.
 */
async function runReviewSyncAndConflictResolution(): Promise<{
  flushed: number;
  conflicts: number;
  failures: number;
}> {
  if (isSyncInProgress) {
    return { flushed: 0, conflicts: 0, failures: 0 };
  }

  isSyncInProgress = true;
  workerScope.postMessage({ type: "SYNC_STARTED" } satisfies ReviewConflictWorkerOutboundMessage);

  let flushed = 0;
  let conflicts = 0;
  let failures = 0;

  try {
    const reviews = await getWorkerQueuedReviews();
    const pendingItems = reviews.filter((r) => r.status === "PENDING" || r.status === "SYNCING");

    for (const item of pendingItems) {
      await updateWorkerReviewStatus(item.id, "SYNCING");

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Idempotency-Key": item.id,
      };

      if (currentToken) {
        headers["Authorization"] = `Bearer ${currentToken}`;
      }
      if (currentCsrfToken) {
        headers["x-csrf-token"] = currentCsrfToken;
      }

      try {
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
              baseReviewUpdatedAt: item.baseReviewUpdatedAt,
            }),
          },
        );

        if (res.ok) {
          await removeWorkerQueuedReview(item.id);
          flushed++;
          workerScope.postMessage({
            type: "SYNC_SUCCESS",
            id: item.id,
            venueId: item.venueId,
            venueName: item.venueName,
          } satisfies ReviewConflictWorkerOutboundMessage);
          continue;
        }

        if (res.status === 409) {
          conflicts++;
          const conflictJson = await res.json().catch(() => ({}));
          await updateWorkerReviewStatus(item.id, "CONFLICT", conflictJson);
          workerScope.postMessage({
            type: "CONFLICT_DETECTED",
            id: item.id,
            venueId: item.venueId,
            venueName: item.venueName,
            conflictDetails: conflictJson,
            localReview: item,
          } satisfies ReviewConflictWorkerOutboundMessage);
          continue;
        }

        if (res.status === 401 || res.status === 403) {
          await updateWorkerReviewStatus(item.id, "AUTH_REQUIRED");
          workerScope.postMessage({
            type: "AUTH_REQUIRED",
            id: item.id,
          } satisfies ReviewConflictWorkerOutboundMessage);
          break;
        }

        failures++;
        const nextRetry = (item.retryCount || 0) + 1;
        const newStatus = nextRetry >= 3 ? "FAILED" : "PENDING";
        await updateWorkerReviewStatus(item.id, newStatus);
      } catch (err: any) {
        const isNetError =
          err?.name === "TypeError" ||
          err?.message?.includes("fetch") ||
          err?.message?.includes("Network");

        if (isNetError) {
          // Network offline; keep PENDING
          await updateWorkerReviewStatus(item.id, "PENDING");
          break;
        }

        failures++;
        await updateWorkerReviewStatus(item.id, "FAILED");
      }
    }
  } catch (error: any) {
    workerScope.postMessage({
      type: "SYNC_ERROR",
      error: error?.message || "Sync execution failed",
    } satisfies ReviewConflictWorkerOutboundMessage);
  } finally {
    isSyncInProgress = false;
  }

  workerScope.postMessage({
    type: "PERIODIC_CHECK_COMPLETE",
    flushed,
    conflicts,
    failures,
    timestamp: Date.now(),
  } satisfies ReviewConflictWorkerOutboundMessage);

  return { flushed, conflicts, failures };
}

// ── Pending Resolution Dispatch Map & 15s TTL Eviction (#5035) ────────────────
export interface PendingResolutionCallback {
  id: string;
  timestamp: number;
  timerId: ReturnType<typeof setTimeout>;
}

export const pendingResolutions = new Map<string, PendingResolutionCallback>();
export const RESOLUTION_TIMEOUT_MS = 15000; // 15s TTL per pending callback

export function getPendingResolutionsCount(): number {
  return pendingResolutions.size;
}

export function registerPendingResolution(id: string): void {
  clearPendingResolution(id);

  const timerId = setTimeout(() => {
    if (pendingResolutions.has(id)) {
      pendingResolutions.delete(id);
      workerScope.postMessage({
        type: "CONFLICT_RESOLVED",
        id,
        resolution: "AUTO_MERGE",
        success: false,
      } satisfies ReviewConflictWorkerOutboundMessage);
    }
  }, RESOLUTION_TIMEOUT_MS);

  pendingResolutions.set(id, { id, timestamp: Date.now(), timerId });
}

export function clearPendingResolution(id: string): void {
  const pending = pendingResolutions.get(id);
  if (pending) {
    clearTimeout(pending.timerId);
    pendingResolutions.delete(id);
  }
}

/**
 * Handle explicit conflict resolution request from main thread.
 */
async function handleResolveConflict(
  id: string,
  resolution: ConflictResolutionStrategy,
  customData?: QueuedReviewItem["data"],
): Promise<void> {
  registerPendingResolution(id);
  try {
    const reviews = await getWorkerQueuedReviews();
    const item = reviews.find((r) => r.id === id);

    if (!item) {
      workerScope.postMessage({
        type: "CONFLICT_RESOLVED",
        id,
        resolution,
        success: false,
      } satisfies ReviewConflictWorkerOutboundMessage);
      return;
    }

    if (resolution === "USE_REMOTE") {
      await removeWorkerQueuedReview(id);
      workerScope.postMessage({
        type: "CONFLICT_RESOLVED",
        id,
        resolution,
        success: true,
      } satisfies ReviewConflictWorkerOutboundMessage);
      return;
    }

    // Determine payload data based on resolution strategy
    let payloadData: QueuedReviewItem["data"] = customData || item.data;
    if (resolution === "THREE_WAY_MERGE" && !customData) {
      const serverReview = (item.conflictDetails?.serverReview || {}) as Record<string, unknown>;
      payloadData = {
        ...item.data,
        ...serverReview,
        ...(item.data.comment && serverReview.comment && item.data.comment !== serverReview.comment
          ? { comment: `${item.data.comment}\n\n[Server update: ${serverReview.comment}]` }
          : {}),
      } as QueuedReviewItem["data"];
    }

    // Force overwrite with merged / chosen payload
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Idempotency-Key": item.id,
    };

    if (currentToken) {
      headers["Authorization"] = `Bearer ${currentToken}`;
    }
    if (currentCsrfToken) {
      headers["x-csrf-token"] = currentCsrfToken;
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
      await removeWorkerQueuedReview(id);
      workerScope.postMessage({
        type: "CONFLICT_RESOLVED",
        id,
        resolution,
        success: true,
      } satisfies ReviewConflictWorkerOutboundMessage);
      workerScope.postMessage({
        type: "SYNC_SUCCESS",
        id: item.id,
        venueId: item.venueId,
        venueName: item.venueName,
      } satisfies ReviewConflictWorkerOutboundMessage);
    } else {
      workerScope.postMessage({
        type: "CONFLICT_RESOLVED",
        id,
        resolution,
        success: false,
      } satisfies ReviewConflictWorkerOutboundMessage);
    }
  } catch (err: any) {
    workerScope.postMessage({
      type: "SYNC_ERROR",
      error: err?.message || "Conflict resolution failed",
    } satisfies ReviewConflictWorkerOutboundMessage);
  } finally {
    clearPendingResolution(id);
  }
}

// ── Message Listener ─────────────────────────────────────────────────────────
workerScope.onmessage = async (event: MessageEvent<ReviewConflictWorkerInboundMessage>) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case "START_PERIODIC_CHECK": {
      if (msg.token) currentToken = msg.token;
      if (msg.csrfToken) currentCsrfToken = msg.csrfToken;

      const intervalMs = msg.intervalMs || DEFAULT_CHECK_INTERVAL_MS;

      if (periodicIntervalId) {
        clearInterval(periodicIntervalId);
      }

      periodicIntervalId = setInterval(() => {
        void runReviewSyncAndConflictResolution();
      }, intervalMs);

      // Run immediate initial check
      void runReviewSyncAndConflictResolution();
      break;
    }

    case "STOP_PERIODIC_CHECK": {
      if (periodicIntervalId) {
        clearInterval(periodicIntervalId);
        periodicIntervalId = null;
      }
      break;
    }

    case "TRIGGER_SYNC": {
      if (msg.token) currentToken = msg.token;
      if (msg.csrfToken) currentCsrfToken = msg.csrfToken;
      void runReviewSyncAndConflictResolution();
      break;
    }

    case "RESOLVE_CONFLICT": {
      if (msg.token) currentToken = msg.token;
      if (msg.csrfToken) currentCsrfToken = msg.csrfToken;
      void handleResolveConflict(msg.id, msg.resolution, msg.customData);
      break;
    }

    case "SET_AUTH_TOKEN": {
      currentToken = msg.token;
      break;
    }

    case "SET_CSRF_TOKEN": {
      currentCsrfToken = msg.csrfToken;
      break;
    }
  }
};
