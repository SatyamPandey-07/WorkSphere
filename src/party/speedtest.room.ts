/**
 * speedtest.room.ts
 * PartyKit room configuration that handles WebRTC signaling (SDP offer/answer and ICE candidates) between peers in the same venue.
 * Facilitates direct browser-to-browser connections for localized network testing.
 */

import type * as Party from 'partykit/server';

export interface SignalingMessage {
    type: 'offer' | 'answer' | 'ice-candidate';
    senderId: string;
    targetId: string;
    payload: any;
}

type IncomingRoomMessage = SignalingMessage | { type: 'heartbeat' };

export default class SpeedtestRoom implements Party.Server {
    private static readonly HEARTBEAT_SWEEP_INTERVAL_MS = 5000;
    private static readonly PEER_TIMEOUT_MS = 15000;

    private connections: Map<string, Party.Connection>;
    private lastHeartbeats: Map<string, number>;
    private heartbeatInterval: ReturnType<typeof setInterval>;

    constructor(readonly room: Party.Room) {
        this.connections = new Map();
        this.lastHeartbeats = new Map();
        this.heartbeatInterval = setInterval(() => {
            this.evictUnresponsivePeers();
        }, SpeedtestRoom.HEARTBEAT_SWEEP_INTERVAL_MS);
    }

    async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
        this.connections.set(conn.id, conn);
        this.lastHeartbeats.set(conn.id, Date.now());

        this.room.broadcast(JSON.stringify({
            type: 'peer-joined',
            peerId: conn.id
        }), [conn.id]);

        const peerList = Array.from(this.connections.keys()).filter(id => id !== conn.id);
        conn.send(JSON.stringify({
            type: 'peer-list',
            peers: peerList
        }));
    }

    async onDisconnect(conn: Party.Connection) {
        this.removePeer(conn.id);
    }

    async onClose(conn: Party.Connection) {
        this.removePeer(conn.id);
    }

    async onMessage(message: string, sender: Party.Connection) {
        try {
            const parsed: IncomingRoomMessage = JSON.parse(message) as IncomingRoomMessage;

            if (parsed.type === 'heartbeat') {
                this.lastHeartbeats.set(sender.id, Date.now());
                return;
            }

            if (typeof parsed.targetId === 'string') {
                this.lastHeartbeats.set(sender.id, Date.now());
                const targetConn = this.connections.get(parsed.targetId);
                if (targetConn) {
                    targetConn.send(JSON.stringify({
                        ...parsed,
                        senderId: sender.id
                    }));
                }
            }
        } catch (error) {
            console.error('Error processing WebRTC signaling message:', error);
        }
    }

    private evictUnresponsivePeers(now: number = Date.now()): void {
        for (const [peerId, lastHeartbeat] of this.lastHeartbeats) {
            if (now - lastHeartbeat < SpeedtestRoom.PEER_TIMEOUT_MS) {
                continue;
            }

            const connection = this.connections.get(peerId);
            this.removePeer(peerId);
            connection?.close();
        }
    }

    private removePeer(peerId: string): void {
        const wasConnected = this.connections.delete(peerId);
        this.lastHeartbeats.delete(peerId);
        if (wasConnected) {
            this.room.broadcast(JSON.stringify({
                type: 'peer-left',
                peerId
            }));
        }
    }
}
