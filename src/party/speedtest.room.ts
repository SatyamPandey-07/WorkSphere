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

export default class SpeedtestRoom implements Party.Server {
    private connections: Map<string, Party.Connection>;

    constructor(readonly room: Party.Room) {
        this.connections = new Map();
    }

    async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
        this.connections.set(conn.id, conn);

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
        this.connections.delete(conn.id);
        this.room.broadcast(JSON.stringify({
            type: 'peer-left',
            peerId: conn.id
        }));
    }

    async onMessage(message: string, sender: Party.Connection) {
        try {
            const parsed: SignalingMessage = JSON.parse(message);

            if (parsed.type === 'offer' || parsed.type === 'answer' || parsed.type === 'ice-candidate') {
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
}
