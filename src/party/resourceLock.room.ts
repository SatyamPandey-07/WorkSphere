import type { Room, RoomContext } from 'partykit/server';

/**
 * PartyKit room handler that broadcasts real-time lock acquisitions, 
 * releases, and preemptions to all connected campus clients.
 */
export default class ResourceLockRoom implements Room {
    private connections: Map<string, WebSocket>;
    private roomState: Record<string, any>;

    constructor(public room: RoomContext) {
        this.connections = new Map();
        this.roomState = {
            locks: {},
            queues: {},
        };
    }

    onConnect(conn: WebSocket, ctx: RoomContext) {
        const id = conn.id;
        this.connections.set(id, conn);

        // Send current state to newly connected client
        conn.send(JSON.stringify({
            type: 'SYNC_STATE',
            payload: this.roomState,
        }));
    }

    onMessage(message: string, sender: WebSocket) {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'LOCK_GRANTED':
                case 'LOCK_QUEUED':
                case 'DEADLOCK_RESOLVED':
                    // Broadcast resource state changes to all clients
                    this.broadcast(data, sender);
                    this.updateRoomState(data);
                    break;

                case 'CLIENT_REQUEST':
                    // Forward client requests to the main API or handle locally if state is synced
                    // In this architecture, the API route communicates with the worker, 
                    // and the worker pushes updates to PartyKit via internal API calls or direct WS.
                    break;
            }
        } catch (err) {
            console.error('Failed to parse message in ResourceLockRoom', err);
        }
    }

    onClose(conn: WebSocket) {
        this.connections.delete(conn.id);
    }

    private broadcast(data: any, exclude?: WebSocket) {
        const payload = JSON.stringify(data);
        for (const [id, conn] of this.connections.entries()) {
            if (conn !== exclude) {
                conn.send(payload);
            }
        }
    }

    private updateRoomState(data: any) {
        if (data.type === 'LOCK_GRANTED') {
            const { resourceId, tenantId } = data.payload;
            this.roomState.locks[resourceId] = tenantId;
        } else if (data.type === 'LOCK_QUEUED') {
            const { resourceId, tenantId } = data.payload;
            if (!this.roomState.queues[resourceId]) this.roomState.queues[resourceId] = [];
            if (!this.roomState.queues[resourceId].includes(tenantId)) {
                this.roomState.queues[resourceId].push(tenantId);
            }
        } else if (data.type === 'DEADLOCK_RESOLVED') {
            // Preemption logic handled by backend, state sync will follow via LOCK_GRANTED/RELEASE
        }
    }
}
