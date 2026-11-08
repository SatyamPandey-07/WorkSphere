/**
 * offlineMesh.room.ts
 * PartyKit room handler that seamlessly bridges the local BLE mesh to the global internet 
 * once one peer regains connectivity.
 */

import type * as Party from 'partykit/server';

export default class OfflineMeshRoom implements Party.Server {
    private pendingSync: Map<string, string>; // connectionId -> serializedBundle

    constructor(readonly room: Party.Room) {
        this.pendingSync = new Map();
    }

    async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
        // When a peer connects via PartyKit, it means they have internet access.
        // Send them any bundles that were collected offline by other peers.

        for (const bundleData of this.pendingSync.values()) {
            conn.send(JSON.stringify({ type: 'SYNC_BUNDLE', payload: bundleData }));
        }
        this.pendingSync.clear();
    }

    async onMessage(message: string, sender: Party.Connection) {
        try {
            const parsed = JSON.parse(message);

            if (parsed.type === 'OFFLINE_BUNDLE_UPLOAD') {
                // A peer regained internet and is uploading bundles collected via BLE
                this.pendingSync.set(sender.id, parsed.payload);

                // Broadcast to all other online peers immediately
                this.room.broadcast(JSON.stringify({
                    type: 'SYNC_BUNDLE',
                    payload: parsed.payload
                }), [sender.id]);
            }
        } catch (error) {
            console.error('Error processing offline mesh message:', error);
        }
    }
}
