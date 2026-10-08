/**
 * SyncQueue.ts
 * Manages the sequential execution and retry logic for offline network requests.
 * Listens for online events and processes the IndexedDB draft queue.
 */

import { DraftStore, BookingDraft } from './DraftStore';
import { ConflictResolver, ServerState } from './ConflictResolver';

export class SyncQueue {
    private draftStore: DraftStore;
    private conflictResolver: ConflictResolver;
    private isSyncing: boolean = false;

    constructor() {
        this.draftStore = new DraftStore();
        this.conflictResolver = new ConflictResolver();
        this.setupNetworkListeners();
    }

    private setupNetworkListeners(): void {
        if (typeof window !== 'undefined') {
            window.addEventListener('online', () => this.processQueue());
        }
    }

    public async queueDraft(draft: BookingDraft): Promise<void> {
        await this.draftStore.init();
        await this.draftStore.saveDraft(draft);

        if (navigator.onLine) {
            this.processQueue().catch(console.error);
        }
    }

    public async processQueue(): Promise<void> {
        if (this.isSyncing || !navigator.onLine) return;
        this.isSyncing = true;

        try {
            await this.draftStore.init();
            const drafts = await this.draftStore.getAllDrafts();

            for (const draft of drafts) {
                const success = await this.syncSingleDraft(draft);
                if (success) {
                    await this.draftStore.deleteDraft(draft.id);
                }
            }
        } catch (error) {
            console.error('Error processing sync queue:', error);
        } finally {
            this.isSyncing = false;
        }
    }

    private async syncSingleDraft(draft: BookingDraft): Promise<boolean> {
        try {
            // 1. Fetch current server state
            const serverResponse = await fetch(`/api/bookings/${draft.id}`);
            if (!serverResponse.ok) {
                // If it's a 404, the booking doesn't exist on server, so we can create it
                if (serverResponse.status === 404) {
                    return await this.createBooking(draft);
                }
                throw new Error(`Failed to fetch server state: ${serverResponse.status}`);
            }

            const serverState: ServerState = await serverResponse.json();

            // 2. Resolve conflicts
            const mergeResult = this.conflictResolver.resolve(draft, serverState);

            if (mergeResult.requiresUserInput) {
                // Dispatch custom event to notify UI
                window.dispatchEvent(new CustomEvent('booking_sync_conflict', { detail: mergeResult }));
                return false; // Do not delete draft, wait for user resolution
            }

            // 3. Apply merged state to server
            const updateResponse = await fetch(`/api/bookings/${draft.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    payload: mergeResult.resolvedPayload,
                    version: serverState.version + 1
                })
            });

            return updateResponse.ok;
        } catch (error) {
            console.error(`Failed to sync draft ${draft.id}:`, error);
            return false;
        }
    }

    private async createBooking(draft: BookingDraft): Promise<boolean> {
        try {
            const response = await fetch('/api/bookings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(draft.payload)
            });
            return response.ok;
        } catch (error) {
            console.error(`Failed to create booking from draft ${draft.id}:`, error);
            return false;
        }
    }
}

export const globalSyncQueue = new SyncQueue();
