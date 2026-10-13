/**
 * Telemetry Sync Manager
 * Manages the IndexedDB queue, handling payload insertion, retrieval, and retry logic.
 */

const DB_NAME = 'WorkSphereTelemetryDB';
const STORE_NAME = 'syncQueue';
const DB_VERSION = 1;

export interface QueueItem {
    id: string;
    url: string;
    payload: ArrayBuffer;
    headers: Record<string, string>;
    attempts: number;
    createdAt: number;
}

export class TelemetrySyncManager {
    private db: IDBDatabase | null = null;

    public async init(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };

            request.onsuccess = (event) => {
                this.db = (event.target as IDBOpenDBRequest).result;
                resolve();
            };

            request.onerror = (event) => {
                reject((event.target as IDBOpenDBRequest).error);
            };
        });
    }

    public async enqueue(item: Omit<QueueItem, 'id' | 'attempts' | 'createdAt'>): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        const queueItem: QueueItem = {
            ...item,
            id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            attempts: 0,
            createdAt: Date.now()
        };

        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.add(queueItem);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    public async flushQueue(): Promise<{ success: number; failed: number }> {
        if (!this.db) throw new Error('Database not initialized');

        const items = await this.getAllItems();
        let successCount = 0;
        let failCount = 0;

        for (const item of items) {
            try {
                const response = await fetch(item.url, {
                    method: 'POST',
                    headers: item.headers,
                    body: item.payload
                });

                if (response.ok) {
                    await this.deleteItem(item.id);
                    successCount++;
                } else {
                    await this.incrementAttempts(item.id);
                    failCount++;
                }
            } catch (err) {
                await this.incrementAttempts(item.id);
                failCount++;
            }
        }

        return { success: successCount, failed: failCount };
    }

    private getAllItems(): Promise<QueueItem[]> {
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    private deleteItem(id: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    private incrementAttempts(id: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const getRequest = store.get(id);

            getRequest.onsuccess = () => {
                const item = getRequest.result as QueueItem;
                if (item) {
                    item.attempts++;
                    if (item.attempts > 5) {
                        // Drop items that fail too many times to prevent infinite loops
                        store.delete(id);
                    } else {
                        store.put(item);
                    }
                }
                resolve();
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }
}
