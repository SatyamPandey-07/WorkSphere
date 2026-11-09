/**
 * vpnMesh.room.ts
 * PartyKit room handler that facilitates the initial peer discovery and ICE candidate exchange for the VPN mesh.
 * Acts as a lightweight signaling server for WebRTC connections.
 * Manages peer connection lifecycles, ensuring explicit socket closure and event listener cleanup upon disconnection.
 */

import type * as Party from "partykit/server";

export type SignalingMessage =
  | { type: "JOIN"; userId: string; teamId: string }
  | {
      type: "OFFER";
      targetUserId: string;
      offer: RTCSessionDescriptionInit;
      senderId: string;
    }
  | {
      type: "ANSWER";
      targetUserId: string;
      answer: RTCSessionDescriptionInit;
      senderId: string;
    }
  | {
      type: "ICE_CANDIDATE";
      targetUserId: string;
      candidate: RTCIceCandidateInit;
      senderId: string;
    }
  | { type: "DISCONNECT"; userId?: string; peerId?: string }
  | { type: "PEER_DISCONNECT"; userId?: string; peerId?: string }
  | { type: "PEER_LIST"; peers: string[] };

export interface PeerSession {
  userId: string;
  teamId: string;
  peerConnection?: RTCPeerConnection | null;
  peerConnections?: Map<string, RTCPeerConnection>;
  dataChannel?: RTCDataChannel | null;
  dataChannels?: Map<string, RTCDataChannel>;
}

export default class VpnMeshRoom implements Party.Server {
  private connectedPeers: Map<string, PeerSession> = new Map();

  constructor(readonly room: Party.Room) {}

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    let userId = conn.id;
    let teamId = "default";
    try {
      if (ctx?.request?.url) {
        const url = new URL(ctx.request.url);
        userId = url.searchParams.get("userId") || conn.id;
        teamId = url.searchParams.get("teamId") || "default";
      }
    } catch {
      // Ignore URL parsing errors
    }

    const existing = this.connectedPeers.get(conn.id);
    this.connectedPeers.set(conn.id, {
      ...existing,
      userId,
      teamId,
    });
    this.broadcastPeerList();

    conn.send(
      JSON.stringify({
        type: "PEER_LIST",
        peers: Array.from(this.connectedPeers.values()).map((p) => p.userId),
      }),
    );
  }

  async onDisconnect(conn: Party.Connection) {
    this.handlePeerDisconnect(conn.id);
  }

  async onMessage(message: string, sender: Party.Connection) {
    try {
      const parsed = JSON.parse(message) as SignalingMessage;

      if (parsed.type === "JOIN") {
        const existing = this.connectedPeers.get(sender.id);
        this.connectedPeers.set(sender.id, {
          ...existing,
          userId: parsed.userId,
          teamId: parsed.teamId,
        });
        this.broadcastPeerList();
        return;
      }

      if (parsed.type === "DISCONNECT" || parsed.type === "PEER_DISCONNECT") {
        const targetId = parsed.peerId || sender.id;
        this.handlePeerDisconnect(targetId);
        return;
      }

      if (
        parsed.type === "OFFER" ||
        parsed.type === "ANSWER" ||
        parsed.type === "ICE_CANDIDATE"
      ) {
        let targetConn: Party.Connection | undefined;
        for (const [id, peer] of this.connectedPeers.entries()) {
          if (peer.userId === parsed.targetUserId) {
            targetConn = this.room.getConnection
              ? this.room.getConnection(id) || undefined
              : undefined;
            break;
          }
        }

        if (targetConn) {
          targetConn.send(JSON.stringify(parsed));
        } else {
          console.warn(`Target peer ${parsed.targetUserId} not found in room`);
        }
      }
    } catch (error) {
      console.error("Error processing VPN mesh signaling message:", error);
    }
  }

  /**
   * Registers an RTCPeerConnection and optional RTCDataChannel for a peer session.
   * Automatically hooks up ICE and connection state listeners to trigger cleanup on failure.
   */
  public registerPeerConnection(
    connId: string,
    pc: RTCPeerConnection,
    dataChannel?: RTCDataChannel,
  ): void {
    let session = this.connectedPeers.get(connId);
    if (!session) {
      session = { userId: connId, teamId: "default" };
      this.connectedPeers.set(connId, session);
    }

    session.peerConnection = pc;
    if (dataChannel) {
      session.dataChannel = dataChannel;
    }

    // Attach listeners for iceConnectionState and connectionState changes
    const prevOnIceState = pc.oniceconnectionstatechange;
    pc.oniceconnectionstatechange = (event: Event) => {
      if (typeof prevOnIceState === "function") {
        prevOnIceState.call(pc, event);
      }
      if (
        pc.iceConnectionState === "failed" ||
        pc.iceConnectionState === "closed"
      ) {
        this.handlePeerDisconnect(connId);
      }
    };

    const prevOnConnState = pc.onconnectionstatechange;
    pc.onconnectionstatechange = (event: Event) => {
      if (typeof prevOnConnState === "function") {
        prevOnConnState.call(pc, event);
      }
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.handlePeerDisconnect(connId);
      }
    };
  }

  /**
   * Handles peer disconnection by closing all RTCPeerConnections and DataChannels,
   * stripping all attached event listeners to release network sockets, and broadcasting the updated peer list.
   */
  public handlePeerDisconnect(connId: string): void {
    const session = this.connectedPeers.get(connId);
    if (!session) return;

    // 1. Explicit cleanup loop calling peerConnection.close() on disconnected peers
    const connectionsToClose: RTCPeerConnection[] = [];
    if (session.peerConnection) {
      connectionsToClose.push(session.peerConnection);
      session.peerConnection = null;
    }
    if (session.peerConnections) {
      for (const pc of session.peerConnections.values()) {
        connectionsToClose.push(pc);
      }
      session.peerConnections.clear();
    }

    for (const pc of connectionsToClose) {
      try {
        pc.onicecandidate = null;
        pc.oniceconnectionstatechange = null;
        pc.onconnectionstatechange = null;
        pc.ondatachannel = null;
        pc.ontrack = null;
        pc.onnegotiationneeded = null;

        if (pc.connectionState !== "closed") {
          pc.close();
        }
      } catch (err) {
        console.warn(`Error closing peer connection for ${connId}:`, err);
      }
    }

    // 2. Clear open RTCDataChannel references and message handlers
    const channelsToClose: RTCDataChannel[] = [];
    if (session.dataChannel) {
      channelsToClose.push(session.dataChannel);
      session.dataChannel = null;
    }
    if (session.dataChannels) {
      for (const dc of session.dataChannels.values()) {
        channelsToClose.push(dc);
      }
      session.dataChannels.clear();
    }

    for (const dc of channelsToClose) {
      try {
        dc.onmessage = null;
        dc.onopen = null;
        dc.onclose = null;
        dc.onerror = null;

        if (dc.readyState !== "closed") {
          dc.close();
        }
      } catch (err) {
        console.warn(`Error closing data channel for ${connId}:`, err);
      }
    }

    // 3. Remove peer session object from active map
    this.connectedPeers.delete(connId);

    // 4. Broadcast updated peer list
    this.broadcastPeerList();
  }

  /**
   * Explicit cleanup loop that scans for disconnected or failed peers and releases their sockets.
   */
  public cleanupDisconnectedPeers(): void {
    for (const [connId, session] of Array.from(this.connectedPeers.entries())) {
      const pc = session.peerConnection;
      if (
        pc &&
        (pc.connectionState === "closed" ||
          pc.connectionState === "failed" ||
          pc.iceConnectionState === "closed" ||
          pc.iceConnectionState === "failed")
      ) {
        this.handlePeerDisconnect(connId);
      }
    }
  }

  /**
   * Handler invoked when iceConnectionState changes on a peer.
   */
  public handleIceConnectionStateChange(
    connId: string,
    state: RTCIceConnectionState,
  ): void {
    if (state === "failed" || state === "closed" || state === "disconnected") {
      this.handlePeerDisconnect(connId);
    }
  }

  /**
   * Returns the number of currently active RTCPeerConnection instances.
   */
  public getActivePeerConnectionCount(): number {
    let count = 0;
    for (const session of this.connectedPeers.values()) {
      if (
        session.peerConnection &&
        session.peerConnection.connectionState !== "closed"
      ) {
        count++;
      }
      if (session.peerConnections) {
        for (const pc of session.peerConnections.values()) {
          if (pc.connectionState !== "closed") {
            count++;
          }
        }
      }
    }
    return count;
  }

  public getPeer(connId: string): PeerSession | undefined {
    return this.connectedPeers.get(connId);
  }

  public getConnectedPeersCount(): number {
    return this.connectedPeers.size;
  }

  private broadcastPeerList(): void {
    const peerListMsg = JSON.stringify({
      type: "PEER_LIST",
      peers: Array.from(this.connectedPeers.values()).map((p) => p.userId),
    });

    if (this.room.getConnections) {
      for (const conn of this.room.getConnections()) {
        conn.send(peerListMsg);
      }
    }
  }
}
