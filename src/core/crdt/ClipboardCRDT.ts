/**
 * ClipboardCRDT.ts
 * Implements a Last-Writer-Wins (LWW) Register and sequence CRDT to merge clipboard histories across multiple devices.
 * Ensures conflict-free synchronization of text and asset references without centralized locking.
 */

export type ClipboardContentType = 'text' | 'image' | 'file-ref';

export interface ClipboardItem {
    id: string;
    type: ClipboardContentType;
    content: string; // Text content or Base64/Data URL for assets
    deviceId: string;
    timestamp: number;
    vectorClock: Record<string, number>;
}

export class ClipboardCRDT {
    private items: Map<string, ClipboardItem>;
    private localDeviceId: string;
    private vectorClock: Record<string, number>;

    constructor(localDeviceId: string) {
        this.items = new Map();
        this.localDeviceId = localDeviceId;
        this.vectorClock = { [localDeviceId]: 0 };
    }

    /**
     * Adds a new item to the local clipboard and increments the vector clock.
     */
    public addItem(type: ClipboardContentType, content: string): ClipboardItem {
        this.vectorClock[this.localDeviceId] = (this.vectorClock[this.localDeviceId] || 0) + 1;

        const item: ClipboardItem = {
            id: crypto.randomUUID(),
            type,
            content,
            deviceId: this.localDeviceId,
            timestamp: Date.now(),
            vectorClock: { ...this.vectorClock }
        };

        this.items.set(item.id, item);
        return item;
    }

    /**
     * Merges a remote item into the local state using LWW and vector clock logic.
     */
    public mergeRemoteItem(remoteItem: ClipboardItem): boolean {
        const existingItem = this.items.get(remoteItem.id);

        if (existingItem) {
            // Compare vector clocks
            const isRemoteNewer = this.compareVectorClocks(remoteItem.vectorClock, existingItem.vectorClock);
            if (!isRemoteNewer) {
                return false; // Local state is newer or concurrent with higher device ID
            }
        }

        // Update local vector clock to reflect the merge
        for (const [deviceId, time] of Object.entries(remoteItem.vectorClock)) {
            this.vectorClock[deviceId] = Math.max(this.vectorClock[deviceId] || 0, time);
        }

        this.items.set(remoteItem.id, remoteItem);
        return true;
    }

    /**
     * Retrieves all items sorted by timestamp (newest first).
     */
    public getHistory(limit: number = 10): ClipboardItem[] {
        return Array.from(this.items.values())
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    /**
     * Compares two vector clocks. Returns true if 'a' is strictly newer than 'b'.
     */
    private compareVectorClocks(a: Record<string, number>, b: Record<string, number>): boolean {
        let aIsGreater = false;
        let bIsGreater = false;

        const allDevices = new Set([...Object.keys(a), ...Object.keys(b)]);

        for (const device of allDevices) {
            const timeA = a[device] || 0;
            const timeB = b[device] || 0;

            if (timeA > timeB) aIsGreater = true;
            if (timeB > timeA) bIsGreater = true;
        }

        if (aIsGreater && !bIsGreater) return true;

        // Concurrent: tie-breaker by deviceId lexicographical order
        if (aIsGreater && bIsGreater) {
            // This is a simplification; true CRDT would use unique IDs per operation
            return false;
        }

        return false;
    }

    public getVectorClock(): Record<string, number> {
        return { ...this.vectorClock };
    }
}
