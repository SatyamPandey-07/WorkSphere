import { Room, RoomContext, Connection } from 'partykit/server';

interface PeerState {
    userId: string;
    hasInternet: boolean;
    lastPing: number;
}

export default class EmergencyMeshRoom implements Room {
    private peers: Map<string, PeerState> = new Map();
    private messageLog: any[] = [];

    constructor(public room: RoomContext) { }

    onConnect(conn: Connection, ctx: { request: Request }) {
        const url = new URL(ctx.request.url);
        const userId = url.searchParams.get('userId') || 'anonymous';

        this.peers.set(conn.id, {
            userId,
            hasInternet: true, // PartyKit connection implies internet access
            lastPing: Date.now()
        });

        // Send cached global message log to the newly connected peer
        conn.send(JSON.stringify({
            type: 'HISTORICAL_SYNC',
            messages: this.messageLog
        }));

        console.log(`[EmergencyMesh] Peer ${userId} bridged to global internet.`);
    }

    onMessage(message: string, sender: Connection) {
        try {
            const data = JSON.parse(message);

            if (data.type === 'MESH_BRIDGE_UPLOAD') {
                // A peer in the BLE mesh reached someone with internet and uploaded messages
                this.handleBridgeUpload(data.messages, sender);
            } else if (data.type === 'PING') {
                const peer = this.peers.get(sender.id);
                if (peer) peer.lastPing = Date.now();
            }
        } catch (error) {
            console.error('[EmergencyMesh] Parse error', error);
        }
    }

    onClose(conn: Connection) {
        this.peers.delete(conn.id);
    }

    private handleBridgeUpload(messages: any[], sender: Connection) {
        const peer = this.peers.get(sender.id);
        if (!peer) return;

        let newCount = 0;
        for (const msg of messages) {
            if (!this.messageLog.some(m => m.id === msg.id)) {
                this.messageLog.push(msg);
                newCount++;
            }
        }

        if (newCount > 0) {
            // Broadcast new messages to all other internet-connected clients
            const payload = JSON.stringify({
                type: 'NEW_GLOBAL_MESSAGES',
                messages: messages.filter(m => this.messageLog.includes(m))
            });

            this.room.broadcast(payload, [sender.id]);
        }
    }
}
