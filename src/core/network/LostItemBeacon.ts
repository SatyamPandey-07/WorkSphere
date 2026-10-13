/**
 * LostItemBeacon.ts
 * Generates rotating, cryptographically signed BLE payloads that prove ownership 
 * without revealing the item's identity to scanners.
 */

export interface BeaconPayload {
    itemId: string;
    rotationKey: string;
    signature: string;
    timestamp: number;
    ttl: number; // Time to live in seconds
}

export class LostItemBeacon {
    private itemId: string;
    private ownerPublicKey: string;
    private currentRotationKey: string;
    private rotationIntervalMs: number;
    private lastRotation: number;
    private secretSeed: Uint8Array;

    constructor(itemId: string, ownerPublicKey: string, rotationIntervalMs: number = 60000) {
        this.itemId = itemId;
        this.ownerPublicKey = ownerPublicKey;
        this.rotationIntervalMs = rotationIntervalMs;
        this.lastRotation = Date.now();

        // Generate a random seed for key rotation
        this.secretSeed = new Uint8Array(32);
        crypto.getRandomValues(this.secretSeed);

        this.currentRotationKey = this.generateInitialKey();
    }

    private generateInitialKey(): string {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Rotates the beacon key based on the secret seed and time.
     * This ensures that even if a scanner records the beacon, they cannot track the item long-term.
     */
    public async rotateKey(): Promise<string> {
        const now = Date.now();
        if (now - this.lastRotation < this.rotationIntervalMs) {
            return this.currentRotationKey;
        }

        // Simple pseudo-random rotation using SubtleCrypto HMAC
        const keyData = new TextEncoder().encode(this.currentRotationKey + this.lastRotation);
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            this.secretSeed,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );

        const signature = await crypto.subtle.sign('HMAC', cryptoKey, keyData);
        const hashArray = Array.from(new Uint8Array(signature));
        const newKey = hashArray.slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');

        this.currentRotationKey = newKey;
        this.lastRotation = now;

        return this.currentRotationKey;
    }

    /**
     * Generates the binary payload to be broadcast via BLE.
     * Format: [1 byte version][16 bytes rotation key][4 bytes timestamp][4 bytes TTL][32 bytes signature]
     */
    public async generatePayload(): Promise<Uint8Array> {
        await this.rotateKey();

        const timestamp = Math.floor(Date.now() / 1000);
        const ttl = 86400; // 24 hours

        // Create a message to sign: itemId + rotationKey + timestamp
        const message = new TextEncoder().encode(`${this.itemId}:${this.currentRotationKey}:${timestamp}`);

        // In a real app, the owner's private key would sign this. 
        // Here we simulate a signature using a mock HMAC with the item ID as key.
        const mockKey = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(this.itemId),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        const sigBuffer = await crypto.subtle.sign('HMAC', mockKey, message);
        const signature = new Uint8Array(sigBuffer);

        // Pack into binary payload
        const payload = new Uint8Array(1 + 16 + 4 + 4 + 32);
        let offset = 0;

        // Version
        payload[offset++] = 0x01;

        // Rotation Key (16 bytes from hex string)
        const keyBytes = new Uint8Array(this.currentRotationKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
        payload.set(keyBytes, offset);
        offset += 16;

        // Timestamp (4 bytes, big-endian)
        const tsView = new DataView(payload.buffer, offset, 4);
        tsView.setUint32(0, timestamp, false);
        offset += 4;

        // TTL (4 bytes, big-endian)
        const ttlView = new DataView(payload.buffer, offset, 4);
        ttlView.setUint32(0, ttl, false);
        offset += 4;

        // Signature (32 bytes)
        payload.set(signature, offset);

        return payload;
    }

    public getItemId(): string {
        return this.itemId;
    }
}
