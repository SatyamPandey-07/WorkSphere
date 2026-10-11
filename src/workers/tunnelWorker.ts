/**
 * tunnelWorker.ts
 * Web Worker that intercepts, encrypts, and routes network payloads through the secure mesh off the main thread.
 * Prevents UI freezing during heavy cryptographic operations and packet routing.
 */

interface WorkerMessage {
    type: 'INIT' | 'ENCRYPT_PAYLOAD' | 'DECRYPT_PAYLOAD' | 'ROUTING_UPDATE';
    payload?: any;
}

class TunnelProcessor {
    private encryptionKey: CryptoKey | null = null;

    public async initialize(): Promise<void> {
        // Generate a symmetric key for payload encryption (AES-GCM)
        this.encryptionKey = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    }

    public async encryptPayload(data: ArrayBuffer): Promise<ArrayBuffer> {
        if (!this.encryptionKey) throw new Error('Encryption key not initialized');

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encryptedData = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            this.encryptionKey,
            data
        );

        // Prepend IV to the encrypted data
        const result = new Uint8Array(iv.length + encryptedData.byteLength);
        result.set(iv, 0);
        result.set(new Uint8Array(encryptedData), iv.length);

        return result.buffer;
    }

    public async decryptPayload(encryptedData: ArrayBuffer): Promise<ArrayBuffer> {
        if (!this.encryptionKey) throw new Error('Encryption key not initialized');

        const dataView = new Uint8Array(encryptedData);
        const iv = dataView.slice(0, 12);
        const ciphertext = dataView.slice(12);

        return await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            this.encryptionKey,
            ciphertext
        );
    }
}

const processor = new TunnelProcessor();

self.onmessage = async (event: MessageEvent) => {
    const msg = event.data as WorkerMessage;

    if (msg.type === 'INIT') {
        await processor.initialize();
        self.postMessage({ type: 'INIT_COMPLETE', success: true });
    }

    if (msg.type === 'ENCRYPT_PAYLOAD') {
        try {
            const encrypted = await processor.encryptPayload(msg.payload);
            self.postMessage({ type: 'ENCRYPTION_COMPLETE', payload: encrypted }, [encrypted]);
        } catch (error) {
            self.postMessage({ type: 'ERROR', error: String(error) });
        }
    }

    if (msg.type === 'DECRYPT_PAYLOAD') {
        try {
            const decrypted = await processor.decryptPayload(msg.payload);
            self.postMessage({ type: 'DECRYPTION_COMPLETE', payload: decrypted }, [decrypted]);
        } catch (error) {
            self.postMessage({ type: 'ERROR', error: String(error) });
        }
    }
};
