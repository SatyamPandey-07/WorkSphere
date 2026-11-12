/**
 * transactionWorker.ts
 * Web Worker that handles the heavy cryptographic verification of 
 * payment webhooks and updates the local expense ledger.
 */

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

interface WorkerMessage {
    type: 'VERIFY_WEBHOOK' | 'HASH_RECEIPT' | 'SYNC_LEDGER';
    payload: any;
}

// Mock Ledger State
const localLedger: any[] = [];

self.addEventListener('message', async (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;

    try {
        switch (type) {
            case 'VERIFY_WEBHOOK':
                await verifyWebhookSignature(payload);
                break;
            case 'HASH_RECEIPT':
                await hashReceiptImage(payload);
                break;
            case 'SYNC_LEDGER':
                syncLedger(payload);
                break;
        }
    } catch (error: any) {
        self.postMessage({ type: 'ERROR', error: error.message });
    }
});

async function verifyWebhookSignature(payload: { body: string; signature: string; secret: string }) {
    // In production, use SubtleCrypto to verify HMAC-SHA256 of the webhook body
    const encoder = new TextEncoder();
    const data = encoder.encode(payload.body);

    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(payload.secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', key, data);
    const computedSignature = Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    const isValid = computedSignature === payload.signature;

    self.postMessage({
        type: 'WEBHOOK_VERIFIED',
        isValid,
        computedSignature
    });
}

async function hashReceiptImage(payload: { imageData: ArrayBuffer; receiptId: string }) {
    // Hash the raw image data to create an immutable receipt fingerprint
    const hashBuffer = await crypto.subtle.digest('SHA-256', payload.imageData);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    self.postMessage({
        type: 'RECEIPT_HASHED',
        receiptId: payload.receiptId,
        hash: hashHex
    });
}

function syncLedger(payload: { entries: any[] }) {
    // Append to local ledger and calculate Merkle root for the batch
    for (const entry of payload.entries) {
        localLedger.push(entry);
    }

    // Simple Merkle root calculation for the batch
    const root = calculateMerkleRoot(payload.entries.map(e => JSON.stringify(e)));

    self.postMessage({
        type: 'LEDGER_SYNCED',
        totalEntries: localLedger.length,
        batchRoot: root
    });
}

function calculateMerkleRoot(leaves: string[]): string {
    if (leaves.length === 0) return '';
    if (leaves.length === 1) return leaves[0];

    // Synchronous mock hash for worker context (real impl uses SubtleCrypto async)
    const hash = (str: string) => {
        let h = 0;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) - h) + str.charCodeAt(i);
            h |= 0;
        }
        return h.toString(16);
    };

    let currentLevel = leaves.map(l => hash(l));

    while (currentLevel.length > 1) {
        const nextLevel = [];
        for (let i = 0; i < currentLevel.length; i += 2) {
            const left = currentLevel[i];
            const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
            nextLevel.push(hash(left + right));
        }
        currentLevel = nextLevel;
    }

    return currentLevel[0];
}
export {};
