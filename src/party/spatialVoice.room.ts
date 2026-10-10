/**
 * spatialVoice.room.ts
 * PartyKit room handler that broadcasts high-frequency coordinate updates to synchronize 
 * spatial audio positions across peers.
 */

import type * as Party from 'partykit/server';

export interface SpatialUpdate {
    peerId: string;
    x: number;
    y: number;
    z: number;
    timestamp: number;
}

export default class SpatialVoiceRoom implements Party.Server {
    private positions: Map<string, SpatialUpdate>;

    constructor(readonly room: Party.Room) {
        this.positions = new Map();
    }

    async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
        // Send current state of all users to the newly connected peer
        const initialState = Array.from(this.positions.values());
        conn.send(JSON.stringify({
            type: 'INITIAL_STATE',
            peers: initialState
        }));
    }

    async onMessage(message: string, sender: Party.Connection) {
        try {
            const parsed = JSON.parse(message);

            if (parsed.type === 'POSITION_UPDATE') {
                const update: SpatialUpdate = {
                    peerId: sender.id,
                    x: parsed.x,
                    y: parsed.y,
                    z: parsed.z,
                    timestamp: Date.now()
                };

                this.positions.set(sender.id, update);

                // Broadcast to all other peers
                this.room.broadcast(JSON.stringify({
                    type: 'PEER_MOVED',
                    payload: update
                }), [sender.id]);
            }
        } catch (error) {
            console.error('Error processing spatial voice message:', error);
        }
    }

    async onDisconnect(conn: Party.Connection) {
        this.positions.delete(conn.id);
        this.room.broadcast(JSON.stringify({
            type: 'PEER_LEFT',
            peerId: conn.id
        }));
    }
}
