import type { Room, Connection, ConnectionContext, PartyKitServer } from 'partykit/server';

interface PeerMetadata {
    userId: string;
    role: 'guest' | 'host';
    location: { lat: number; lng: number };
    verified: boolean;
}

interface NetworkMessage {
    type: 'DISCOVERY_REQUEST' | 'DISCOVERY_RESPONSE' | 'ESCROW_INIT' | 'ESCROW_ACCEPT';
    payload: any;
}

export default class LuggageNetworkRoom implements PartyKitServer {
    private peers: Map<string, { conn: Connection; meta: PeerMetadata }>;

    constructor(public room: Room) {
        this.peers = new Map();
    }

    onConnect(conn: Connection, ctx: ConnectionContext) {
        const userId = ctx.request.headers.get('x-user-id');
        const role = ctx.request.headers.get('x-user-role') as 'guest' | 'host';
        const lat = parseFloat(ctx.request.headers.get('x-lat') || '0');
        const lng = parseFloat(ctx.request.headers.get('x-lng') || '0');
        const verified = ctx.request.headers.get('x-verified') === 'true';

        if (!userId || !role) {
            conn.close(1008, 'Missing authentication headers');
            return;
        }

        const meta: PeerMetadata = {
            userId,
            role,
            location: { lat, lng },
            verified,
        };

        this.peers.set(conn.id, { conn, meta });
        console.log(`Peer connected: ${userId} (${role})`);
    }

    onMessage(message: string, sender: Connection) {
        const senderPeer = this.peers.get(sender.id);
        if (!senderPeer) return;

        try {
            const msg: NetworkMessage = JSON.parse(message);
            this.handleMessage(msg, senderPeer);
        } catch (error) {
            console.error('Invalid message format:', error);
        }
    }

    private handleMessage(msg: NetworkMessage, sender: { conn: Connection; meta: PeerMetadata }) {
        switch (msg.type) {
            case 'DISCOVERY_REQUEST':
                this.handleDiscovery(sender);
                break;
            case 'ESCROW_INIT':
                this.broadcastToHosts(msg, sender.meta.location);
                break;
            case 'ESCROW_ACCEPT':
                this.routeToGuest(msg, sender);
                break;
        }
    }

    private handleDiscovery(sender: { conn: Connection; meta: PeerMetadata }) {
        const nearbyHosts: PeerMetadata[] = [];
        for (const peer of this.peers.values()) {
            if (peer.meta.role === 'host' && peer.meta.verified) {
                const distance = this.calculateDistance(sender.meta.location, peer.meta.location);
                if (distance < 5.0) {
                    nearbyHosts.push(peer.meta);
                }
            }
        }
        sender.conn.send(JSON.stringify({ type: 'DISCOVERY_RESPONSE', payload: nearbyHosts }));
    }

    private broadcastToHosts(msg: NetworkMessage, guestLocation: { lat: number; lng: number }) {
        for (const peer of this.peers.values()) {
            if (peer.meta.role === 'host' && peer.meta.verified) {
                const distance = this.calculateDistance(guestLocation, peer.meta.location);
                if (distance < 5.0) {
                    peer.conn.send(JSON.stringify(msg));
                }
            }
        }
    }

    private routeToGuest(msg: NetworkMessage, host: { conn: Connection; meta: PeerMetadata }) {
        const guestId = msg.payload.guestId;
        for (const peer of this.peers.values()) {
            if (peer.meta.userId === guestId && peer.meta.role === 'guest') {
                peer.conn.send(JSON.stringify(msg));
                break;
            }
        }
    }

    private calculateDistance(loc1: { lat: number; lng: number }, loc2: { lat: number; lng: number }): number {
        const R = 6371;
        const dLat = this.deg2rad(loc2.lat - loc1.lat);
        const dLon = this.deg2rad(loc2.lng - loc1.lng);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.deg2rad(loc1.lat)) * Math.cos(this.deg2rad(loc2.lat)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    private deg2rad(deg: number): number {
        return deg * (Math.PI / 180);
    }

    onClose(conn: Connection) {
        this.peers.delete(conn.id);
    }
}
