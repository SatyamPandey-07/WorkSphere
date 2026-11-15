/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

interface LeaseRecord {
    id: string;
    userId: string;
    propertyId: string;
    startDate: number;
    endDate: number;
    state: string;
    lastSynced: number;
}

interface SyncMessage {
    type: 'INIT' | 'ADD_LEASE' | 'SYNC_NOW' | 'CHECK_DISPUTES';
    payload?: any;
}

let localLedger: Map<string, LeaseRecord> = new Map();
let syncInterval: number | null = null;
const SYNC_FREQUENCY = 60000; // 1 minute
const API_ENDPOINT = '/api/housing/swap';

function startPeriodicSync() {
    if (syncInterval) self.clearInterval(syncInterval);
    syncInterval = self.setInterval(async () => {
        await performSync();
    }, SYNC_FREQUENCY);
}

async function performSync() {
    try {
        const staleRecords = Array.from(localLedger.values()).filter(
            r => Date.now() - r.lastSynced > SYNC_FREQUENCY * 2
        );

        if (staleRecords.length === 0) {
            self.postMessage({ type: 'SYNC_IDLE' });
            return;
        }

        const response = await fetch(`${API_ENDPOINT}/batch-sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ records: staleRecords }),
        });

        if (!response.ok) throw new Error('Sync failed');

        const data = await response.json();

        for (const updated of data.updatedRecords) {
            localLedger.set(updated.id, { ...updated, lastSynced: Date.now() });
        }

        self.postMessage({
            type: 'SYNC_SUCCESS',
            payload: { syncedCount: staleRecords.length, updated: data.updatedRecords }
        });
    } catch (error) {
        self.postMessage({ type: 'SYNC_ERROR', payload: { error: String(error) } });
    }
}

async function checkForDisputes() {
    try {
        const activeLeases = Array.from(localLedger.values()).filter(
            r => r.state !== 'SETTLED' && r.state !== 'CANCELLED'
        );

        const response = await fetch(`${API_ENDPOINT}/disputes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leaseIds: activeLeases.map(l => l.id) }),
        });

        if (!response.ok) throw new Error('Dispute check failed');
        const data = await response.json();

        if (data.disputedIds && data.disputedIds.length > 0) {
            for (const id of data.disputedIds) {
                const record = localLedger.get(id);
                if (record) {
                    record.state = 'DISPUTED';
                    localLedger.set(id, record);
                }
            }
            self.postMessage({ type: 'DISPUTES_DETECTED', payload: { ids: data.disputedIds } });
        }
    } catch (error) {
        console.error('Dispute check error:', error);
    }
}

self.onmessage = (event: MessageEvent<SyncMessage>) => {
    const { type, payload } = event.data;

    switch (type) {
        case 'INIT':
            if (payload && payload.initialRecords) {
                for (const record of payload.initialRecords) {
                    localLedger.set(record.id, record);
                }
            }
            startPeriodicSync();
            self.postMessage({ type: 'INITIALIZED' });
            break;

        case 'ADD_LEASE':
            const newLease = payload as LeaseRecord;
            newLease.lastSynced = 0; // Force immediate sync
            localLedger.set(newLease.id, newLease);
            self.postMessage({ type: 'LEASE_ADDED', payload: { id: newLease.id } });
            break;

        case 'SYNC_NOW':
            performSync();
            break;

        case 'CHECK_DISPUTES':
            checkForDisputes();
            break;
    }
};

export {};
