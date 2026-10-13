/**
 * pairProgramming.room.ts
 * PartyKit room handler for WebRTC signaling and session management.
 */
import type * as Party from 'partykit/server';

export interface SignalMessage {
    type: 'offer' | 'answer' | 'ice-candidate' | 'join' | 'leave';
    payload: any;
    senderId: string;
    targetId?: string;
}

export default class PairProgrammingRoom implements Party.Server {
    private connections: Map<string, Party.Connection> = new Map();
    private sessionCapacity: number = 4;

    constructor(readonly room: Party.Room) { }

    onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
        const userId = ctx.request.headers.get('x-user-id') || conn.id;

        if (this.connections.size >= this.sessionCapacity) {
            conn.close(1013, 'Session capacity reached');
            return;
        }

        this.connections.set(userId, conn);
        console.log(`[PartyKit] User ${userId} joined room ${this.room.id}`);

        // Notify others
        this.broadcast({
            type: 'join',
            payload: { userId },
            senderId: userId,
        }, userId);
    }

    onMessage(message: string, sender: Party.Connection) {
        try {
            const msg: SignalMessage = JSON.parse(message);
            const senderId = this.getUserIdByConnection(sender);
            if (!senderId) return;

            msg.senderId = senderId;

            if (msg.targetId) {
                // Direct signaling
                const targetConn = this.connections.get(msg.targetId);
                if (targetConn) {
                    targetConn.send(JSON.stringify(msg));
                }
            } else {
                // Broadcast signaling (e.g., join/leave)
                this.broadcast(msg, senderId);
            }
        } catch (err) {
            console.error('[PartyKit] Failed to parse message', err);
        }
    }

    onClose(conn: Party.Connection) {
        const userId = this.getUserIdByConnection(conn);
        if (userId) {
            this.connections.delete(userId);
            this.broadcast({
                type: 'leave',
                payload: { userId },
                senderId: userId,
            }, userId);
            console.log(`[PartyKit] User ${userId} left room ${this.room.id}`);
        }
    }

    private broadcast(msg: SignalMessage, excludeId: string) {
        const payload = JSON.stringify(msg);
        for (const [userId, conn] of this.connections.entries()) {
            if (userId !== excludeId) {
                conn.send(payload);
            }
        }
    }

    private getUserIdByConnection(conn: Party.Connection): string | null {
        for (const [userId, c] of this.connections.entries()) {
            if (c === conn) return userId;
        }
        return null;
    }
}
