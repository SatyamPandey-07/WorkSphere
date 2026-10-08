/**
 * whiteboard.room.ts
 * PartyKit room configuration to manage WebSocket connections and broadcast CRDT deltas.
 * Handles connection lifecycle and state persistence.
 */

import type * as Party from 'partykit/server';
import { CrdtDocument, CrdtState, CrdtOperation } from '@/core/crdt/CrdtDocument';

export default class WhiteboardRoom implements Party.Server {
    private document: CrdtDocument;
    private roomId: string;

    constructor(readonly room: Party.Room) {
        this.roomId = room.id;
        // Initialize with a deterministic nodeId based on room ID for server-side ops
        this.document = new CrdtDocument(`server-${this.roomId}`);
    }

    async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
        // Send current state to the newly connected client
        conn.send(JSON.stringify({
            type: 'INIT_STATE',
            payload: this.document.getState()
        }));
    }

    async onMessage(message: string, sender: Party.Connection) {
        try {
            const parsed = JSON.parse(message);

            if (parsed.type === 'APPLY_OPERATION') {
                const op = parsed.payload as CrdtOperation;
                const merged = this.document.mergeRemoteOperation(op);

                if (merged) {
                    // Broadcast to all other connections
                    this.room.broadcast(JSON.stringify({
                        type: 'OPERATION_APPLIED',
                        payload: op
                    }), [sender.id]);
                }
            } else if (parsed.type === 'REQUEST_STATE') {
                sender.send(JSON.stringify({
                    type: 'INIT_STATE',
                    payload: this.document.getState()
                }));
            }
        } catch (error) {
            console.error('Error processing whiteboard message:', error);
        }
    }

    async onSave(): Promise<unknown> {
        // Persist the current state to storage (e.g., Neon PostgreSQL via external API or direct if configured)
        return this.document.getState();
    }

    async onBeforeConnect(req: Party.Request) {
        // Optional: Authenticate user via Clerk token in headers
        return req;
    }
}
