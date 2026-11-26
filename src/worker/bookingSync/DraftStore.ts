/**
 * DraftStore.ts
 * Handles the serialization and retrieval of booking state drafts from IndexedDB.
 * Provides a robust, promise-based wrapper around IndexedDB for offline persistence.
 * Tracks Vector Clocks for CRDT causal tracking and offline conflict resolution.
 */

import { VectorClock } from '../../core/crdt/CrdtVectorClock';
import {
  encryptPayload,
  decryptPayload,
  EncryptedPayload,
} from '../../lib/security/clientEncryption';
import {
  openDatabaseWithMigration,
  isConnectionValid,
  assertConnectionUsable,
} from '../../lib/offline/migrationCoordinator';

const DB_NAME = 'WorkSphereBookingDB';
const DB_VERSION = 2;
const STORE_NAME = 'booking_drafts';

export interface BookingDraft {
  id: string;
  venueId: string;
  userId: string;
  payload: Record<string, unknown>;
  timestamp: number;
  venueName?: string;
  dateISO?: string;
  synced?: boolean;
  updatedAtMs?: number;
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

export type BookingDraftInput = Omit<
  BookingDraft,
  'userId' | 'payload' | 'timestamp'
> & {
  userId?: string;
  payload?: Record<string, unknown>;
  timestamp?: number;
};

type DraftListener = (pendingCount: number) => void;

export const BOOKING_DRAFT_EVENTS = {
  CHANGED: 'worksphere:booking-draft-changed',
  SYNCED: 'worksphere:booking-draft-synced',
} as const;

export const BOOKING_DRAFTS_BROADCAST_CHANNEL =
  'worksphere:booking-drafts-channel';

function notifyDraftStoreChange(
  action: 'save' | 'delete' | 'clear' | 'sync',
  draftId?: string
): void {
  if (typeof window !== 'undefined') {
    try {
      const eventName =
        action === 'sync'
          ? BOOKING_DRAFT_EVENTS.SYNCED
          : BOOKING_DRAFT_EVENTS.CHANGED;
      window.dispatchEvent(
        new CustomEvent(eventName, {
          detail: { action, draftId },
        })
      );
    } catch {
      // Ignore in non-DOM contexts
    }
  }

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(BOOKING_DRAFTS_BROADCAST_CHANNEL);
      channel.postMessage({ action, draftId, timestamp: Date.now() });
      channel.close();
    } catch {
      // Ignore broadcast errors
    }
  }
}

function isDraftPending(draft: BookingDraft): boolean {
  if (draft.synced) {
    return false;
  }
  const payloadStatus =
    typeof draft.payload?.status === 'string'
      ? draft.payload.status
      : undefined;
  if (
    payloadStatus === 'CONFIRMED' ||
    payloadStatus === 'CANCELLED' ||
    payloadStatus === 'CANCELLED_BY_OPERATOR'
  ) {
    return false;
  }
  return true;
}

export class DraftStore {
  private readonly dbName: string;
  private db: IDBDatabase | null = null;
  private memoryFallback: Map<string, BookingDraft> = new Map();
  private readonly listeners = new Set<DraftListener>();

  constructor(dbName = DB_NAME) {
    this.dbName = dbName || DB_NAME;
  }

  public async init(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      return;
    }

    if (this.db && isConnectionValid(this.db)) {
      return;
    }

    if (this.dbName === DB_NAME) {
      this.db = await openDatabaseWithMigration(DB_NAME, {
        context: 'page',
        targetVersion: DB_VERSION,
        onVersionChange: () => {
          this.db = null;
        },
      });
      return;
    }

    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const database = req.result;
        database.onversionchange = () => {
          database.close();
          if (this.db === database) {
            this.db = null;
          }
        };
        resolve(database);
      };
      req.onerror = () => reject(req.error);
    });
  }

  private async ensureDb(): Promise<IDBDatabase> {
    if (!this.db || !isConnectionValid(this.db)) {
      this.db = null;
      await this.init();
    }
    assertConnectionUsable(this.dbName, this.db);
    return this.db;
  }

  private async notifySubscribers(): Promise<void> {
    if (this.listeners.size === 0) return;
    const count = await this.getPendingDraftCount();
    for (const listener of this.listeners) {
      try {
        listener(count);
      } catch {
        // Ignore subscriber callback errors
      }
    }
  }

  public subscribe(listener: DraftListener): () => void {
    this.listeners.add(listener);
    void this.getPendingDraftCount().then((count) => {
      if (this.listeners.has(listener)) {
        listener(count);
      }
    });
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async hydrateDraft(
    draft?: BookingDraft
  ): Promise<BookingDraft | undefined> {
    if (!draft) return undefined;
    if (!draft.isEncrypted || !draft.encryptedPayload) {
      return {
        ...draft,
        payload: draft.payload ?? {},
      };
    }

    try {
      const decrypted = await decryptPayload<Record<string, unknown>>(
        draft.encryptedPayload
      );
      return {
        ...draft,
        payload: decrypted,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[DraftStore] Failed to decrypt draft ${draft.id}:`, err);
      return {
        ...draft,
        payload: { __corrupted: true, error: message },
      };
    }
  }

  public async saveDraft(input: BookingDraftInput): Promise<BookingDraft> {
    const now = Date.now();
    const draft: BookingDraft = {
      ...input,
      userId: input.userId ?? 'anonymous',
      payload: input.payload ?? {},
      timestamp: input.timestamp ?? now,
      synced: input.synced ?? false,
      updatedAtMs: input.updatedAtMs ?? now,
    };

    // Ensure vector clock is initialized for offline causal tracking
    if (!draft.vectorClock) {
      const clientNode = draft.nodeId || draft.userId || 'client';
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
        console.warn(
          '[DraftStore] Encryption failed, persisting unencrypted fallback:',
          err
        );
      }
    }

    if (typeof indexedDB === 'undefined') {
      this.memoryFallback.set(draft.id, storedDraft);
      notifyDraftStoreChange(draft.synced ? 'sync' : 'save', draft.id);
      await this.notifySubscribers();
      return draft;
    }

    const db = await this.ensureDb();

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(storedDraft);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    notifyDraftStoreChange(draft.synced ? 'sync' : 'save', draft.id);
    await this.notifySubscribers();
    return draft;
  }

  public async markSynced(id: string): Promise<void> {
    const target = await this.getDraft(id);
    if (target) {
      await this.saveDraft({ ...target, synced: true, updatedAtMs: Date.now() });
    }
  }

  /**
   * Internal/test helper: retrieves raw unhydrated draft from persistent storage.
   */
  public async getRawDraft(id: string): Promise<BookingDraft | undefined> {
    if (typeof indexedDB === 'undefined') {
      return this.memoryFallback.get(id);
    }

    const db = await this.ensureDb();

    return new Promise<BookingDraft | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  public async getDraft(id: string): Promise<BookingDraft | undefined> {
    let rawDraft: BookingDraft | undefined;
    if (typeof indexedDB === 'undefined') {
      rawDraft = this.memoryFallback.get(id);
      return this.hydrateDraft(rawDraft);
    }

    const db = await this.ensureDb();

    rawDraft = await new Promise<BookingDraft | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.hydrateDraft(rawDraft);
  }

  public async getAllDrafts(): Promise<BookingDraft[]> {
    let rawDrafts: BookingDraft[] = [];
    if (typeof indexedDB === 'undefined') {
      rawDrafts = Array.from(this.memoryFallback.values());
    } else {
      const db = await this.ensureDb();

      rawDrafts = await new Promise<BookingDraft[]>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
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
    if (typeof indexedDB === 'undefined') {
      this.memoryFallback.delete(id);
      notifyDraftStoreChange('delete', id);
      await this.notifySubscribers();
      return;
    }

    const db = await this.ensureDb();

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    notifyDraftStoreChange('delete', id);
    await this.notifySubscribers();
  }

  public async clearAll(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      this.memoryFallback.clear();
      notifyDraftStoreChange('clear');
      await this.notifySubscribers();
      return;
    }

    const db = await this.ensureDb();

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    notifyDraftStoreChange('clear');
    await this.notifySubscribers();
  }

  public async getPendingDrafts(): Promise<BookingDraft[]> {
    try {
      const drafts = await this.getAllDrafts();
      return drafts.filter(isDraftPending);
    } catch (error) {
      console.error('[DraftStore] Failed to query pending drafts:', error);
      return [];
    }
  }

  /**
   * Returns the count of pending, unsynchronized booking drafts.
   * Drafts with status CONFIRMED or CANCELLED, synced drafts, or deleted drafts, are excluded.
   */
  public async getPendingDraftCount(): Promise<number> {
    try {
      const pendingDrafts = await this.getPendingDrafts();
      return pendingDrafts.length;
    } catch (error) {
      console.error('[DraftStore] Failed to query pending draft count:', error);
      return 0;
    }
  }

  public async getPendingCount(): Promise<number> {
    return this.getPendingDraftCount();
  }

  /**
   * Updates an existing draft's payload and advances its vector clock for the local node.
   */
  public async updateDraftPayload(
    id: string,
    partialPayload: Record<string, unknown>,
    nodeId?: string
  ): Promise<BookingDraft> {
    const existing = await this.getDraft(id);
    if (!existing) {
      throw new Error(`Draft with ID ${id} not found`);
    }

    const clientNode = nodeId || existing.nodeId || existing.userId || 'client';
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
    draftData: Omit<BookingDraft, 'timestamp' | 'vectorClock'> & {
      timestamp?: number;
      vectorClock?: VectorClock;
      nodeId?: string;
    }
  ): Promise<BookingDraft> {
    const clientNode = draftData.nodeId || draftData.userId || 'client';
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

export const defaultDraftStore = new DraftStore();
