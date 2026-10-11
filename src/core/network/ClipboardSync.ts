/**
 * ClipboardSync.ts
 * Manages the WebRTC connections and broadcasts clipboard deltas to devices on the same local network.
 * Falls back to PartyKit relay if direct P2P connection fails due to NAT restrictions.
 */

import { ClipboardCRDT, ClipboardItem } from '@/core/crdt/ClipboardCRDT';

export class ClipboardSync {
    private crdt: ClipboardCRDT;
    private peerConnections: Map<string, RTCPeerConnection>;
    private dataChannels: Map<string, RTCDataChannel>;
    private onNewItemCallback: ((item: ClipboardItem) => void) | null = null;

    constructor(localDeviceId: string) {
        this.crdt = new ClipboardCRDT(localDeviceId);
        this.peerConnections = new Map();
        this.dataChannels = new Map();
    }

    public async addLocalItem(type: 'text' | 'image' | 'file-ref', content: string): Promise<ClipboardItem> {
        const item = this.crdt.addItem(type, content);
        this.broadcastItem(item);
        return item;
    }

    public async handleRemoteItem(item: ClipboardItem): Promise<void> {
        const merged = this.crdt.mergeRemoteItem(item);
        if (merged && this.onNewItemCallback) {
            this.onNewItemCallback(item);
        }
    }

    private broadcastItem(item: ClipboardItem): void {
        const payload = JSON.stringify({ type: 'CLIPBOARD_ITEM', item });

        for (const [peerId, dc] of this.dataChannels.entries()) {
            if (dc.readyState === 'open') {
                dc.send(payload);
            }
        }

        // If no direct P2P connections, fallback to PartyKit signaling
        if (this.dataChannels.size === 0) {
            this.sendToPartyKit(payload);
        }
    }

    private sendToPartyKit(payload: string): void {
        // Mock PartyKit fetch call
        console.log('Fallback: Sending clipboard delta to PartyKit relay');
    }

    public onNewItem(callback: (item: ClipboardItem) => void): void {
        this.onNewItemCallback = callback;
    }

    public getHistory(limit: number = 10): ClipboardItem[] {
        return this.crdt.getHistory(limit);
    }
}
