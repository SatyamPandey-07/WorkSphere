/**
 * vpnMesh.room.ts
 * PartyKit room handler that facilitates the initial peer discovery and ICE candidate exchange for the VPN mesh.
 * Acts as a lightweight signaling server for WebRTC connections.
 */

import type * as Party from 'partykit/server';

type SignalingMessage =
    | { type: 'JOIN'; userId: string; teamId: string }
    | { type: 'OFFER'; targetUserId: string; offer: RTCSessionDescriptionInit; senderId: string }
    | { type: 'ANSWER'; targetUserId: string; answer: RTCSessionDescriptionInit; senderId: string }
    | { type: 'ICE_CANDIDATE'; targetUserId: string; candidate: RTCIceCandidateInit; senderId: string }
    | { type: 'PEER_LIST'; peers: string[] };

export default class VpnMeshRoom implements Party.Server {
    private connectedPeers: Map<string, { userId: string; teamId: string }> = new Map();

    constructor(readonly room: Party.Room) { }

    async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
        // Authentication would happen here via Clerk token in ctx.request
        const url = new URL(ctx.request.url);
        const userId = url.searchParams.get('userId') || conn.id;
        const teamId = url.searchParams.get('teamId') || 'default';

        this.connectedPeers.set(conn.id, { userId, teamId });
        this.broadcastPeerList();

        conn.send(JSON.stringify({
            type: 'PEER_LIST',
            peers: Array.from(this.connectedPeers.values()).map(p => p.userId)
        }));
    }

    async onDisconnect(conn: Party.Connection) {
        this.connectedPeers.delete(conn.id);
        this.broadcastPeerList();
    }

    async onMessage(message: string, sender: Party.Connection) {
        try {
            const parsed = JSON.parse(message) as SignalingMessage;

            if (parsed.type === 'JOIN') {
                this.connectedPeers.set(sender.id, { userId: parsed.userId, teamId: parsed.teamId });
                this.broadcastPeerList();
                return;
            }

            if (parsed.type === 'OFFER' || parsed.type === 'ANSWER' || parsed.type === 'ICE_CANDIDATE') {
                // Find target connection by userId (simplified for scaffold)
                let targetConn: Party.Connection | undefined;
                for (const [id, peer] of this.connectedPeers.entries()) {
                    if (peer.userId === parsed.targetUserId) {
                        targetConn = this.room.getConnection(id);
                        break;
                    }
                }

                if (targetConn) {
                    targetConn.send(JSON.stringify(parsed));
                } else {
                    console.warn(`Target peer ${parsed.targetUserId} not found in room`);
                }
            }
        } catch (error) {
            console.error('Error processing VPN mesh signaling message:', error);
        }
    }

    private broadcastPeerList(): void {
        const peerListMsg = JSON.stringify({
            type: 'PEER_LIST',
            peers: Array.from(this.connectedPeers.values()).map(p => p.userId)
        });

        for (const conn of this.room.getConnections()) {
            conn.send(peerListMsg);
        }
    }
}