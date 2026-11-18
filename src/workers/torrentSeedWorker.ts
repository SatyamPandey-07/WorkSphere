/**
 * Torrent Seed Worker
 * Handles the chunking, hashing, and local seeding of cached venue media assets.
 * Responds to peer requests for specific chunks.
 */

export interface ChunkRequest {
    peerId: string;
    chunkId: number;
}

export interface FileAsset {
    fileId: string;
    totalChunks: number;
    chunks: Map<number, ArrayBuffer>;
}

const assetStore = new Map<string, FileAsset>();

self.addEventListener('message', async (event: MessageEvent) => {
    const { action, payload } = event.data;

    switch (action) {
        case 'CACHE_FILE':
            await cacheFile(payload.fileId, payload.data, payload.chunkSize);
            break;
        case 'HANDLE_REQUEST':
            handleChunkRequest(payload as ChunkRequest);
            break;
        case 'CLEAR_CACHE':
            assetStore.clear();
            self.postMessage({ action: 'CACHE_CLEARED' });
            break;
    }
});

async function cacheFile(fileId: string, data: ArrayBuffer, chunkSize: number) {
    const totalChunks = Math.ceil(data.byteLength / chunkSize);
    const chunks = new Map<number, ArrayBuffer>();

    for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, data.byteLength);
        const chunkData = data.slice(start, end);

        // In a real implementation, we'd calculate a SHA-256 hash here
        // For now, we just store the buffer
        chunks.set(i, chunkData);
    }

    assetStore.set(fileId, { fileId, totalChunks, chunks });

    self.postMessage({
        action: 'FILE_CACHED',
        fileId,
        totalChunks
    });
}

function handleChunkRequest(req: ChunkRequest) {
    // Simplified: Assume we only have one file for this demo
    const asset = Array.from(assetStore.values())[0];

    if (!asset) {
        self.postMessage({ action: 'REQUEST_FAILED', peerId: req.peerId, reason: 'NO_ASSETS' });
        return;
    }

    const chunk = asset.chunks.get(req.chunkId);
    if (chunk) {
        self.postMessage({
            action: 'SEND_CHUNK',
            peerId: req.peerId,
            chunkId: req.chunkId,
            data: chunk
        });
    } else {
        self.postMessage({ action: 'REQUEST_FAILED', peerId: req.peerId, reason: 'CHUNK_MISSING' });
    }
}

export { };
