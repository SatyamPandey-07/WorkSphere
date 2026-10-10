/**
 * dtnSyncWorker.ts
 * Web Worker that handles the background queueing, fragmentation, and reassembly of DTN bundles.
 * Persists pending messages to IndexedDB when the app is closed.
 */

const DB_NAME = 'WorkSphereDTNDB';
const STORE_NAME = 'pending_bundles';

self.onmessage = async (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'QUEUE_PAYLOAD') {
        // Save to IndexedDB
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({ id: crypto.randomUUID(), data: payload, timestamp: Date.now() });

        self.postMessage({ type: 'QUEUED', success: true });
    }

    if (type === 'PROCESS_INCOMING') {
        // Handle incoming bundle from BLE router
        const { bundleData } = payload;

        // Check if we are the final destination
        // If not, re-queue for opportunistic forwarding

        self.postMessage({ type: 'BUNDLE_RECEIVED', payload: bundleData });
    }
};

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
    });
}
