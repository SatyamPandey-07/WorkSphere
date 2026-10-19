/**
 * inventorySyncWorker.ts
 * Web Worker that ingests high-frequency POS webhooks and updates 
 * the depletion models without blocking the manager dashboard.
 */

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

interface POSSaleEvent {
    timestamp: number;
    items: { sku: string; quantity: number }[];
    venueId: string;
}

interface WorkerMessage {
    type: 'INGEST_POS' | 'UPDATE_STOCK' | 'REQUEST_FORECAST';
    payload: any;
}

// In-memory rolling window of sales (last 168 hours)
const salesHistory: Map<string, { hour: number; qty: number }[]> = new Map();
const currentStock: Map<string, number> = new Map();

self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;

    switch (type) {
        case 'INGEST_POS':
            ingestPOSSale(payload);
            break;
        case 'UPDATE_STOCK':
            updateStock(payload);
            break;
        case 'REQUEST_FORECAST':
            // The main thread handles the actual forecasting class, 
            // but we can aggregate the raw data here.
            sendAggregatedData();
            break;
    }
});

function ingestPOSSale(event: POSSaleEvent) {
    const hourBucket = Math.floor(event.timestamp / 3600000);

    for (const item of event.items) {
        if (!salesHistory.has(item.sku)) {
            salesHistory.set(item.sku, []);
        }

        const history = salesHistory.get(item.sku)!;
        const existing = history.find(h => h.hour === hourBucket);

        if (existing) {
            existing.qty += item.quantity;
        } else {
            history.push({ hour: hourBucket, qty: item.quantity });
        }

        // Keep only last 168 hours (7 days)
        if (history.length > 168) {
            history.sort((a, b) => a.hour - b.hour);
            history.shift();
        }

        // Decrement local stock tracker
        const stock = currentStock.get(item.sku) || 0;
        currentStock.set(item.sku, Math.max(0, stock - item.quantity));
    }
}

function updateStock(payload: { sku: string; newStock: number }) {
    currentStock.set(payload.sku, payload.newStock);
    self.postMessage({ type: 'STOCK_UPDATED', sku: payload.sku, stock: payload.newStock });
}

function sendAggregatedData() {
    const aggregated: any[] = [];

    for (const [sku, history] of salesHistory.entries()) {
        // Convert hourly buckets into a continuous 168-length array for Holt-Winters
        const usageArray = new Array(168).fill(0);
        const currentHour = Math.floor(Date.now() / 3600000);

        for (const record of history) {
            const ageHours = currentHour - record.hour;
            if (ageHours >= 0 && ageHours < 168) {
                usageArray[167 - ageHours] = record.qty;
            }
        }

        aggregated.push({
            sku,
            currentStock: currentStock.get(sku) || 0,
            historicalUsage: usageArray
        });
    }

    self.postMessage({
        type: 'AGGREGATED_DATA_READY',
        items: aggregated
    });
}

export {};
