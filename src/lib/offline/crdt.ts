import * as Y from "yjs";
import { initOfflineDB } from "./db";
import type { OfflineVenue } from "./types";

let _userDoc: Y.Doc | null = null;

/**
 * Lazy factory function for the user Y.Doc instance, guarded against SSR environments.
 */
export function getUserDoc(): Y.Doc | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (!_userDoc) {
    _userDoc = new Y.Doc();
    _userDoc.on("update", async (update: Uint8Array) => {
      try {
        await queueCrdtUpdate(update);
      } catch (err) {
        console.error("Failed to queue CRDT update:", err);
      }
    });
  }
  return _userDoc;
}

export function getYFavorites(): Y.Map<OfflineVenue> | null {
  const doc = getUserDoc();
  return doc ? doc.getMap<OfflineVenue>("favorites") : null;
}

export function getYRatings(): Y.Map<Record<string, unknown>> | null {
  const doc = getUserDoc();
  return doc ? doc.getMap<Record<string, unknown>>("ratings") : null;
}

export function resetUserDoc(): void {
  if (_userDoc) {
    _userDoc.destroy();
    _userDoc = null;
  }
}

// Lazy Proxies for backward compatibility without top-level SSR instantiation
export const userDoc: Y.Doc = new Proxy({} as Y.Doc, {
  get(_target, prop, receiver) {
    const doc = getUserDoc();
    if (!doc) return undefined;
    const value = Reflect.get(doc, prop, receiver);
    return typeof value === "function" ? value.bind(doc) : value;
  },
  set(_target, prop, value, receiver) {
    const doc = getUserDoc();
    if (!doc) return false;
    return Reflect.set(doc, prop, value, receiver);
  },
});

export const yFavorites: Y.Map<OfflineVenue> = new Proxy(
  {} as Y.Map<OfflineVenue>,
  {
    get(_target, prop, receiver) {
      const map = getYFavorites();
      if (!map) return undefined;
      const value = Reflect.get(map, prop, receiver);
      return typeof value === "function" ? value.bind(map) : value;
    },
  },
);

export const yRatings: Y.Map<Record<string, unknown>> = new Proxy(
  {} as Y.Map<Record<string, unknown>>,
  {
    get(_target, prop, receiver) {
      const map = getYRatings();
      if (!map) return undefined;
      const value = Reflect.get(map, prop, receiver);
      return typeof value === "function" ? value.bind(map) : value;
    },
  },
);

// Queue entry shape consumed by syncCrdt() in public/sw.js.
const CRDT_ACTION_TYPE = "crdt-sync";
// Written by an earlier revision of this module; still drained so queued
// updates from before the format fix are not stranded.
const LEGACY_CRDT_ACTION_TYPE = "CRDT_UPDATE";

interface PendingCrdtAction {
  id: number;
  type: string;
  data?: Uint8Array | ArrayBuffer;
  payload?: number[];
}

function isCrdtAction(action: { type?: string }): boolean {
  return (
    action.type === CRDT_ACTION_TYPE || action.type === LEGACY_CRDT_ACTION_TYPE
  );
}

export async function queueCrdtUpdate(update: Uint8Array): Promise<void> {
  const db = await initOfflineDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["pendingActions"], "readwrite");
    const store = tx.objectStore("pendingActions");
    const req = store.add({
      type: CRDT_ACTION_TYPE,
      data: update,
      timestamp: Date.now(),
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  if (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "SyncManager" in window
  ) {
    navigator.serviceWorker.ready
      .then((swRegistration) =>
        // Background Sync is not in the TS DOM lib yet
        (swRegistration as any).sync.register("sync-crdt"),
      )
      .catch((err: unknown) => {
        console.error("Background Sync registration failed:", err);
      });
  }
}

export async function getPendingCrdtUpdates(): Promise<Uint8Array[]> {
  const db = await initOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["pendingActions"], "readonly");
    const store = tx.objectStore("pendingActions");
    const req = store.getAll();
    req.onsuccess = () => {
      const actions = (req.result || []) as PendingCrdtAction[];
      const updates = actions
        .filter(isCrdtAction)
        .map((a) => new Uint8Array(a.data ?? a.payload ?? []));
      resolve(updates);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Removes queued CRDT updates only. The pendingActions store is shared with
 * conversation edits and generic offline actions, which must survive.
 */
export async function clearPendingCrdtUpdates(): Promise<void> {
  const db = await initOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["pendingActions"], "readwrite");
    const store = tx.objectStore("pendingActions");
    const req = store.getAll();
    req.onsuccess = () => {
      for (const action of (req.result || []) as PendingCrdtAction[]) {
        if (isCrdtAction(action)) store.delete(action.id);
      }
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
