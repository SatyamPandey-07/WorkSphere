/**
 * focusRoomParty.ts
 * Real-time room server for Focus Rooms built on PartyKit.
 * Handles distributed cursor presence, 30Hz rate limiting, delta compression,
 * and enforces a maximum of 25 concurrent participants (#7570).
 */

import type * as Party from "partykit/server";
import { onConnect } from "y-partykit";

export const MAX_ROOM_PARTICIPANTS = 25;
export const MAX_CURSOR_BROADCAST_RATE_HZ = 30;
export const MIN_BROADCAST_INTERVAL_MS = 1000 / MAX_CURSOR_BROADCAST_RATE_HZ; // ~33.33ms

export interface CursorPosition {
  x: number;
  y: number;
}

export interface ParticipantMetadata {
  name?: string;
  avatar?: string;
  color?: string;
}

export interface ParticipantState {
  id: string;
  cursor: CursorPosition;
  metadata?: ParticipantMetadata;
  lastActive: number;
}

// Wire protocol message formats
export type CursorMessage =
  | {
      type: "cursor_pos";
      id?: string;
      x: number;
      y: number;
      metadata?: ParticipantMetadata;
      seq?: number;
    }
  | {
      type: "cursor_delta";
      id?: string;
      dx: number;
      dy: number;
      seq?: number;
    }
  | {
      type: "cursor_sync_request";
    }
  | {
      type: "room_full";
      limit: number;
      message: string;
    }
  | {
      type: "participant_left";
      id: string;
    }
  | {
      type: "sync_participants";
      participants: ParticipantState[];
    };

interface ParticipantRecord {
  id: string;
  cursor: CursorPosition;
  metadata?: ParticipantMetadata;
  lastSentCursor: CursorPosition | null;
  lastBroadcastTime: number;
  sequence: number;
  pendingTimer: ReturnType<typeof setTimeout> | null;
  pendingUpdate: { x: number; y: number } | null;
}

export default class FocusRoomParty implements Party.Server {
  private participants: Map<string, ParticipantRecord> = new Map();

  constructor(public room: Party.Room) {}

  public getParticipantCount(): number {
    return this.participants.size;
  }

  public getParticipant(id: string): ParticipantRecord | undefined {
    return this.participants.get(id);
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    // 1. Participant Cap Check (Max 25 concurrent participants)
    if (this.participants.size >= MAX_ROOM_PARTICIPANTS && !this.participants.has(conn.id)) {
      const rejectMsg: CursorMessage = {
        type: "room_full",
        limit: MAX_ROOM_PARTICIPANTS,
        message: `Focus room is at maximum capacity (${MAX_ROOM_PARTICIPANTS} participants).`,
      };
      conn.send(JSON.stringify(rejectMsg));
      conn.close(4003, "Room at maximum capacity");
      return;
    }

    // Register participant
    const record: ParticipantRecord = {
      id: conn.id,
      cursor: { x: 0, y: 0 },
      lastSentCursor: null,
      lastBroadcastTime: 0,
      sequence: 0,
      pendingTimer: null,
      pendingUpdate: null,
    };
    this.participants.set(conn.id, record);

    // Send full state of existing participants to the newly connected participant
    const currentList: ParticipantState[] = Array.from(this.participants.values())
      .filter((p) => p.lastSentCursor !== null && p.id !== conn.id)
      .map((p) => ({
        id: p.id,
        cursor: { ...p.cursor },
        metadata: p.metadata,
        lastActive: p.lastBroadcastTime,
      }));

    if (currentList.length > 0) {
      const syncMsg: CursorMessage = {
        type: "sync_participants",
        participants: currentList,
      };
      conn.send(JSON.stringify(syncMsg));
    }

    // Connect to Yjs provider if supported
    if (this.room?.storage) {
      try {
        return onConnect(conn, this.room, {
          persist: true,
        });
      } catch {
        // Graceful fallback if Yjs persistence isn't configured in test environments
      }
    }
  }

  async onClose(conn: Party.Connection) {
    this.cleanupParticipant(conn.id);
  }

  async onError(conn: Party.Connection) {
    this.cleanupParticipant(conn.id);
  }

  private cleanupParticipant(id: string) {
    const record = this.participants.get(id);
    if (!record) return;

    if (record.pendingTimer) {
      clearTimeout(record.pendingTimer);
      record.pendingTimer = null;
    }
    this.participants.delete(id);

    // Notify remaining participants so remote cursors & audio clean up immediately
    const leftMsg: CursorMessage = {
      type: "participant_left",
      id,
    };
    this.room.broadcast(JSON.stringify(leftMsg), [id]);
  }

  async onMessage(message: string | ArrayBuffer, sender: Party.Connection) {
    if (typeof message !== "string") return;

    let parsed: any;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }

    if (!parsed || typeof parsed.type !== "string") return;

    const record = this.participants.get(sender.id);
    if (!record) return;

    if (parsed.type === "cursor_sync_request") {
      const currentList: ParticipantState[] = Array.from(this.participants.values())
        .filter((p) => p.lastSentCursor !== null && p.id !== sender.id)
        .map((p) => ({
          id: p.id,
          cursor: { ...p.cursor },
          metadata: p.metadata,
          lastActive: p.lastBroadcastTime,
        }));
      const syncMsg: CursorMessage = {
        type: "sync_participants",
        participants: currentList,
      };
      sender.send(JSON.stringify(syncMsg));
      return;
    }

    if (parsed.type === "cursor_pos") {
      // Force full position only on the very first update from this participant
      const forceFull = record.lastSentCursor === null;
      this.handleCursorUpdate(sender.id, record, parsed.x, parsed.y, parsed.metadata, forceFull);
    } else if (parsed.type === "cursor_delta") {
      if (
        typeof parsed.dx !== "number" ||
        !Number.isFinite(parsed.dx) ||
        typeof parsed.dy !== "number" ||
        !Number.isFinite(parsed.dy)
      ) {
        return;
      }
      const newX = record.cursor.x + parsed.dx;
      const newY = record.cursor.y + parsed.dy;
      this.handleCursorUpdate(sender.id, record, newX, newY, undefined, false);
    }
  }

  private handleCursorUpdate(
    id: string,
    record: ParticipantRecord,
    x: number,
    y: number,
    metadata?: ParticipantMetadata,
    forceFull: boolean = false,
  ) {
    // Validate incoming coordinates: finite and numbers
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }

    // Bound coordinates defensively [0..5000] to prevent non-finite/errant off-screen state
    const clampedX = Math.max(0, Math.min(5000, x));
    const clampedY = Math.max(0, Math.min(5000, y));

    record.cursor = { x: clampedX, y: clampedY };
    if (metadata) {
      record.metadata = { ...record.metadata, ...metadata };
    }

    const now = Date.now();
    const timeSinceLastBroadcast = now - record.lastBroadcastTime;

    if (timeSinceLastBroadcast >= MIN_BROADCAST_INTERVAL_MS) {
      // We can broadcast immediately
      if (record.pendingTimer) {
        clearTimeout(record.pendingTimer);
        record.pendingTimer = null;
        record.pendingUpdate = null;
      }
      this.broadcastParticipantCursor(record, forceFull);
    } else {
      // Throttle: schedule broadcast for the remaining window
      record.pendingUpdate = { x: clampedX, y: clampedY };
      if (!record.pendingTimer) {
        const remainingDelay = Math.max(1, MIN_BROADCAST_INTERVAL_MS - timeSinceLastBroadcast);
        record.pendingTimer = setTimeout(() => {
          record.pendingTimer = null;
          if (this.participants.has(id)) {
            this.broadcastParticipantCursor(record, false);
          }
        }, remainingDelay);
      }
    }
  }

  private broadcastParticipantCursor(record: ParticipantRecord, forceFull: boolean) {
    const current = record.cursor;
    const last = record.lastSentCursor;
    record.lastBroadcastTime = Date.now();
    record.sequence += 1;

    // Delta compression check
    // If we have a previous position and we are not forced to full update, check if delta is appropriate
    if (!forceFull && last !== null) {
      const dx = current.x - last.x;
      const dy = current.y - last.y;

      // If unchanged, do not broadcast unnecessarily
      if (dx === 0 && dy === 0) {
        return;
      }

      // Send periodic full position or delta
      // Every 30 messages send a full frame to prevent drift/dropped frames
      if (record.sequence % 30 !== 0) {
        const deltaMsg: CursorMessage = {
          type: "cursor_delta",
          id: record.id,
          dx: Math.round(dx * 100) / 100,
          dy: Math.round(dy * 100) / 100,
          seq: record.sequence,
        };
        record.lastSentCursor = { ...current };
        this.room.broadcast(JSON.stringify(deltaMsg), [record.id]);
        return;
      }
    }

    // Send full position update
    const fullMsg: CursorMessage = {
      type: "cursor_pos",
      id: record.id,
      x: Math.round(current.x * 100) / 100,
      y: Math.round(current.y * 100) / 100,
      metadata: record.metadata,
      seq: record.sequence,
    };
    record.lastSentCursor = { ...current };
    this.room.broadcast(JSON.stringify(fullMsg), [record.id]);
  }
}
