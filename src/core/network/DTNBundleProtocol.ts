/**
 * DTNBundleProtocol.ts
 * Implements the Bundle Protocol (RFC 9171) for encapsulating and fragmenting messages for low-bandwidth BLE transfer.
 * Handles bundle creation, fragmentation, and reassembly logic.
 */

export interface BundleHeader {
    version: number;
    processingFlags: number;
    crcType: number;
    payloadLength: number;
    destination: string;
    source: string;
    reportTo: string;
    creationTimestamp: number;
    lifetime: number;
    sequenceNumber: number;
    fragmentOffset: number;
    totalPayloadLength: number;
}

export interface Bundle {
    header: BundleHeader;
    payload: Uint8Array;
}

export class DTNBundleProtocol {
    private sequenceCounter: number = 0;
    private maxFragmentSize: number;

    constructor(maxFragmentSize: number = 244) { // BLE 5.0 max MTU roughly
        this.maxFragmentSize = maxFragmentSize;
    }

    public createBundle(source: string, destination: string, payload: Uint8Array, lifetimeMs: number = 3600000): Bundle[] {
        const totalLength = payload.length;
        const numFragments = Math.ceil(totalLength / this.maxFragmentSize);
        const bundles: Bundle[] = [];

        for (let i = 0; i < numFragments; i++) {
            const offset = i * this.maxFragmentSize;
            const length = Math.min(this.maxFragmentSize, totalLength - offset);
            const fragmentPayload = payload.slice(offset, offset + length);

            const header: BundleHeader = {
                version: 7, // BPv7
                processingFlags: numFragments > 1 ? 0x01 : 0x00, // Fragment flag
                crcType: 0x01,
                payloadLength: length,
                destination,
                source,
                reportTo: source,
                creationTimestamp: Date.now(),
                lifetime: lifetimeMs,
                sequenceNumber: this.sequenceCounter++,
                fragmentOffset: offset,
                totalPayloadLength: totalLength
            };

            bundles.push({ header, payload: fragmentPayload });
        }

        return bundles;
    }

    public serializeBundle(bundle: Bundle): Uint8Array {
        // Simplified serialization for scaffold: JSON header + raw payload
        const headerStr = JSON.stringify(bundle.header);
        const headerBytes = new TextEncoder().encode(headerStr);

        // Format: [2 bytes header length][header bytes][payload bytes]
        const totalLength = 2 + headerBytes.length + bundle.payload.length;
        const serialized = new Uint8Array(totalLength);

        serialized[0] = (headerBytes.length >> 8) & 0xFF;
        serialized[1] = headerBytes.length & 0xFF;
        serialized.set(headerBytes, 2);
        serialized.set(bundle.payload, 2 + headerBytes.length);

        return serialized;
    }

    public deserializeBundle(data: Uint8Array): Bundle | null {
        if (data.length < 2) return null;

        const headerLength = (data[0] << 8) | data[1];
        if (data.length < 2 + headerLength) return null;

        try {
            const headerBytes = data.slice(2, 2 + headerLength);
            const headerStr = new TextDecoder().decode(headerBytes);
            const header = JSON.parse(headerStr) as BundleHeader;
            const payload = data.slice(2 + headerLength);

            return { header, payload };
        } catch (e) {
            console.error('Failed to deserialize bundle:', e);
            return null;
        }
    }
}
