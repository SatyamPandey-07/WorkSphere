import type * as Party from 'partykit/server';

export const HEARTBEAT_PING_INTERVAL_MS = 10_000; // Send ping every 10s
export const HEARTBEAT_TIMEOUT_MS = 30_000;       // Evict stale peer after 30s without pong

export interface VenuePeerPresence {
  peerId: string;
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  deskZone?: string | null;
  status: 'working' | 'break' | 'focus';
  joinedAt: number;
  lastSeenAt: number;
}

export type IncomingVenueRoomMessage =
  | {
    type: 'join';
    userId: string;
    displayName: string;
    avatarUrl?: string | null;
    deskZone?: string | null;
    status?: 'working' | 'break' | 'focus';
  }
  | {
    type: 'status_update';
    status?: 'working' | 'break' | 'focus';
    deskZone?: string | null;
  }
  | {
    type: 'pong';
    timestamp?: number;
  };

export type OutgoingVenueRoomMessage =
  | {
    type: 'presence_sync';
    roomId: string;
    peers: VenuePeerPresence[];
    timestamp: number;
  }
  | {
    type: 'peer_joined';
    peer: VenuePeerPresence;
    timestamp: number;
  }
  | {
    type: 'peer_updated';
    peer: VenuePeerPresence;
    timestamp: number;
  }
  | {
    type: 'peer_left';
    peerId: string;
    userId: string;
    reason: 'closed' | 'heartbeat_timeout' | 'error';
    timestamp: number;
  }
  | {
    type: 'ping';
    timestamp: number;
  };

interface TrackedConnectionRecord {
  connection: Party.Connection;
  presence: VenuePeerPresence;
  lastPongAt: number;
}

export default class VenuePresenceRoom implements Party.Server {
  private readonly peers = new Map<string, TrackedConnectionRecord>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(readonly room: Party.Room) { }

  public get activePeerCount(): number {
    return this.peers.size;
  }

  public getActivePeers(): VenuePeerPresence[] {
    return Array.from(this.peers.values()).map((record) => ({
      ...record.presence,
    }));
  }

  private ensureHeartbeatLoop(): void {
    if (this.heartbeatTimer !== null) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      this.runHeartbeatSweep(Date.now());
    }, HEARTBEAT_PING_INTERVAL_MS);
  }

  private stopHeartbeatLoopIfEmpty(): void {
    if (this.peers.size === 0 && this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Sweeps all tracked connections:
   * 1. Evicts peers whose `lastPongAt` exceeds `HEARTBEAT_TIMEOUT_MS` (30s) without a pong,
   *    closes the dead socket, and broadcasts a `peer_left` state diff.
   * 2. Sends a `ping` frame to remaining healthy connections.
   */
  public runHeartbeatSweep(nowMs: number = Date.now()): string[] {
    const evictedPeerIds: string[] = [];

    for (const [peerId, record] of Array.from(this.peers.entries())) {
      const silenceDurationMs = nowMs - record.lastPongAt;

      if (silenceDurationMs > HEARTBEAT_TIMEOUT_MS) {
        evictedPeerIds.push(peerId);
        this.evictPeer(peerId, 'heartbeat_timeout', nowMs);

        try {
          record.connection.close(1001, 'Heartbeat timeout');
        } catch {
          // Socket may already be half-open/dead after laptop sleep
        }
        continue;
      }

      try {
        const pingPayload: OutgoingVenueRoomMessage = {
          type: 'ping',
          timestamp: nowMs,
        };
        record.connection.send(JSON.stringify(pingPayload));
      } catch {
        // Immediate send failure indicates broken pipe -> evict cleanly
        evictedPeerIds.push(peerId);
        this.evictPeer(peerId, 'error', nowMs);
      }
    }

    this.stopHeartbeatLoopIfEmpty();
    return evictedPeerIds;
  }

  private evictPeer(
    peerId: string,
    reason: 'closed' | 'heartbeat_timeout' | 'error',
    nowMs: number = Date.now()
  ): void {
    const existing = this.peers.get(peerId);
    if (!existing) {
      return;
    }

    this.peers.delete(peerId);

    const diffMessage: OutgoingVenueRoomMessage = {
      type: 'peer_left',
      peerId: existing.presence.peerId,
      userId: existing.presence.userId,
      reason,
      timestamp: nowMs,
    };

    this.room.broadcast(JSON.stringify(diffMessage), [peerId]);
    this.stopHeartbeatLoopIfEmpty();
  }

  onConnect(connection: Party.Connection, _ctx: Party.ConnectionContext): void {
    const now = Date.now();
    const initialPresence: VenuePeerPresence = {
      peerId: connection.id,
      userId: connection.id,
      displayName: 'Coworker',
      avatarUrl: null,
      deskZone: null,
      status: 'working',
      joinedAt: now,
      lastSeenAt: now,
    };

    this.peers.set(connection.id, {
      connection,
      presence: initialPresence,
      lastPongAt: now,
    });

    this.ensureHeartbeatLoop();

    // Send full presence snapshot to the newly connected peer
    const syncPayload: OutgoingVenueRoomMessage = {
      type: 'presence_sync',
      roomId: this.room.id,
      peers: this.getActivePeers(),
      timestamp: now,
    };
    connection.send(JSON.stringify(syncPayload));
  }

  onMessage(message: string | ArrayBuffer, sender: Party.Connection): void {
    const now = Date.now();
    const record = this.peers.get(sender.id);

    if (!record) {
      return;
    }

    // Any frame received from the client proves socket liveness
    record.lastPongAt = now;
    record.presence.lastSeenAt = now;

    if (typeof message !== 'string') {
      return;
    }

    let parsed: IncomingVenueRoomMessage;
    try {
      parsed = JSON.parse(message) as IncomingVenueRoomMessage;
    } catch {
      return;
    }

    if (parsed.type === 'pong') {
      return;
    }

    if (parsed.type === 'join') {
      record.presence = {
        ...record.presence,
        userId: parsed.userId?.trim() || sender.id,
        displayName: parsed.displayName?.trim() || 'Coworker',
        avatarUrl: parsed.avatarUrl ?? null,
        deskZone: parsed.deskZone ?? null,
        status: parsed.status ?? 'working',
        lastSeenAt: now,
      };

      const joinedMsg: OutgoingVenueRoomMessage = {
        type: 'peer_joined',
        peer: { ...record.presence },
        timestamp: now,
      };
      this.room.broadcast(JSON.stringify(joinedMsg), [sender.id]);
      return;
    }

    if (parsed.type === 'status_update') {
      if (parsed.status) {
        record.presence.status = parsed.status;
      }
      if (parsed.deskZone !== undefined) {
        record.presence.deskZone = parsed.deskZone;
      }

      const updatedMsg: OutgoingVenueRoomMessage = {
        type: 'peer_updated',
        peer: { ...record.presence },
        timestamp: now,
      };
      this.room.broadcast(JSON.stringify(updatedMsg), [sender.id]);
    }
  }

  onClose(connection: Party.Connection): void {
    this.evictPeer(connection.id, 'closed', Date.now());
  }

  onError(connection: Party.Connection, _err: Error): void {
    this.evictPeer(connection.id, 'error', Date.now());
  }
}