/**
 * PartyKit Room for Coffee Run
 * Facilitates local WebRTC signaling to merge carts and broadcast order status to the group.
 */

import type { Room, Connection } from "partykit/server";

interface CoffeeRunMessage {
    type: 'JOIN_BATCH' | 'LEAVE_BATCH' | 'STATUS_UPDATE' | 'WEBRTC_SIGNAL';
    payload: any;
}

export default class CoffeeRunRoom implements Room {
    private participants: Map<string, Connection> = new Map();
    private batchStatus: string = 'PENDING';

    constructor(public room: Room) { }

    onConnect(conn: Connection, ctx: Room) {
        const userId = conn.id;
        this.participants.set(userId, conn);

        // Broadcast current status to new joiner
        conn.send(JSON.stringify({
            type: 'STATUS_UPDATE',
            payload: { status: this.batchStatus, participantCount: this.participants.size }
        }));
    }

    onMessage(message: string, sender: Connection) {
        try {
            const parsed: CoffeeRunMessage = JSON.parse(message);

            switch (parsed.type) {
                case 'JOIN_BATCH':
                    this.handleJoin(sender, parsed.payload);
                    break;
                case 'LEAVE_BATCH':
                    this.handleLeave(sender);
                    break;
                case 'WEBRTC_SIGNAL':
                    this.routeSignal(sender, parsed.payload);
                    break;
                default:
                    console.warn('Unknown message type:', parsed.type);
            }
        } catch (e) {
            console.error('Failed to parse message:', e);
        }
    }

    onClose(conn: Connection) {
        this.participants.delete(conn.id);
        this.broadcast({
            type: 'LEAVE_BATCH',
            payload: { userId: conn.id }
        }, conn.id);
    }

    private handleJoin(conn: Connection, payload: any) {
        this.broadcast({
            type: 'JOIN_BATCH',
            payload: { userId: conn.id, ...payload }
        }, conn.id);
    }

    private handleLeave(conn: Connection) {
        this.participants.delete(conn.id);
        this.broadcast({
            type: 'LEAVE_BATCH',
            payload: { userId: conn.id }
        }, conn.id);
    }

    private routeSignal(sender: Connection, payload: any) {
        const target = this.participants.get(payload.targetId);
        if (target) {
            target.send(JSON.stringify({
                type: 'WEBRTC_SIGNAL',
                payload: { ...payload, senderId: sender.id }
            }));
        }
    }

    public updateBatchStatus(newStatus: string) {
        this.batchStatus = newStatus;
        this.broadcast({
            type: 'STATUS_UPDATE',
            payload: { status: newStatus }
        });
    }

    private broadcast(msg: CoffeeRunMessage, excludeId?: string) {
        const payload = JSON.stringify(msg);
        this.participants.forEach((conn, id) => {
            if (id !== excludeId) {
                conn.send(payload);
            }
        });
    }
}
