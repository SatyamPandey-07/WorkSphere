import type { Room, RoomContext } from 'partykit/server';

/**
 * PartyKit room handler that facilitates the secure exchange of 
 * public keys and endorsement payloads between nearby peers.
 */
export default class TrustNetworkRoom implements Room {
    private peers: Map<string, any> = new Map();

    constructor(public room: RoomContext) { }

    onConnect(conn: WebSocket, ctx: RoomContext) {
        const userId = ctx.connectionId;
        this.peers.set(userId, conn);

        // Broadcast new peer arrival
        this.broadcast({ type: 'PEER_JOINED', userId }, conn);
    }

    onMessage(message: string, sender: WebSocket) {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'PUBLISH_PUBLIC_KEY':
                    this.broadcast(data, sender);
                    break;

                case 'EXCHANGE_ENDORSEMENT':
                    // Route the signed endorsement to the specific target peer or broadcast to the local mesh
                    this.broadcast(data, sender);
                    break;

                case 'SYNC_LEDGER':
                    // Handle Merkle root comparisons and missing edge requests
                    this.broadcast(data, sender);
                    break;
            }
        } catch (err) {
            console.error('TrustNetworkRoom parse error', err);
        }
    }

    onClose(conn: WebSocket) {
        this.peers.delete(conn.id);
        this.broadcast({ type: 'PEER_LEFT', userId: conn.id }, conn);
    }

    private broadcast(data: any, exclude?: WebSocket) {
        const payload = JSON.stringify(data);
        for (const [id, conn] of this.peers.entries()) {
            if (conn !== exclude) {
                conn.send(payload);
            }
        }
    }
}
