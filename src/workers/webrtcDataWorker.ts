/**
 * webrtcDataWorker.ts
 * Web Worker that handles the heavy lifting of file chunking, hashing, and reassembly off the main thread.
 * Prevents UI freezing during large file transfers over the local mesh network.
 */

import { ChunkedFileTransfer, FileChunk } from '@/core/network/ChunkedFileTransfer';

const chunkedTransfer = new ChunkedFileTransfer(16384); // 16KB chunks

// Callback to send chunks back to main thread for WebRTC transmission
let sendChunkToMain: ((chunk: FileChunk) => void) | null = null;
let sendAckToMain: ((fileId: string, chunkIndex: number) => void) | null = null;

self.onmessage = (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'INIT') {
        chunkedTransfer.onProgress((progress) => {
            self.postMessage({ type: 'TRANSFER_PROGRESS', payload: progress });
        });

        chunkedTransfer.onComplete((fileId, blob) => {
            self.postMessage({
                type: 'TRANSFER_COMPLETE',
                payload: { fileId, size: blob.size }
            });
            // Note: Actual Blob transfer to main thread requires transferable objects or ObjectURLs
        });
    }

    if (type === 'SEND_FILE') {
        const { file } = payload;

        // Define send function for this transfer
        sendChunkToMain = (chunk: FileChunk) => {
            self.postMessage({ type: 'SEND_CHUNK', payload: chunk }, [chunk.data]);
        };

        chunkedTransfer.sliceAndSend(file, sendChunkToMain)
            .then(() => {
                self.postMessage({ type: 'SEND_FILE_COMPLETE', payload: { fileId: file.name } });
            })
            .catch((error) => {
                self.postMessage({ type: 'ERROR', payload: String(error) });
            });
    }

    if (type === 'RECEIVE_CHUNK') {
        const chunk: FileChunk = payload;

        // Define ACK function
        sendAckToMain = (fileId: string, chunkIndex: number) => {
            self.postMessage({ type: 'SEND_ACK', payload: { fileId, chunkIndex } });
        };

        chunkedTransfer.processIncomingChunk(chunk, sendAckToMain);
    }
};
