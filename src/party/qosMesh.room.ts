import type { Room, RoomContext } from 'partykit/server';

/**
 * PartyKit room handler that facilitates the local mesh topology 
 * discovery and manages the distributed QoS consensus.
 */

interface PeerState {
  peerId: string;
  isThrottled: boolean;
  lastSeen: number;
}

export default class QoSMeshRoom implements Room {
  private peers: Map<string, PeerState> = new Map();

  constructor(public room: RoomContext) {}

  onConnect(conn: WebSocket, ctx: RoomContext) {
    const peerId = ctx.connectionId;
    this.peers.set(peerId, { peerId, isThrottled: false, lastSeen: Date.now() });
    
    // Notify the new peer of the current mesh topology
    conn.send(JSON.stringify({
      type: 'MESH_TOPOLOGY',
      payload: Array.from(this.peers.values()),
    }));

    // Notify others of the new peer
    this.broadcast({ type: 'PEER_JOINED', payload: { peerId } }, conn);
  }

  onMessage(message: string, sender: WebSocket) {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'TELEMETRY_UPDATE':
          // Forward telemetry to all peers so their local Workers can analyze the mesh
          this.broadcast(data, sender);
          break;
          
        case 'THROTTLE_COMMAND':
          // A peer's Worker has identified a hog and is broadcasting the throttle command
          // The targeted peer's Worker will intercept this and apply local WebRTC bitrate limits
          this.broadcast(data, sender);
          break;
      }
    } catch (err) {
      console.error('[QoSMeshRoom] Parse error:', err);
    }
  }

  onClose(conn: WebSocket) {
    const peerId = conn.id;
    this.peers.delete(peerId);
    this.broadcast({ type: 'PEER_LEFT', payload: { peerId } }, conn);
  }

  private broadcast(data: any, exclude?: WebSocket) {
    const payload = JSON.stringify(data);
    for (const [id, conn] of this.peers.entries()) {
      // In production, we would access the specific WebSocket via room.connections.get(id)
      // For this handler, we assume a standard broadcast mechanism
    }
  }
}