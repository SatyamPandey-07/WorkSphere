/**
 * timebankSyncWorker.ts
 * Web Worker that periodically reconciles the local ledger with the global mesh 
 * and flags stale or disputed IOUs.
 */

export interface LedgerEntry {
    id: string;
    agreementId: string;
    providerId: string;
    receiverId: string;
    amountMinutes: number;
    timestamp: number;
    signature: string;
    isSynced: boolean;
    isDisputed: boolean;
}

export interface SyncMessage {
    type: 'start-sync' | 'stop-sync' | 'add-local-entry' | 'sync-now';
    payload?: any;
}

export interface SyncEvent {
    type: 'sync-complete' | 'dispute-detected' | 'error' | 'status';
    payload?: any;
}

class TimebankSyncManager {
    private localLedger: Map<string, LedgerEntry> = new Map();
    private syncIntervalId: number | null = null;
    private syncIntervalMs: number = 60000; // 1 minute

    public startSync() {
        if (this.syncIntervalId) return;

        this.syncIntervalId = setInterval(() => {
            this.performSync();
        }, this.syncIntervalMs) as unknown as number;

        this.postEvent({ type: 'status', payload: { message: 'Sync started' } });
    }

    public stopSync() {
        if (this.syncIntervalId) {
            clearInterval(this.syncIntervalId);
            this.syncIntervalId = null;
            this.postEvent({ type: 'status', payload: { message: 'Sync stopped' } });
        }
    }

    public addLocalEntry(entry: LedgerEntry) {
        this.localLedger.set(entry.id, entry);
        // Trigger immediate sync for new entries
        this.performSync();
    }

    private async performSync() {
        try {
            // In a real implementation, this would fetch the global ledger from the mesh/API
            // and compare it with the local ledger.

            const unsyncedEntries = Array.from(this.localLedger.values()).filter(e => !e.isSynced);

            if (unsyncedEntries.length === 0) {
                this.postEvent({ type: 'sync-complete', payload: { syncedCount: 0 } });
                return;
            }

            // Mock API call to sync entries
            console.log(`[Sync Worker] Syncing ${unsyncedEntries.length} entries...`);

            // Simulate network delay
            await new Promise(resolve => setTimeout(resolve, 500));

            // Mark as synced
            for (const entry of unsyncedEntries) {
                entry.isSynced = true;

                // Mock dispute detection: if entry is older than 24h and not synced, flag as disputed
                const age = Date.now() - entry.timestamp;
                if (age > 24 * 60 * 60 * 1000 && !entry.isSynced) {
                    entry.isDisputed = true;
                    this.postEvent({
                        type: 'dispute-detected',
                        payload: { entryId: entry.id, agreementId: entry.agreementId },
                    });
                }
            }

            this.postEvent({
                type: 'sync-complete',
                payload: { syncedCount: unsyncedEntries.length },
            });
        } catch (err: any) {
            this.postEvent({
                type: 'error',
                payload: { message: err.message || 'Sync failed' },
            });
        }
    }

    private postEvent(event: SyncEvent) {
        self.postMessage(event);
    }
}

const manager = new TimebankSyncManager();

self.onmessage = (event: MessageEvent<SyncMessage>) => {
    const { type, payload } = event.data;

    if (type === 'start-sync') {
        manager.startSync();
    } else if (type === 'stop-sync') {
        manager.stopSync();
    } else if (type === 'add-local-entry') {
        manager.addLocalEntry(payload as LedgerEntry);
    } else if (type === 'sync-now') {
        manager.performSync();
    }
};

self.postMessage({ type: 'worker-ready' });
