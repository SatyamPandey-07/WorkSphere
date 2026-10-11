/**
 * localMesh.room.ts
 * PartyKit room handler that acts as the signaling and synchronization server for local mesh peers.
 * Facilitates the initial WebRTC handshake before peer-to-peer data transfer begins, and
 * coordinates CRDT document reconciliation when peers reconnect after WAN dropouts (#5777).
 */

import type * as Party from 'partykit/server';

export type SignalingMessage =
    | { type: 'OFFER'; targetPeerId: string; offer: RTCSessionDescriptionInit; senderId: string }
    | { type: 'ANSWER'; targetPeerId: string; answer: RTCSessionDescriptionInit; senderId: string }
    | { type: 'ICE_CANDIDATE'; targetPeerId: string; candidate: RTCIceCandidateInit; senderId: string }
    | { type: 'PEER_LIST'; peers: string[] }
    | { type: 'SYNC_UPDATE'; update: string | number[]; senderId: string; timestamp?: number; id?: string }
    | { type: 'SYNC_REQUEST'; senderId: string; sinceTimestamp?: number }
    | { type: 'SYNC_RESPONSE'; updates: Array<{ id: string; update: string | number[]; senderId: string; timestamp: number }> }
    | { type: 'WAN_STATUS'; status: 'online' | 'degraded' | 'offline'; timestamp: number };

export interface LoggedCrdtUpdate {
    id: string;
    update: string | number[];
    senderId: string;
    timestamp: number;
}

export default class LocalMeshRoom implements Party.Server {
    private connectedPeers: Set<string>;
    private updateLog: LoggedCrdtUpdate[] = [];
    private readonly MAX_LOG_SIZE = 1000;

    constructor(readonly room: Party.Room) {
        this.connectedPeers = new Set();
    }

    async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
        this.connectedPeers.add(conn.id);

        // Broadcast updated peer list to everyone so peers can establish local WebRTC DataChannels
        this.broadcastPeerList();

        conn.send(JSON.stringify({
            type: 'PEER_LIST',
            peers: Array.from(this.connectedPeers)
        }));

        // Send recent sync updates to newly connected / reconnected peer
        if (this.updateLog.length > 0) {
            conn.send(JSON.stringify({
                type: 'SYNC_RESPONSE',
                updates: this.updateLog.slice(-50),
            }));
        }
    }

    async onDisconnect(conn: Party.Connection) {
        this.connectedPeers.delete(conn.id);
        this.broadcastPeerList();
    }

    async onMessage(message: string, sender: Party.Connection) {
        try {
            const parsed = JSON.parse(message) as SignalingMessage;

            // Route WebRTC signaling message to specific target peer
            if (parsed.type === 'OFFER' || parsed.type === 'ANSWER' || parsed.type === 'ICE_CANDIDATE') {
                const targetConn = this.room.getConnection(parsed.targetPeerId);
                if (targetConn) {
                    targetConn.send(JSON.stringify(parsed));
                } else {
                    console.warn(`Target peer ${parsed.targetPeerId} not found`);
                }
                return;
            }

            // CRDT / Yjs state reconciliation upon reconnection after WAN dropouts
            if (parsed.type === 'SYNC_UPDATE') {
                const entry: LoggedCrdtUpdate = {
                    id: parsed.id || `upd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    update: parsed.update,
                    senderId: sender.id,
                    timestamp: parsed.timestamp || Date.now(),
                };

                this.updateLog.push(entry);
                if (this.updateLog.length > this.MAX_LOG_SIZE) {
                    this.updateLog.shift();
                }

                // Rebroadcast CRDT state update to all other connected peers
                this.room.broadcast(JSON.stringify({
                    type: 'SYNC_UPDATE',
                    update: parsed.update,
                    senderId: sender.id,
                    timestamp: entry.timestamp,
                    id: entry.id,
                }), [sender.id]);
                return;
            }

            // Client requesting resync of missed operations
            if (parsed.type === 'SYNC_REQUEST') {
                const since = parsed.sinceTimestamp || 0;
                const missed = this.updateLog.filter((u) => u.timestamp > since);
                sender.send(JSON.stringify({
                    type: 'SYNC_RESPONSE',
                    updates: missed,
                }));
                return;
            }
        } catch (error) {
            console.error('Error processing signaling/sync message:', error);
        }
    }

    public getConnectedPeers(): string[] {
        return Array.from(this.connectedPeers);
    }

    public getUpdateLog(): LoggedCrdtUpdate[] {
        return [...this.updateLog];
    }

    public clearUpdateLog(): void {
        this.updateLog = [];
    }

    private broadcastPeerList(): void {
        const peerListMsg = JSON.stringify({
            type: 'PEER_LIST',
            peers: Array.from(this.connectedPeers)
        });

        for (const conn of this.room.getConnections()) {
            conn.send(peerListMsg);
        }
    }
}
