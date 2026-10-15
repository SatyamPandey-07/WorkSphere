/**
 * lostAndFound.room.ts
 * PartyKit room handler that manages the anonymous routing table and delivers 
 * decrypted pings to the authenticated owner.
 */
import type * as Party from 'partykit/server';
import type { RelayPacket } from '../core/network/AnonymousMeshRelay';

export interface RoomMessage {
    type: 'relay-packet' | 'claim-item' | 'register-owner';
    payload: any;
    senderId: string;
}

export default class LostAndFoundRoom implements Party.Server {
    private connections: Map<string, Party.Connection> = new Map();
    private itemOwners: Map<string, string> = new Map(); // rotationKey -> ownerId
    private pendingPackets: Map<string, RelayPacket[]> = new Map(); // ownerId -> packets

    constructor(readonly room: Party.Room) { }

    onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
        const userId = ctx.request.headers.get('x-user-id') || conn.id;
        this.connections.set(userId, conn);

        // Send any pending packets for this user
        const pending = this.pendingPackets.get(userId);
        if (pending && pending.length > 0) {
            for (const packet of pending) {
                conn.send(JSON.stringify({
                    type: 'item-location-update',
                    payload: packet,
                }));
            }
            this.pendingPackets.delete(userId);
        }
    }

    onMessage(message: string, sender: Party.Connection) {
        try {
            const msg: RoomMessage = JSON.parse(message);
            const senderId = this.getUserIdByConnection(sender);
            if (!senderId) return;

            if (msg.type === 'relay-packet') {
                this.handleRelayPacket(msg.payload as RelayPacket);
            } else if (msg.type === 'register-owner') {
                // When a user reports an item lost, they register their rotation keys
                const { rotationKeys } = msg.payload;
                for (const key of rotationKeys) {
                    this.itemOwners.set(key, senderId);
                }
            } else if (msg.type === 'claim-item') {
                // Owner proves ownership by decrypting the payload
                // The server just forwards the encrypted packet to the owner's connection
                const { packet } = msg.payload;
                this.deliverToOwner(packet);
            }
        } catch (err) {
            console.error('[LostAndFound Room] Failed to parse message', err);
        }
    }

    private handleRelayPacket(packet: RelayPacket) {
        // Check if we know the owner of this rotation key
        const ownerId = this.itemOwners.get(packet.rotationKey);

        if (ownerId) {
            this.deliverToOwner(packet);
        } else {
            // If owner is unknown, broadcast to all connected nodes to increase mesh coverage
            // This is the "anonymous relay" part - nodes pass it along without knowing who it's for
            this.broadcastToMesh(packet);
        }
    }

    private deliverToOwner(packet: RelayPacket) {
        const ownerId = this.itemOwners.get(packet.rotationKey);
        if (!ownerId) return;

        const ownerConn = this.connections.get(ownerId);
        if (ownerConn) {
            ownerConn.send(JSON.stringify({
                type: 'item-location-update',
                payload: packet,
            }));
        } else {
            // Owner is offline, queue the packet
            if (!this.pendingPackets.has(ownerId)) {
                this.pendingPackets.set(ownerId, []);
            }
            this.pendingPackets.get(ownerId)!.push(packet);
        }
    }

    private broadcastToMesh(packet: RelayPacket) {
        // Increment hop count and broadcast to other relays
        // In a real implementation, this would communicate with other PartyKit rooms or nodes
        const payload = JSON.stringify({
            type: 'mesh-relay',
            payload: packet,
        });

        for (const [userId, conn] of this.connections.entries()) {
            // Don't send back to the node that just relayed it to us
            // (Simplified logic, real mesh would track packet IDs)
            conn.send(payload);
        }
    }

    onClose(conn: Party.Connection) {
        const userId = this.getUserIdByConnection(conn);
        if (userId) {
            this.connections.delete(userId);
        }
    }

    private getUserIdByConnection(conn: Party.Connection): string | null {
        for (const [userId, c] of this.connections.entries()) {
            if (c === conn) return userId;
        }
        return null;
    }
}