/**
 * DTNBundleProtocol.ts
 * Implements the Bundle Protocol (RFC 9171) for encapsulating and fragmenting messages for low-bandwidth BLE transfer.
 * Handles bundle creation, fragmentation, and reassembly logic with priority bundle queuing.
 */

export enum BundlePriority {
    BULK = 0,
    NORMAL = 1,
    EXPEDITED = 2,
    CRITICAL = 3,
}

export interface BundleHeader {
    version: number;
    processingFlags: number;
    priority: BundlePriority | number;
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

export interface BundleExpirationEvent {
    bundleId: string;
    source: string;
    destination: string;
    sequenceNumber: number;
    creationTimestamp: number;
    lifetime: number;
    expiredAt: number;
}

export type BundleExpirationListener = (event: BundleExpirationEvent) => void;

export class DTNBundleProtocol {
    private sequenceCounter: number = 0;
    private maxFragmentSize: number;
    private bundleStore: Map<string, Bundle> = new Map();
    private expirationListeners: Set<BundleExpirationListener> = new Set();
    private sweepIntervalTimer: ReturnType<typeof setInterval> | null = null;

    constructor(maxFragmentSize: number = 244, autoSweepIntervalMs: number = 1000) { // BLE 5.0 max MTU roughly
        this.maxFragmentSize = maxFragmentSize;
        if (autoSweepIntervalMs > 0) {
            this.startSweepInterval(autoSweepIntervalMs);
        }
    }

    /**
     * Computes a canonical unique identifier for a bundle based on source, sequence number, and creationTimestamp.
     */
    public static getBundleId(bundle: Bundle): string {
        return `${bundle.header.source}:${bundle.header.sequenceNumber}:${bundle.header.creationTimestamp}:${bundle.header.fragmentOffset}`;
    }

    /**
     * Stores a bundle in memory for store-and-forward routing.
     * Automatically triggers an expiration purge upon storage insert.
     */
    public storeBundle(bundle: Bundle): void {
        this.purgeExpiredBundles();
        // Check if bundle is already expired before inserting
        if (Date.now() >= bundle.header.creationTimestamp + bundle.header.lifetime) {
            this.emitExpirationEvent(bundle);
            return;
        }
        const id = DTNBundleProtocol.getBundleId(bundle);
        this.bundleStore.set(id, bundle);
    }

    /**
     * Retrieves all non-expired stored bundles from memory.
     */
    public getStoredBundles(): Bundle[] {
        this.purgeExpiredBundles();
        return Array.from(this.bundleStore.values());
    }

    /**
     * Retrieves the count of stored bundles.
     */
    public getStoredBundleCount(): number {
        this.purgeExpiredBundles();
        return this.bundleStore.size;
    }

    /**
     * Removes a stored bundle by ID.
     */
    public removeStoredBundle(bundleId: string): boolean {
        return this.bundleStore.delete(bundleId);
    }

    /**
     * Clears all stored bundles.
     */
    public clearStoredBundles(): void {
        this.bundleStore.clear();
    }

    /**
     * Registers a listener callback for bundle expiration telemetry and tracking.
     */
    public onBundleExpired(listener: BundleExpirationListener): () => void {
        this.expirationListeners.add(listener);
        return () => this.expirationListeners.delete(listener);
    }

    /**
     * Emits a bundle expiration telemetry event to all registered listeners.
     */
    private emitExpirationEvent(bundle: Bundle): void {
        const id = DTNBundleProtocol.getBundleId(bundle);
        const event: BundleExpirationEvent = {
            bundleId: id,
            source: bundle.header.source,
            destination: bundle.header.destination,
            sequenceNumber: bundle.header.sequenceNumber,
            creationTimestamp: bundle.header.creationTimestamp,
            lifetime: bundle.header.lifetime,
            expiredAt: Date.now()
        };
        for (const listener of this.expirationListeners) {
            try {
                listener(event);
            } catch (err) {
                console.error('Error in bundle expiration listener:', err);
            }
        }
    }

    /**
     * Periodic TTL cleanup sweep that evicts bundles whose creationTimestamp + lifetime <= currentTime.
     * Invoked on bundle storage insert and interval tick.
     * Returns the array of purged expired bundles.
     */
    public purgeExpiredBundles(now: number = Date.now()): Bundle[] {
        const purged: Bundle[] = [];
        for (const [id, bundle] of this.bundleStore.entries()) {
            if (now >= bundle.header.creationTimestamp + bundle.header.lifetime) {
                this.bundleStore.delete(id);
                purged.push(bundle);
                this.emitExpirationEvent(bundle);
            }
        }
        return purged;
    }

    /**
     * Starts background interval timer for periodic bundle expiration sweeps.
     */
    public startSweepInterval(intervalMs: number = 1000): void {
        this.stopSweepInterval();
        this.sweepIntervalTimer = setInterval(() => {
            this.purgeExpiredBundles();
        }, intervalMs);
        if (typeof this.sweepIntervalTimer === 'object' && 'unref' in this.sweepIntervalTimer) {
            (this.sweepIntervalTimer as any).unref();
        }
    }

    /**
     * Stops background sweep interval timer.
     */
    public stopSweepInterval(): void {
        if (this.sweepIntervalTimer !== null) {
            clearInterval(this.sweepIntervalTimer);
            this.sweepIntervalTimer = null;
        }
    }

    public createBundle(
        source: string,
        destination: string,
        payload: Uint8Array,
        lifetimeMs: number = 3600000,
        priority: BundlePriority = BundlePriority.NORMAL
    ): Bundle[] {
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
                priority,
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

    /**
     * Compares two bundles for priority queuing:
     * 1. Higher urgency (priority) comes first (descending order).
     * 2. If priorities are equal, earlier creation timestamp comes first (FIFO).
     * 3. If timestamps are equal, lower sequence number comes first.
     */
    public static comparePriority(a: Bundle, b: Bundle): number {
        const priorityA = a.header.priority ?? BundlePriority.NORMAL;
        const priorityB = b.header.priority ?? BundlePriority.NORMAL;
        if (priorityB !== priorityA) {
            return priorityB - priorityA;
        }

        const timeA = a.header.creationTimestamp ?? 0;
        const timeB = b.header.creationTimestamp ?? 0;
        if (timeA !== timeB) {
            return timeA - timeB;
        }

        const seqA = a.header.sequenceNumber ?? 0;
        const seqB = b.header.sequenceNumber ?? 0;
        return seqA - seqB;
    }

    /**
     * Sorts a bundle queue in place by priority urgency, tie-breaking by FIFO creation order.
     */
    public static sortQueueByPriority(queue: Bundle[]): Bundle[] {
        return queue.sort(DTNBundleProtocol.comparePriority);
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

            if (header.priority === undefined) {
                header.priority = BundlePriority.NORMAL;
            }

            const payload = data.slice(2 + headerLength);

            return { header, payload };
        } catch (e) {
            console.error('Failed to deserialize bundle:', e);
            return null;
        }
    }
}
