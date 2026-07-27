/**
 * Inter-Server Edge Mesh Synchronization
 *
 * Implements a WebSocket mesh protocol that connects PartyKit edge servers
 * across regions for real-time state replication. Each regional server
 * maintains persistent WebSocket connections to all other regional peers,
 * forming a fully-connected mesh topology.
 *
 * Message types:
 *   - mesh_join       : Announce this server joining the mesh
 *   - mesh_leave      : Announce graceful departure from mesh
 *   - mesh_heartbeat  : Periodic liveness ping between peers
 *   - mesh_state_sync : Full or incremental state replication payload
 */

import type { Region } from "./geoRouter";
import type { CrossRegionState } from "./stateSync";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MeshMessageType =
  "mesh_join" | "mesh_leave" | "mesh_heartbeat" | "mesh_state_sync";

export interface MeshMessage {
  type: MeshMessageType;
  sourceRegion: Region;
  sourceServerId: string;
  timestamp: number;
  payload?: string;
}

export interface MeshPeer {
  serverId: string;
  region: Region;
  host: string;
  /** Underlying WebSocket connection (null when disconnected). */
  ws: WebSocket | null;
  /** Unix-ms of the last heartbeat received from this peer. */
  lastHeartbeat: number;
  /** Current reconnection attempt counter. */
  reconnectAttempts: number;
}

export interface EdgeMeshSyncOptions {
  /** Interval between heartbeat pings (ms). Default: 10 000. */
  heartbeatIntervalMs?: number;
  /** Interval between full state sync broadcasts (ms). Default: 5 000. */
  syncIntervalMs?: number;
  /** Maximum reconnection attempts before marking a peer dead. Default: 5. */
  maxReconnectAttempts?: number;
  /** Base delay for exponential backoff (ms). Default: 1 000. */
  reconnectBaseDelayMs?: number;
  /** Time after which a silent peer is considered dead (ms). Default: 30 000. */
  peerTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: Required<EdgeMeshSyncOptions> = {
  heartbeatIntervalMs: 10_000,
  syncIntervalMs: 5_000,
  maxReconnectAttempts: 5,
  reconnectBaseDelayMs: 1_000,
  peerTimeoutMs: 30_000,
};

export class EdgeMeshSync {
  private readonly serverId: string;
  private readonly region: Region;
  private readonly options: Required<EdgeMeshSyncOptions>;

  /** Map of serverId → peer info. */
  private peers = new Map<string, MeshPeer>();

  /** Timer for periodic heartbeat pings. */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /** Timer for periodic state sync broadcasts. */
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  /** Callback invoked when remote state is received from a peer. */
  private onRemoteStateReceived:
    ((state: CrossRegionState, sourceRegion: Region) => void) | null = null;

  /** Callback invoked when a peer joins or leaves the mesh. */
  private onPeerChange:
    ((peerId: string, event: "join" | "leave") => void) | null = null;

  /** Function that provides the current local state for broadcasting. */
  private getLocalStateFn: (() => string) | null = null;

  constructor(
    serverId: string,
    region: Region,
    options: EdgeMeshSyncOptions = {},
  ) {
    this.serverId = serverId;
    this.region = region;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  /**
   * Register a callback that is invoked whenever a state sync message
   * arrives from a remote peer.
   */
  setOnRemoteStateReceived(
    fn: (state: CrossRegionState, sourceRegion: Region) => void,
  ): void {
    this.onRemoteStateReceived = fn;
  }

  /**
   * Register a callback for peer join / leave events.
   */
  setOnPeerChange(fn: (peerId: string, event: "join" | "leave") => void): void {
    this.onPeerChange = fn;
  }

  /**
   * Provide a function that returns the serialized local state.
   * Called during each sync interval broadcast.
   */
  setGetLocalStateFn(fn: () => string): void {
    this.getLocalStateFn = fn;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Connect to a set of peer servers and begin heartbeat / sync loops.
   *
   * @param peerEndpoints  Array of `{ serverId, region, host }` objects
   *                       describing every other edge server in the mesh.
   */
  start(
    peerEndpoints: Array<{ serverId: string; region: Region; host: string }>,
  ): void {
    // Register all known peers
    for (const ep of peerEndpoints) {
      if (ep.serverId === this.serverId) continue; // skip self
      if (!this.peers.has(ep.serverId)) {
        this.peers.set(ep.serverId, {
          serverId: ep.serverId,
          region: ep.region,
          host: ep.host,
          ws: null,
          lastHeartbeat: Date.now(),
          reconnectAttempts: 0,
        });
      }
    }

    // Initiate WebSocket connections to all peers
    for (const peer of this.peers.values()) {
      this.connectToPeer(peer);
    }

    // Start periodic heartbeats
    this.heartbeatTimer = setInterval(() => {
      this.broadcastHeartbeat();
      this.pruneDeadPeers();
    }, this.options.heartbeatIntervalMs);

    // Start periodic state sync broadcasts
    this.syncTimer = setInterval(() => {
      this.broadcastStateSync();
    }, this.options.syncIntervalMs);
  }

  /**
   * Gracefully disconnect from all peers and stop background timers.
   */
  stop(): void {
    // Broadcast leave message before disconnecting
    const leaveMsg = this.buildMessage("mesh_leave");
    this.broadcastRaw(JSON.stringify(leaveMsg));

    // Teardown timers
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    // Close all peer connections
    for (const peer of this.peers.values()) {
      if (peer.ws) {
        try {
          peer.ws.close(1000, "Server shutting down");
        } catch {
          // Best effort
        }
        peer.ws = null;
      }
    }
    this.peers.clear();
  }

  // -------------------------------------------------------------------------
  // Connection management
  // -------------------------------------------------------------------------

  private connectToPeer(peer: MeshPeer): void {
    if (peer.ws) return; // already connected

    try {
      const protocol = peer.host.startsWith("localhost") ? "ws" : "wss";
      const ws = new WebSocket(`${protocol}://${peer.host}/mesh`);

      ws.addEventListener("open", () => {
        peer.reconnectAttempts = 0;
        peer.lastHeartbeat = Date.now();

        // Announce ourselves to the peer
        const joinMsg = this.buildMessage("mesh_join");
        ws.send(JSON.stringify(joinMsg));

        this.onPeerChange?.(peer.serverId, "join");
      });

      ws.addEventListener("message", (event) => {
        this.handlePeerMessage(peer, String(event.data));
      });

      ws.addEventListener("close", () => {
        peer.ws = null;
        this.onPeerChange?.(peer.serverId, "leave");
        this.scheduleReconnect(peer);
      });

      ws.addEventListener("error", () => {
        // Error is always followed by close — reconnect handled there
        if (peer.ws === ws) {
          peer.ws = null;
        }
      });

      peer.ws = ws;
    } catch {
      this.scheduleReconnect(peer);
    }
  }

  private scheduleReconnect(peer: MeshPeer): void {
    if (peer.reconnectAttempts >= this.options.maxReconnectAttempts) {
      return; // give up
    }

    peer.reconnectAttempts++;
    const delay =
      this.options.reconnectBaseDelayMs *
      Math.pow(2, peer.reconnectAttempts - 1);

    setTimeout(() => {
      if (!peer.ws && this.peers.has(peer.serverId)) {
        this.connectToPeer(peer);
      }
    }, delay);
  }

  // -------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------

  private handlePeerMessage(peer: MeshPeer, raw: string): void {
    try {
      const msg: MeshMessage = JSON.parse(raw);
      peer.lastHeartbeat = Date.now();

      switch (msg.type) {
        case "mesh_join":
          this.onPeerChange?.(peer.serverId, "join");
          break;

        case "mesh_leave":
          this.onPeerChange?.(peer.serverId, "leave");
          if (peer.ws) {
            peer.ws.close(1000, "Peer leaving");
            peer.ws = null;
          }
          break;

        case "mesh_heartbeat":
          // lastHeartbeat already updated above
          break;

        case "mesh_state_sync":
          if (msg.payload && this.onRemoteStateReceived) {
            try {
              const state = JSON.parse(msg.payload) as CrossRegionState;
              this.onRemoteStateReceived(state, msg.sourceRegion);
            } catch {
              // Malformed payload — ignore
            }
          }
          break;
      }
    } catch {
      // Unparseable message — ignore
    }
  }

  // -------------------------------------------------------------------------
  // Broadcasting
  // -------------------------------------------------------------------------

  private buildMessage(type: MeshMessageType, payload?: string): MeshMessage {
    return {
      type,
      sourceRegion: this.region,
      sourceServerId: this.serverId,
      timestamp: Date.now(),
      payload,
    };
  }

  private broadcastRaw(data: string): void {
    for (const peer of this.peers.values()) {
      if (peer.ws && peer.ws.readyState === WebSocket.OPEN) {
        try {
          peer.ws.send(data);
        } catch {
          // Connection may have died between the check and send
        }
      }
    }
  }

  private broadcastHeartbeat(): void {
    const msg = this.buildMessage("mesh_heartbeat");
    this.broadcastRaw(JSON.stringify(msg));
  }

  private broadcastStateSync(): void {
    if (!this.getLocalStateFn) return;

    const localState = this.getLocalStateFn();
    const msg = this.buildMessage("mesh_state_sync", localState);
    this.broadcastRaw(JSON.stringify(msg));
  }

  /**
   * Send a targeted state sync to a specific peer (used during handoff).
   */
  sendStateSyncToPeer(peerId: string, statePayload: string): boolean {
    const peer = this.peers.get(peerId);
    if (!peer?.ws || peer.ws.readyState !== WebSocket.OPEN) return false;

    const msg = this.buildMessage("mesh_state_sync", statePayload);
    try {
      peer.ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Peer health
  // -------------------------------------------------------------------------

  private pruneDeadPeers(): void {
    const now = Date.now();
    for (const peer of this.peers.values()) {
      if (now - peer.lastHeartbeat > this.options.peerTimeoutMs) {
        if (peer.ws) {
          try {
            peer.ws.close(1001, "Peer timed out");
          } catch {
            // Best effort
          }
          peer.ws = null;
        }
        this.onPeerChange?.(peer.serverId, "leave");
        // Don't remove from map — allow reconnection attempts
        peer.reconnectAttempts = 0;
        this.scheduleReconnect(peer);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /** Returns the set of currently connected peer server IDs. */
  getConnectedPeerIds(): string[] {
    const ids: string[] = [];
    for (const peer of this.peers.values()) {
      if (peer.ws && peer.ws.readyState === WebSocket.OPEN) {
        ids.push(peer.serverId);
      }
    }
    return ids;
  }

  /** Returns the total number of registered peers (connected or not). */
  getPeerCount(): number {
    return this.peers.size;
  }

  /** Check if a specific peer is connected. */
  isPeerConnected(serverId: string): boolean {
    const peer = this.peers.get(serverId);
    return !!peer?.ws && peer.ws.readyState === WebSocket.OPEN;
  }

  /** Get this server's ID. */
  getServerId(): string {
    return this.serverId;
  }

  /** Get this server's region. */
  getRegion(): Region {
    return this.region;
  }
}
