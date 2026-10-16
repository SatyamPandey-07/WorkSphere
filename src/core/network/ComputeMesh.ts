/**
 * computeMesh.room.ts
 * PartyKit room handler that facilitates local WebRTC signaling 
 * and broadcasts peer availability to the mesh.
 */

import type * as Party from "partykit/server";

export interface SignalMessage {
    type: 'offer' | 'answer' | 'ice-candidate' | 'peer-discovery' | 'capabilities';
    senderId: string;
    targetId?: string;
    payload: any;
}

export interface PeerRegistry {
    id: string;
    capabilities: any;
    lastSeen: number;
}

export default class ComputeMeshRoom implements Party.Server {
    private peers: Map<string, PeerRegistry> = new Map();
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor(readonly room: Party.Room) {
        this.cleanupInterval = setInterval(() => this.cleanupStalePeers(), 10000);
    }

    onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
        const peerId = conn.id;

        this.peers.set(peerId, {
            id: peerId,
            capabilities: null,
            lastSeen: Date.now()
        });

        // Broadcast new peer to existing mesh
        this.room.broadcast(JSON.stringify({
            type: 'peer-discovery',
            senderId: peerId,
            payload: { action: 'joined', peerId }
        }), [conn.id]);

        // Send existing peers to the new connection
        const existingPeers = Array.from(this.peers.values())
            .filter(p => p.id !== peerId)
            .map(p => p.id);

        conn.send(JSON.stringify({
            type: 'peer-discovery',
            senderId: 'server',
            payload: { action: 'sync', peers: existingPeers }
        }));
    }

    onMessage(message: string, sender: Party.Connection) {
        try {
            const data: SignalMessage = JSON.parse(message);
            const peer = this.peers.get(sender.id);

            if (peer) {
                peer.lastSeen = Date.now();
            }

            if (data.type === 'capabilities') {
                if (peer) {
                    peer.capabilities = data.payload;
                }
                this.room.broadcast(JSON.stringify({
                    type: 'capabilities',
                    senderId: sender.id,
                    payload: data.payload
                }), [sender.id]);
                return;
            }

            if (data.targetId) {
                // Direct signaling (Offer/Answer/ICE)
                const targetConn = this.room.getConnection(data.targetId);
                if (targetConn) {
                    targetConn.send(JSON.stringify(data));
                }
            } else {
                // Broadcast discovery
                this.room.broadcast(JSON.stringify(data), [sender.id]);
            }
        } catch (err) {
            console.error(`[ComputeMeshRoom] Failed to parse message from ${sender.id}:`, err);
        }
    }

    onClose(conn: Party.Connection) {
        this.peers.delete(conn.id);

        this.room.broadcast(JSON.stringify({
            type: 'peer-discovery',
            senderId: conn.id,
            payload: { action: 'left', peerId: conn.id }
        }), [conn.id]);
    }

    private cleanupStalePeers() {
        const now = Date.now();
        const staleThreshold = 30000; // 30 seconds

        for (const [peerId, peer] of this.peers.entries()) {
            if (now - peer.lastSeen > staleThreshold) {
                this.peers.delete(peerId);
                this.room.broadcast(JSON.stringify({
                    type: 'peer-discovery',
                    senderId: peerId,
                    payload: { action: 'timeout', peerId }
                }));
            }
        }
    }

    onDestroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
    }
}
