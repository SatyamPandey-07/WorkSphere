/**
 * AnonymousMeshRelay.ts
 * Routes encrypted location pings through the WorkSphere network, ensuring the 
 * relaying user cannot decrypt the owner's identity.
 */

export interface RelayPacket {
    id: string;
    rotationKey: string;
    encryptedPayload: string; // Hex encoded
    hopCount: number;
    maxHops: number;
    timestamp: number;
    signature: string;
}

export class AnonymousMeshRelay {
    private relayedPackets: Map<string, RelayPacket> = new Map();
    private maxHops: number = 5;

    /**
     * Processes an incoming BLE beacon and prepares it for relay.
     * The scanner encrypts the location data using the beacon's rotation key, 
     * so only the owner (who knows the seed) can decrypt it.
     */
    public async processBeacon(
        rotationKey: string,
        scannerLocation: { lat: number; lng: number; accuracy: number },
        scannerTimestamp: number
    ): Promise<RelayPacket | null> {

        // Check if we've already relayed this specific rotation key recently (prevent spam)
        if (this.relayedPackets.has(rotationKey)) {
            const existing = this.relayedPackets.get(rotationKey)!;
            if (scannerTimestamp - existing.timestamp < 300000) { // 5 min cooldown
                return null;
            }
        }

        // Encrypt location data using the rotation key as the symmetric key
        const locationStr = JSON.stringify(scannerLocation);
        const encryptedPayload = await this.encryptLocation(locationStr, rotationKey);

        const packet: RelayPacket = {
            id: this.generatePacketId(),
            rotationKey,
            encryptedPayload,
            hopCount: 1,
            maxHops: this.maxHops,
            timestamp: scannerTimestamp,
            signature: '', // In reality, the scanner would sign the packet to prove it's a valid node
        };

        this.relayedPackets.set(rotationKey, packet);
        return packet;
    }

    private async encryptLocation(plaintext: string, hexKey: string): Promise<string> {
        // Convert hex key to ArrayBuffer
        const keyBytes = new Uint8Array(hexKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));

        // Import key for AES-GCM
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            keyBytes,
            { name: 'AES-GCM' },
            false,
            ['encrypt']
        );

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(plaintext);

        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            cryptoKey,
            encoded
        );

        // Combine IV and ciphertext and encode as hex
        const combined = new Uint8Array(iv.length + ciphertext.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(ciphertext), iv.length);

        return Array.from(combined).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    public async decryptLocation(encryptedHex: string, hexKey: string): Promise<any | null> {
        try {
            const combined = new Uint8Array(encryptedHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
            const iv = combined.slice(0, 12);
            const ciphertext = combined.slice(12);

            const keyBytes = new Uint8Array(hexKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
            const cryptoKey = await crypto.subtle.importKey(
                'raw',
                keyBytes,
                { name: 'AES-GCM' },
                false,
                ['decrypt']
            );

            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                cryptoKey,
                ciphertext
            );

            const plaintext = new TextDecoder().decode(decrypted);
            return JSON.parse(plaintext);
        } catch (err) {
            console.error('[Relay] Failed to decrypt location:', err);
            return null;
        }
    }

    private generatePacketId(): string {
        return `pkt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    public incrementHop(packet: RelayPacket): RelayPacket | null {
        if (packet.hopCount >= packet.maxHops) {
            return null; // Drop packet, max hops reached
        }
        return {
            ...packet,
            hopCount: packet.hopCount + 1,
        };
    }

    public getRelayedCount(): number {
        return this.relayedPackets.size;
    }
}
