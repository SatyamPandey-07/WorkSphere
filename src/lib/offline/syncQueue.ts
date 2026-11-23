/**
 * syncQueue.ts
 *
 * Implements persistent Background Sync Queue with IndexedDB storage for offline
 * desk check-ins via ServiceWorker SyncManager (#7427).
 *
 * Requirements:
 * - Register SyncManager tag ('nomad-checkin-sync') when check-in is initiated offline.
 * - Store pending check-in payloads (including cryptographically signed timestamp, seat ID, and client nonce)
 *   in IndexedDB under the 'pendingCheckins' object store.
 * - Listen to the sync event in ServiceWorker and replay queued requests with idempotency keys.
 * - Dispatch BroadcastChannel notifications to the client UI once background sync completes.
 */

import { createHmac } from "node:crypto";

export const SYNC_TAG = "nomad-checkin-sync";
export const CHECKIN_STORE_NAME = "pendingCheckins";
export const CHECKIN_SYNC_BROADCAST_CHANNEL = "nomad-checkin-sync-channel";
export const DEFAULT_OFFLINE_DB_NAME = "worksphere-offline";
export const DEFAULT_OFFLINE_DB_VERSION = 9;

export interface CheckinPayload {
  seatId: string;
  venueId?: string;
  userId?: string;
  timestamp?: number;
  clientNonce?: string;
  signedTimestamp?: string;
  idempotencyKey?: string;
  status?: "pending" | "processing" | "synced" | "failed";
  retryCount?: number;
  createdAt?: number;
  metadata?: Record<string, unknown>;
}

export interface StoredCheckin {
  id: string;
  seatId: string;
  venueId?: string;
  userId?: string;
  timestamp: number;
  clientNonce: string;
  signedTimestamp: string;
  idempotencyKey: string;
  status: "pending" | "processing" | "synced" | "failed";
  retryCount: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface ReplayResult {
  synced: StoredCheckin[];
  failed: StoredCheckin[];
  totalProcessed: number;
}

/**
 * Generates a unique client-side nonce for replay attack prevention.
 */
export function generateClientNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return (
    Math.random().toString(36).substring(2, 15) +
    "_" +
    Date.now().toString(36)
  );
}

/**
 * Creates a cryptographic HMAC-SHA256 signature over (seatId, timestamp, nonce)
 * to verify authenticity and integrity of offline check-in payloads.
 */
export function signCheckinTimestamp(
  seatId: string,
  timestamp: number,
  nonce: string,
  secretKey: string = "worksphere-nomad-secret-v1",
): string {
  const payload = `${seatId}:${timestamp}:${nonce}`;
  try {
    const hmac = createHmac("sha256", secretKey);
    hmac.update(payload);
    return hmac.digest("hex");
  } catch {
    // Pure browser fallback using DJB2-based deterministic hash if crypto is restricted
    let hash = 5381;
    for (let i = 0; i < payload.length; i++) {
      hash = (hash * 33) ^ payload.charCodeAt(i);
    }
    return `sig_${(hash >>> 0).toString(16)}_${nonce.slice(0, 8)}`;
  }
}

/**
 * Generates a deterministic idempotency key for preventing duplicate server check-ins.
 */
export function generateIdempotencyKey(
  seatId: string,
  timestamp: number,
  nonce: string,
): string {
  return `checkin_${seatId}_${timestamp}_${nonce}`;
}

/**
 * Registers a Background Sync tag with the ServiceWorker SyncManager.
 */
export async function registerBackgroundSync(
  tag: string = SYNC_TAG,
): Promise<boolean> {
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      if (registration && "sync" in registration) {
        await (registration as any).sync.register(tag);
        return true;
      }
    } catch (err) {
      console.warn("[SyncQueue] SyncManager tag registration failed:", err);
    }
  }
  return false;
}

/**
 * Opens or upgrades the IndexedDB instance ensuring the 'pendingCheckins' object store exists.
 */
export async function openCheckinDB(
  dbName: string = DEFAULT_OFFLINE_DB_NAME,
  version: number = DEFAULT_OFFLINE_DB_VERSION,
): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is not available in this environment.");
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, version);

    request.onerror = () => {
      reject(request.error || new Error("Failed to open IndexedDB"));
    };

    request.onsuccess = () => {
      const db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(CHECKIN_STORE_NAME)) {
        const store = db.createObjectStore(CHECKIN_STORE_NAME, { keyPath: "id" });
        store.createIndex("seatId", "seatId", { unique: false });
        store.createIndex("idempotencyKey", "idempotencyKey", { unique: true });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
  });
}

/**
 * Enqueues a check-in payload into IndexedDB and triggers SyncManager registration.
 */
export async function enqueueCheckin(
  payload: CheckinPayload,
  dbName: string = DEFAULT_OFFLINE_DB_NAME,
): Promise<StoredCheckin> {
  if (!payload.seatId) {
    throw new Error("seatId is required for check-in");
  }

  const timestamp = payload.timestamp ?? Date.now();
  const clientNonce = payload.clientNonce ?? generateClientNonce();
  const signedTimestamp =
    payload.signedTimestamp ?? signCheckinTimestamp(payload.seatId, timestamp, clientNonce);
  const idempotencyKey =
    payload.idempotencyKey ?? generateIdempotencyKey(payload.seatId, timestamp, clientNonce);
  const id = payload.idempotencyKey ?? idempotencyKey;

  const storedItem: StoredCheckin = {
    id,
    seatId: payload.seatId,
    venueId: payload.venueId,
    userId: payload.userId,
    timestamp,
    clientNonce,
    signedTimestamp,
    idempotencyKey,
    status: payload.status ?? "pending",
    retryCount: payload.retryCount ?? 0,
    createdAt: payload.createdAt ?? Date.now(),
    metadata: payload.metadata,
  };

  const db = await openCheckinDB(dbName);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CHECKIN_STORE_NAME, "readwrite");
    const store = tx.objectStore(CHECKIN_STORE_NAME);
    const putReq = store.put(storedItem);

    putReq.onsuccess = () => resolve();
    putReq.onerror = () => reject(putReq.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });

  // Register SyncManager tag with Service Worker
  await registerBackgroundSync(SYNC_TAG);

  return storedItem;
}

/**
 * Retrieves all stored check-ins from IndexedDB.
 */
export async function getPendingCheckins(
  dbName: string = DEFAULT_OFFLINE_DB_NAME,
): Promise<StoredCheckin[]> {
  const db = await openCheckinDB(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHECKIN_STORE_NAME, "readonly");
    const store = tx.objectStore(CHECKIN_STORE_NAME);
    const getReq = store.getAll();

    getReq.onsuccess = () => {
      db.close();
      resolve(getReq.result || []);
    };
    getReq.onerror = () => {
      db.close();
      reject(getReq.error);
    };
  });
}

/**
 * Removes a synced check-in from the IndexedDB queue by ID.
 */
export async function deletePendingCheckin(
  id: string,
  dbName: string = DEFAULT_OFFLINE_DB_NAME,
): Promise<void> {
  const db = await openCheckinDB(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHECKIN_STORE_NAME, "readwrite");
    const store = tx.objectStore(CHECKIN_STORE_NAME);
    const delReq = store.delete(id);

    delReq.onsuccess = () => resolve();
    delReq.onerror = () => reject(delReq.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * Updates a check-in in IndexedDB (e.g. after retry attempt).
 */
export async function updatePendingCheckin(
  item: StoredCheckin,
  dbName: string = DEFAULT_OFFLINE_DB_NAME,
): Promise<void> {
  const db = await openCheckinDB(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHECKIN_STORE_NAME, "readwrite");
    const store = tx.objectStore(CHECKIN_STORE_NAME);
    const putReq = store.put(item);

    putReq.onsuccess = () => resolve();
    putReq.onerror = () => reject(putReq.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * Clears all pending check-ins from IndexedDB.
 */
export async function clearPendingCheckins(
  dbName: string = DEFAULT_OFFLINE_DB_NAME,
): Promise<void> {
  const db = await openCheckinDB(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHECKIN_STORE_NAME, "readwrite");
    const store = tx.objectStore(CHECKIN_STORE_NAME);
    const clearReq = store.clear();

    clearReq.onsuccess = () => resolve();
    clearReq.onerror = () => reject(clearReq.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export interface ReplayOptions {
  endpoint?: string;
  fetchFn?: typeof fetch;
  dbName?: string;
}

/**
 * Drains the background sync queue by sending queued requests to the server with
 * idempotency keys, updating IndexedDB, and broadcasting notifications to the client UI.
 */
export async function replayCheckinQueue(
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const dbName = options.dbName ?? DEFAULT_OFFLINE_DB_NAME;
  const endpoint = options.endpoint ?? "/api/checkin";
  const fetchFn = options.fetchFn ?? (typeof fetch !== "undefined" ? fetch : undefined);

  const pending = await getPendingCheckins(dbName);
  const synced: StoredCheckin[] = [];
  const failed: StoredCheckin[] = [];

  for (const item of pending) {
    if (!fetchFn) {
      failed.push(item);
      continue;
    }

    try {
      const response = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": item.idempotencyKey,
          "X-Client-Nonce": item.clientNonce,
          "X-Signed-Timestamp": item.signedTimestamp,
        },
        body: JSON.stringify({
          seatId: item.seatId,
          venueId: item.venueId,
          userId: item.userId,
          timestamp: item.timestamp,
          clientNonce: item.clientNonce,
          signedTimestamp: item.signedTimestamp,
          idempotencyKey: item.idempotencyKey,
        }),
      });

      // 200..299: Success
      // 409 Conflict: Server already processed this check-in idempotently
      if (response.ok || response.status === 409) {
        await deletePendingCheckin(item.id, dbName);
        synced.push({ ...item, status: "synced" });
      } else if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
        // Unrecoverable client error — remove or mark failed
        await deletePendingCheckin(item.id, dbName);
        failed.push({ ...item, status: "failed" });
      } else {
        // Transient error (5xx, 429, 408) — increment retry and leave in queue
        item.retryCount = (item.retryCount || 0) + 1;
        item.status = "pending";
        await updatePendingCheckin(item, dbName);
        failed.push(item);
      }
    } catch {
      // Network failure / still offline
      item.retryCount = (item.retryCount || 0) + 1;
      item.status = "pending";
      await updatePendingCheckin(item, dbName);
      failed.push(item);
    }
  }

  // Dispatch BroadcastChannel notification to the client UI
  const broadcastNotification = {
    type: "NOMAD_CHECKIN_SYNC_COMPLETE",
    tag: SYNC_TAG,
    syncedCount: synced.length,
    failedCount: failed.length,
    totalProcessed: pending.length,
    synced,
    timestamp: Date.now(),
  };

  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(CHECKIN_SYNC_BROADCAST_CHANNEL);
      channel.postMessage(broadcastNotification);
      channel.close();
    } catch (err) {
      console.warn("[SyncQueue] BroadcastChannel notification error:", err);
    }
  }

  return {
    synced,
    failed,
    totalProcessed: pending.length,
  };
}
