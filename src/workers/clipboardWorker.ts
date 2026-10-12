/**
 * clipboardWorker.ts
 * Web Worker that intercepts system clipboard events, serializes assets (like images), and manages the sync queue.
 * Prevents main thread blocking during large image base64 encoding or file reading.
 */

interface WorkerMessage {
    type: 'PROCESS_CLIPBOARD' | 'READ_FILE';
    payload?: any;
}

self.onmessage = async (event: MessageEvent) => {
    const msg = event.data as WorkerMessage;

    if (msg.type === 'PROCESS_CLIPBOARD') {
        try {
            const { type, content } = msg.payload;

            if (type === 'image' && content instanceof Blob) {
                // Convert Blob to Base64 Data URL for CRDT transmission
                const base64 = await blobToBase64(content);
                self.postMessage({ type: 'CLIPBOARD_READY', payload: { type: 'image', content: base64 } });
            } else {
                self.postMessage({ type: 'CLIPBOARD_READY', payload: { type, content } });
            }
        } catch (error) {
            self.postMessage({ type: 'ERROR', error: String(error) });
        }
    }

    if (msg.type === 'READ_FILE') {
        try {
            const { file } = msg.payload;
            const text = await file.text();
            self.postMessage({ type: 'FILE_READY', payload: { fileName: file.name, content: text } });
        } catch (error) {
            self.postMessage({ type: 'ERROR', error: String(error) });
        }
    }
};

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
