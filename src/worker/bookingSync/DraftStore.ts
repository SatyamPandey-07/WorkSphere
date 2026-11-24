/**
 * DraftStore.ts
 * Handles the serialization and retrieval of booking state drafts from IndexedDB.
 * Provides a robust, promise-based wrapper around IndexedDB for offline persistence.
 * Tracks Vector Clocks for CRDT causal tracking and offline conflict resolution.
 */

import { VectorClock } from "../../core/crdt/CrdtVectorClock";
import {
  encryptPayload,
  decryptPayload,
  EncryptedPayload,
} from "../../lib/security/clientEncryption";

const DB_NAME = "WorkSphereBookingDB";
const DB_VERSION = 1;
const STORE_NAME = "booking_drafts";

export interface BookingDraft {
  id: string;
  venueId: string;
  userId: string;
  payload: Record<string, unknown>;
  timestamp: number;
  serverVersion?: number;
  vectorClock?: VectorClock;
  nodeId?: string;
  updatedAt?: number;
  fieldClocks?: Record<
    string,
    { timestamp: number; clock: VectorClock; lamport: number; nodeId: string }
  >;
  encryptedPayload?: EncryptedPayload;
  isEncrypted?: boolean;
}

export const BOOKING_DRAFT_EVENTS = {
  CHANGED: "worksphere:booking-draft-changed",
  SYNCED: "worksphere:booking-draft-synced",
} as const;

export const BOOKING_DRAFTS_BROADCAST_CHANNEL = "worksphere:booking-drafts-channel";

function notifyDraftStoreChange(action: "save" | "delete" | "clear", draftId?: string): void {
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(
        new CustomEvent(BOOKING_DRAFT_EVENTS.CHANGED, {
          detail: { action, draftId },
        })
      );
    } catch {
      // Ignore in non-DOM contexts
    }
  }

  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(BOOKING_DRAFTS_BROADCAST_CHANNEL);
      channel.postMessage({ action, draftId, timestamp: Date.now() });
      channel.close();
    } catch {
      // Ignore broadcast errors
    }
  }
}

export class DraftStore {
  private db: IDBDatabase | null = null;
  private memoryFallback: Map<string, BookingDraft> = new Map();

  public async init(): Promise<void> {
    if (typeof indexedDB === "undefined") {
      return;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
    });
  }

  private async hydrateDraft(draft?: BookingDraft): Promise<BookingDraft | undefined> {
    if (!draft) return undefined;
    if (!draft.isEncrypted || !draft.encryptedPayload) {
      return { ...draft };
    }

    try {
      const decrypted = await decryptPayload<Record<string, unknown>>(draft.encryptedPayload);
      return {
        ...draft,
        payload: decrypted,
      };
    } catch (err: any) {
      console.error(`[DraftStore] Failed to decrypt draft ${draft.id}:`, err);
      return {
        ...draft,
        payload: { __corrupted: true, error: err.message },
      };
    }
  }

  public async saveDraft(draft: BookingDraft): Promise<void> {
    // Ensure vector clock is initialized for offline causal tracking
    if (!draft.vectorClock) {
      const clientNode = draft.nodeId || draft.userId || "client";
      draft.vectorClock = {
        [clientNode]: 1,
        server: draft.serverVersion || 0,
      };
    }

    // Transparently encrypt the sensitive booking payload before writing to IndexedDB or memory
    let storedDraft: BookingDraft = { ...draft };
    if (draft.payload && Object.keys(draft.payload).length > 0) {
      try {
        const encrypted = await encryptPayload(draft.payload);
        storedDraft = {
          ...draft,
          payload: {}, // Strip raw plaintext reservation data
          encryptedPayload: encrypted,
          isEncrypted: true,
        };
      } catch (err) {
        console.warn("[DraftStore] Encryption failed, persisting unencrypted fallback:", err);
      }
    }

    if (typeof indexedDB === "undefined") {
      this.memoryFallback.set(draft.id, storedDraft);
      notifyDraftStoreChange("save", draft.id);
      return;
    }

    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(storedDraft);

      request.onsuccess = () => {
        notifyDraftStoreChange("save", draft.id);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Internal/test helper: retrieves raw unhydrated draft from persistent storage.
   */
  public async getRawDraft(id: string): Promise<BookingDraft | undefined> {
    if (typeof indexedDB === "undefined") {
      return this.memoryFallback.get(id);
    }

    if (!this.db) await this.init();

    return new Promise<BookingDraft | undefined>((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  public async getDraft(id: string): Promise<BookingDraft | undefined> {
    let rawDraft: BookingDraft | undefined;
    if (typeof indexedDB === "undefined") {
      rawDraft = this.memoryFallback.get(id);
      return this.hydrateDraft(rawDraft);
    }

    if (!this.db) await this.init();

    rawDraft = await new Promise<BookingDraft | undefined>((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.hydrateDraft(rawDraft);
  }

  public async getAllDrafts(): Promise<BookingDraft[]> {
    let rawDrafts: BookingDraft[] = [];
    if (typeof indexedDB === "undefined") {
      rawDrafts = Array.from(this.memoryFallback.values());
    } else {
      if (!this.db) await this.init();

      rawDrafts = await new Promise<BookingDraft[]>((resolve, reject) => {
        const transaction = this.db!.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    }

    const hydrated = await Promise.all(
      rawDrafts.map((d) => this.hydrateDraft(d))
    );
    return hydrated.filter((d): d is BookingDraft => d !== undefined);
  }

  public async deleteDraft(id: string): Promise<void> {
    if (typeof indexedDB === "undefined") {
      this.memoryFallback.delete(id);
      notifyDraftStoreChange("delete", id);
      return;
    }

    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => {
        notifyDraftStoreChange("delete", id);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  public async clearAll(): Promise<void> {
    if (typeof indexedDB === "undefined") {
      this.memoryFallback.clear();
      notifyDraftStoreChange("clear");
      return;
    }

    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        notifyDraftStoreChange("clear");
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Returns the count of pending, unsynchronized booking drafts.
   * Drafts with status CONFIRMED or CANCELLED, or deleted drafts, are excluded.
   */
  public async getPendingDraftCount(): Promise<number> {
    try {
      const drafts = await this.getAllDrafts();
      const pendingDrafts = drafts.filter((draft) => {
        const payloadStatus = typeof draft.payload?.status === "string" ? draft.payload.status : undefined;
        if (payloadStatus === "CONFIRMED" || payloadStatus === "CANCELLED" || payloadStatus === "CANCELLED_BY_OPERATOR") {
          return false;
        }
        return true;
      });
      return pendingDrafts.length;
    } catch (error) {
      console.error("[DraftStore] Failed to query pending draft count:", error);
      return 0;
    }
  }

  /**
   * Updates an existing draft's payload and advances its vector clock for the local node.
   */
  public async updateDraftPayload(
    id: string,
    partialPayload: Record<string, unknown>,
    nodeId?: string,
  ): Promise<BookingDraft> {
    const existing = await this.getDraft(id);
    if (!existing) {
      throw new Error(`Draft with ID ${id} not found`);
    }

    const clientNode = nodeId || existing.nodeId || existing.userId || "client";
    const updatedClock = { ...(existing.vectorClock || {}) };
    updatedClock[clientNode] = (updatedClock[clientNode] || 0) + 1;

    const updatedDraft: BookingDraft = {
      ...existing,
      payload: { ...existing.payload, ...partialPayload },
      timestamp: Date.now(),
      updatedAt: Date.now(),
      vectorClock: updatedClock,
      nodeId: clientNode,
    };

    await this.saveDraft(updatedDraft);
    return updatedDraft;
  }

  /**
   * Factory helper to create a new draft with initialized vector clock metadata.
   */
  public async createDraft(
    draftData: Omit<BookingDraft, "timestamp" | "vectorClock"> & {
      timestamp?: number;
      vectorClock?: VectorClock;
      nodeId?: string;
    },
  ): Promise<BookingDraft> {
    const clientNode = draftData.nodeId || draftData.userId || "client";
    const draft: BookingDraft = {
      ...draftData,
      timestamp: draftData.timestamp || Date.now(),
      nodeId: clientNode,
      vectorClock: draftData.vectorClock || {
        [clientNode]: 1,
        server: draftData.serverVersion || 0,
      },
    };

    await this.saveDraft(draft);
    return draft;
  }
}
