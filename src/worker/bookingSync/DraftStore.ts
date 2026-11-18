/**
 * DraftStore.ts
 * Handles the serialization and retrieval of booking state drafts from IndexedDB.
 * Provides a robust, promise-based wrapper around IndexedDB for offline persistence.
 * Tracks Vector Clocks for CRDT causal tracking and offline conflict resolution.
 */

import { VectorClock } from '../../core/crdt/CrdtVectorClock';

const DB_NAME = 'WorkSphereBookingDB';
const DB_VERSION = 1;
const STORE_NAME = 'booking_drafts';

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
    fieldClocks?: Record<string, { timestamp: number; clock: VectorClock; lamport: number; nodeId: string }>;
}

export class DraftStore {
    private db: IDBDatabase | null = null;

    public async init(): Promise<void> {
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
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
        });
    }

    public async saveDraft(draft: BookingDraft): Promise<void> {
        if (!this.db) await this.init();

        // Ensure vector clock is initialized for offline causal tracking
        if (!draft.vectorClock) {
            const clientNode = draft.nodeId || draft.userId || 'client';
            draft.vectorClock = {
                [clientNode]: 1,
                server: draft.serverVersion || 0,
            };
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(draft);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    public async getDraft(id: string): Promise<BookingDraft | undefined> {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    public async getAllDrafts(): Promise<BookingDraft[]> {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    public async deleteDraft(id: string): Promise<void> {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    public async clearAll(): Promise<void> {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
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

