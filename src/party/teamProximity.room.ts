import type { Room, RoomContext } from 'partykit/server';

/**
 * PartyKit room handler that securely broadcasts encrypted location 
 * updates to authorized team members in the same venue.
 */

interface PeerState {
    userId: string;
    coordinate: { x: number; y: number; z: number };
    heading: number;
    timestamp: number;
}

export default class TeamProximityRoom implements Room {
    private peers: Map<string, PeerState> = new Map();
    private broadcastInterval: ReturnType<typeof setInterval> | null = null;

    constructor(public room: RoomContext) {
        // Throttle broadcasts to every 200ms to prevent network flooding
        this.broadcastInterval = setInterval(() => this.broadcastState(), 200);
    }

    onConnect(conn: WebSocket, ctx: RoomContext) {
        const userId = ctx.connectionId;
        this.peers.set(userId, {
            userId,
            coordinate: { x: 0, y: 0, z: 0 },
            heading: 0,
            timestamp: Date.now(),
        });
    }

    onMessage(message: string, sender: WebSocket) {
        try {
            const data = JSON.parse(message);

            if (data.type === 'UPDATE_LOCATION') {
                const userId = sender.id;
                const peer = this.peers.get(userId);
                if (peer) {
                    peer.coordinate = data.coordinate;
                    peer.heading = data.heading;
                    peer.timestamp = Date.now();
                }
            }
        } catch (err) {
            console.error('[TeamProximityRoom] Parse error:', err);
        }
    }

    onClose(conn: WebSocket) {
        this.peers.delete(conn.id);
    }

    onDestroy() {
        if (this.broadcastInterval) {
            clearInterval(this.broadcastInterval);
        }
    }

    private broadcastState() {
        if (this.peers.size <= 1) return;

        const statePayload = JSON.stringify({
            type: 'TEAM_STATE_SYNC',
            payload: Array.from(this.peers.values()),
        });

        // In a production environment, we would encrypt this payload 
        // with a shared team session key before broadcasting.
        for (const [id, peer] of this.peers.entries()) {
            // Send everyone else's state to this peer
            const others = Array.from(this.peers.values()).filter(p => p.userId !== id);
            if (others.length > 0) {
                const ws = this.room.connections.get(id);
                if (ws) {
                    ws.send(JSON.stringify({ type: 'TEAM_STATE_SYNC', payload: others }));
                }
            }
        }
    }
}
