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

export const yFavorites: Y.Map<OfflineVenue> = new Proxy({} as Y.Map<OfflineVenue>, {
  get(_target, prop, receiver) {
    const map = getYFavorites();
    if (!map) return undefined;
    const value = Reflect.get(map, prop, receiver);
    return typeof value === "function" ? value.bind(map) : value;
  },
});

export const yRatings: Y.Map<Record<string, unknown>> = new Proxy({} as Y.Map<Record<string, unknown>>, {
  get(_target, prop, receiver) {
    const map = getYRatings();
    if (!map) return undefined;
    const value = Reflect.get(map, prop, receiver);
    return typeof value === "function" ? value.bind(map) : value;
  },
});

export async function queueCrdtUpdate(update: Uint8Array): Promise<void> {
  const db = await initOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["pendingActions"], "readwrite");
    const store = tx.objectStore("pendingActions");
    const req = store.add({
      type: "CRDT_UPDATE",
      payload: Array.from(update),
      timestamp: Date.now(),
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingCrdtUpdates(): Promise<Uint8Array[]> {
  const db = await initOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["pendingActions"], "readonly");
    const store = tx.objectStore("pendingActions");
    const req = store.getAll();
    req.onsuccess = () => {
      const actions = (req.result || []) as Array<{ type: string; payload: number[] }>;
      const updates = actions
        .filter((a) => a.type === "CRDT_UPDATE")
        .map((a) => new Uint8Array(a.payload));
      resolve(updates);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearPendingCrdtUpdates(): Promise<void> {
  const db = await initOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["pendingActions"], "readwrite");
    const store = tx.objectStore("pendingActions");
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
