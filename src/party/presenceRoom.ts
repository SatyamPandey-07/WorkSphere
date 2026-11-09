/**
 * presenceRoom.ts
 * PartyKit WebSocket Room for real-time peer presence synchronization.
 * Handles connections, awareness updates, and cleans up peers on disconnect
 * or when heartbeat inactivity exceeds 15 seconds.
 */

import type * as Party from "partykit/server";

export interface PresencePayload {
  username: string;
  avatar: string | null;
  deskId?: string | null;
  focusTimer?: {
    isActive: boolean;
    durationMinutes: number;
    remainingSeconds: number;
    sessionType: "pomodoro" | "deepwork" | "break";
  } | null;
  cursor?: { x: number; y: number } | null;
  status: "active" | "idle" | "focusing";
  lastActiveAt: number;
}

export interface PresenceMessage {
  type: "AWARENESS_UPDATE" | "HEARTBEAT" | "PEER_LEFT" | "SYNC_REQUEST";
  payload?: Partial<PresencePayload>;
  clientId?: string;
  timestamp?: number;
}

export const INACTIVE_PEER_TIMEOUT_MS = 15_000;
export const HEARTBEAT_SWEEP_INTERVAL_MS = 5_000;

export default class PresenceRoom implements Party.Server {
  private peers: Map<string, { state: PresencePayload; connection: Party.Connection }> =
    new Map();
  private sweepInterval: ReturnType<typeof setInterval> | null = null;

  constructor(readonly room: Party.Room) {
    this.startInactivitySweep();
  }

  async onConnect(conn: Party.Connection, _ctx: Party.ConnectionContext) {
    // Send existing peers state to the newly connected client
    const currentPeers: Record<string, PresencePayload> = {};
    for (const [id, peer] of this.peers) {
      currentPeers[id] = peer.state;
    }

    conn.send(
      JSON.stringify({
        type: "INITIAL_PRESENCE_STATE",
        peers: currentPeers,
        timestamp: Date.now(),
      })
    );
  }

  async onMessage(message: string | ArrayBuffer, sender: Party.Connection) {
    try {
      if (typeof message !== "string") return;
      const parsed: PresenceMessage = JSON.parse(message);

      if (parsed.type === "AWARENESS_UPDATE" && parsed.payload) {
        const existing = this.peers.get(sender.id);
        const updatedState: PresencePayload = {
          username: parsed.payload.username || existing?.state.username || "Guest",
          avatar: parsed.payload.avatar !== undefined ? parsed.payload.avatar : (existing?.state.avatar ?? null),
          deskId: parsed.payload.deskId !== undefined ? parsed.payload.deskId : existing?.state.deskId,
          focusTimer: parsed.payload.focusTimer !== undefined ? parsed.payload.focusTimer : existing?.state.focusTimer,
          cursor: parsed.payload.cursor !== undefined ? parsed.payload.cursor : existing?.state.cursor,
          status: parsed.payload.status || existing?.state.status || "active",
          lastActiveAt: Date.now(),
        };

        this.peers.set(sender.id, { state: updatedState, connection: sender });

        // Broadcast presence update with < 50ms latency to other peers
        this.room.broadcast(
          JSON.stringify({
            type: "PEER_PRESENCE_UPDATED",
            clientId: sender.id,
            state: updatedState,
            timestamp: Date.now(),
          }),
          [sender.id]
        );
      } else if (parsed.type === "HEARTBEAT") {
        const peer = this.peers.get(sender.id);
        if (peer) {
          peer.state.lastActiveAt = Date.now();
        }
      } else if (parsed.type === "SYNC_REQUEST") {
        const currentPeers: Record<string, PresencePayload> = {};
        for (const [id, peer] of this.peers) {
          currentPeers[id] = peer.state;
        }
        sender.send(
          JSON.stringify({
            type: "INITIAL_PRESENCE_STATE",
            peers: currentPeers,
            timestamp: Date.now(),
          })
        );
      }
    } catch (err) {
      console.error("[presenceRoom] Error parsing message:", err);
    }
  }

  async onClose(conn: Party.Connection) {
    this.removePeer(conn.id);
  }

  private removePeer(clientId: string): void {
    if (this.peers.has(clientId)) {
      this.peers.delete(clientId);
      this.room.broadcast(
        JSON.stringify({
          type: "PEER_LEFT",
          clientId,
          timestamp: Date.now(),
        })
      );
    }
  }

  private startInactivitySweep(): void {
    if (this.sweepInterval) return;
    this.sweepInterval = setInterval(() => {
      const now = Date.now();
      const toRemove: string[] = [];

      for (const [id, peer] of this.peers) {
        if (now - peer.state.lastActiveAt > INACTIVE_PEER_TIMEOUT_MS) {
          toRemove.push(id);
        }
      }

      for (const id of toRemove) {
        this.removePeer(id);
      }
    }, HEARTBEAT_SWEEP_INTERVAL_MS);
  }
}
