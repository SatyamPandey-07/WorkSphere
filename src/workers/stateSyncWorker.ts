/**
 * Web Worker that manages the background synchronization queue and 
 * replays offline mutations upon network restoration.
 */

import { ConflictResolutionStore, PendingMutation } from '../lib/indexeddb/ConflictResolutionStore';
import { LamportTimestampResolver } from '../core/sync/LamportTimestampResolver';
import { VectorClock } from '../core/sync/VectorClock';

let store: ConflictResolutionStore;
let isOnline = navigator.onLine;
let syncInProgress = false;
let localNodeId = 'device_' + Math.random().toString(36).substring(2, 9);
let vectorClock = new VectorClock(localNodeId);

self.onmessage = async (event: MessageEvent) => {
    const { type, payload } = event.data;

    switch (type) {
        case 'INIT':
            store = new ConflictResolutionStore();
            await store.init();
            localNodeId = payload.deviceId || localNodeId;
            vectorClock = new VectorClock(localNodeId, payload.initialClock || {});
            checkAndSync();
            break;

        case 'MUTATION':
            vectorClock.increment();
            const pending: PendingMutation = {
                id: crypto.randomUUID(),
                entityId: payload.entityId,
                data: payload.data,
                clock: vectorClock.getClock(),
                lamportTs: Date.now(), // Using local timestamp as Lamport proxy for simplicity
                nodeId: localNodeId,
                timestamp: Date.now(),
            };

            await store.addMutation(pending);
            self.postMessage({ type: 'LOCAL_STATE_UPDATED', payload: pending });

            if (isOnline) checkAndSync();
            break;

        case 'NETWORK_STATUS':
            isOnline = payload.isOnline;
            if (isOnline) checkAndSync();
            break;
    }
};

async function checkAndSync() {
    if (!isOnline || syncInProgress) return;

    syncInProgress = true;
    const pending = await store.getPendingMutations();

    if (pending.length === 0) {
        syncInProgress = false;
        return;
    }

    try {
        // In a real app, this would be a fetch to the API route
        // const response = await fetch('/api/sync/resolve', { method: 'POST', body: JSON.stringify({ mutations: pending }) });
        // const result = await response.json();

        // Simulated successful sync
        console.log(`[SyncWorker] Syncing ${pending.length} mutations...`);
        await store.clearMutations(pending.map(m => m.id));

        self.postMessage({
            type: 'SYNC_COMPLETE',
            payload: { syncedCount: pending.length, newClock: vectorClock.getClock() }
        });
    } catch (error) {
        console.error('[SyncWorker] Sync failed, will retry on next network event', error);
    } finally {
        syncInProgress = false;
    }
}

// Listen for native online/offline events
self.addEventListener('online', () => {
    isOnline = true;
    checkAndSync();
});

self.addEventListener('offline', () => {
    isOnline = false;
});
