/**
 * localMesh.room.ts
 * PartyKit room handler that acts as the signaling server to exchange SDP offers and ICE candidates between local peers.
 * Facilitates the initial WebRTC handshake before peer-to-peer data transfer begins.
 */

import type * as Party from 'partykit/server';

export type SignalingMessage =
    | { type: 'OFFER'; targetPeerId: string; offer: RTCSessionDescriptionInit; senderId: string }
    | { type: 'ANSWER'; targetPeerId: string; answer: RTCSessionDescriptionInit; senderId: string }
    | { type: 'ICE_CANDIDATE'; targetPeerId: string; candidate: RTCIceCandidateInit; senderId: string }
    | { type: 'PEER_LIST'; peers: string[] };

export default class LocalMeshRoom implements Party.Server {
    private connectedPeers: Set<string>;

    constructor(readonly room: Party.Room) {
        this.connectedPeers = new Set();
    }

    async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
        this.connectedPeers.add(conn.id);

        // Broadcast updated peer list to everyone
        this.broadcastPeerList();

        conn.send(JSON.stringify({
            type: 'PEER_LIST',
            peers: Array.from(this.connectedPeers)
        }));
    }

    async onDisconnect(conn: Party.Connection) {
        this.connectedPeers.delete(conn.id);
        this.broadcastPeerList();
    }

    async onMessage(message: string, sender: Party.Connection) {
        try {
            const parsed = JSON.parse(message) as SignalingMessage;

            // Route signaling message to specific target peer
            if (parsed.type === 'OFFER' || parsed.type === 'ANSWER' || parsed.type === 'ICE_CANDIDATE') {
                const targetConn = this.room.getConnection(parsed.targetPeerId);
                if (targetConn) {
                    targetConn.send(JSON.stringify(parsed));
                } else {
                    console.warn(`Target peer ${parsed.targetPeerId} not found`);
                }
            }
        } catch (error) {
            console.error('Error processing signaling message:', error);
        }
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
