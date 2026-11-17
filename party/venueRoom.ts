import type * as Party from "partykit/server";

/**
 * VenueRoom.ts
 * PartyKit room server managing real-time seat check-ins, CRDT sequence tracking,
 * seat hold locking, conflict resolution, and delta state synchronization for nomadic workers.
 */

export const DEFAULT_SEAT_HOLD_TTL_MS = 5 * 60 * 1000; // 5 minutes default hold TTL

export interface SeatCheckin {
  seatId: string;
  userId: string;
  userName?: string;
  status: "OCCUPIED" | "AVAILABLE" | "HELD";
  timestamp: number;
  sequenceId: number;
}

export interface SeatHoldLock {
  seatId: string;
  userId: string;
  userName?: string;
  connId: string;
  holdExpiresAt: number;
}

export interface VenueRoomEvent {
  sequenceId: number;
  epoch: number;
  type: "seat_checkin" | "seat_checkout" | "seat_hold" | "seat_release";
  seat: SeatCheckin;
  timestamp: number;
}

export default class VenueRoom implements Party.Server {
  private serverEpoch: number = Date.now();
  private sequenceId: number = 0;
  private seats: Map<string, SeatCheckin> = new Map();
  private seatHolds: Map<string, SeatHoldLock> = new Map();
  private eventHistory: VenueRoomEvent[] = [];
  private readonly maxHistorySize: number = 500;
  private holdCleanupInterval?: ReturnType<typeof setInterval>;

  readonly room: Party.Room;

  constructor(room: Party.Room) {
    this.room = room;
    // Periodic sweep for expired seat holds every 10 seconds
    this.holdCleanupInterval = setInterval(() => {
      this.pruneExpiredHolds();
    }, 10_000);
  }

  public dispose(): void {
    if (this.holdCleanupInterval) {
      clearInterval(this.holdCleanupInterval);
    }
  }

  public getSequenceId(): number {
    return this.sequenceId;
  }

  public getEpoch(): number {
    return this.serverEpoch;
  }

  public getSeats(): SeatCheckin[] {
    return Array.from(this.seats.values());
  }

  public getActiveSeatHolds(): SeatHoldLock[] {
    return Array.from(this.seatHolds.values());
  }

  public getEventHistory(): VenueRoomEvent[] {
    return [...this.eventHistory];
  }

  /**
   * Evaluates active seat holds and automatically releases any that have expired past their TTL.
   */
  public pruneExpiredHolds(now: number = Date.now()): number {
    let pruned = 0;
    for (const [seatId, hold] of this.seatHolds.entries()) {
      if (now >= hold.holdExpiresAt) {
        this.seatHolds.delete(seatId);
        this.sequenceId++;
        const seat: SeatCheckin = {
          seatId,
          userId: "",
          status: "AVAILABLE",
          timestamp: now,
          sequenceId: this.sequenceId,
        };
        this.seats.set(seatId, seat);
        this.recordAndBroadcastEvent("seat_release", seat);
        pruned++;
      }
    }
    return pruned;
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    this.pruneExpiredHolds();

    const url = new URL(ctx.request.url);
    const lastSeqParam = url.searchParams.get("lastSeq");
    const epochParam = url.searchParams.get("epoch");

    const lastSeq = lastSeqParam ? parseInt(lastSeqParam, 10) : 0;
    const epoch = epochParam ? parseInt(epochParam, 10) : undefined;

    if (lastSeq > 0) {
      this.handleSyncRequest(conn, lastSeq, epoch);
    } else {
      conn.send(
        JSON.stringify({
          type: "seat_snapshot",
          epoch: this.serverEpoch,
          sequenceId: this.sequenceId,
          seats: Array.from(this.seats.values()),
        })
      );
    }
  }

  async onClose(conn: Party.Connection) {
    // Release unconfirmed holds owned by this closing connection
    const now = Date.now();
    for (const [seatId, hold] of this.seatHolds.entries()) {
      if (hold.connId === conn.id) {
        this.seatHolds.delete(seatId);
        this.sequenceId++;
        const seat: SeatCheckin = {
          seatId,
          userId: "",
          status: "AVAILABLE",
          timestamp: now,
          sequenceId: this.sequenceId,
        };
        this.seats.set(seatId, seat);
        this.recordAndBroadcastEvent("seat_release", seat);
      }
    }
  }

  async onMessage(message: string | ArrayBuffer, sender: Party.Connection) {
    if (typeof message !== "string") return;

    try {
      this.pruneExpiredHolds();

      const data = JSON.parse(message);

      if (data.type === "sync_request") {
        const lastSeq = typeof data.lastSeq === "number" ? data.lastSeq : 0;
        const epoch = typeof data.epoch === "number" ? data.epoch : undefined;
        this.handleSyncRequest(sender, lastSeq, epoch);
        return;
      }

      if (data.type === "seat_hold") {
        const existing = this.seats.get(data.seatId);
        const activeHold = this.seatHolds.get(data.seatId);

        if (existing?.status === "OCCUPIED") {
          sender.send(
            JSON.stringify({
              type: "seat_conflict",
              seatId: data.seatId,
              reason: "ALREADY_OCCUPIED",
              message: "Seat is already occupied and cannot be held",
            })
          );
          return;
        }

        if (
          activeHold &&
          activeHold.userId !== data.userId &&
          Date.now() < activeHold.holdExpiresAt
        ) {
          sender.send(
            JSON.stringify({
              type: "seat_conflict",
              seatId: data.seatId,
              reason: "ALREADY_HELD",
              message: "Seat is currently held by another user",
            })
          );
          return;
        }

        const ttl =
          typeof data.ttlMs === "number" && data.ttlMs > 0
            ? data.ttlMs
            : DEFAULT_SEAT_HOLD_TTL_MS;
        const holdExpiresAt = Date.now() + ttl;

        this.seatHolds.set(data.seatId, {
          seatId: data.seatId,
          userId: data.userId,
          userName: data.userName,
          connId: sender.id,
          holdExpiresAt,
        });

        this.sequenceId++;
        const seat: SeatCheckin = {
          seatId: data.seatId,
          userId: data.userId,
          userName: data.userName,
          status: "HELD",
          timestamp: Date.now(),
          sequenceId: this.sequenceId,
        };

        this.seats.set(data.seatId, seat);
        this.recordAndBroadcastEvent("seat_hold", seat);
        return;
      }

      if (data.type === "seat_release") {
        const activeHold = this.seatHolds.get(data.seatId);
        if (
          activeHold &&
          activeHold.userId !== data.userId &&
          activeHold.connId !== sender.id
        ) {
          sender.send(
            JSON.stringify({
              type: "seat_conflict",
              seatId: data.seatId,
              reason: "UNAUTHORIZED_RELEASE",
              message: "Cannot release a seat held by another user",
            })
          );
          return;
        }

        this.seatHolds.delete(data.seatId);
        this.sequenceId++;
        const seat: SeatCheckin = {
          seatId: data.seatId,
          userId: "",
          status: "AVAILABLE",
          timestamp: Date.now(),
          sequenceId: this.sequenceId,
        };

        this.seats.set(data.seatId, seat);
        this.recordAndBroadcastEvent("seat_release", seat);
        return;
      }

      if (data.type === "seat_checkin") {
        const existing = this.seats.get(data.seatId);
        const activeHold = this.seatHolds.get(data.seatId);

        if (existing?.status === "OCCUPIED") {
          sender.send(
            JSON.stringify({
              type: "seat_conflict",
              seatId: data.seatId,
              reason: "ALREADY_OCCUPIED",
              message: "Seat is already occupied",
            })
          );
          return;
        }

        if (
          activeHold &&
          activeHold.userId !== data.userId &&
          Date.now() < activeHold.holdExpiresAt
        ) {
          sender.send(
            JSON.stringify({
              type: "seat_conflict",
              seatId: data.seatId,
              reason: "ALREADY_HELD",
              message: "Seat is currently held by another user",
            })
          );
          return;
        }

        // Consume hold on checkin
        this.seatHolds.delete(data.seatId);

        this.sequenceId++;
        const seat: SeatCheckin = {
          seatId: data.seatId,
          userId: data.userId,
          userName: data.userName,
          status: "OCCUPIED",
          timestamp: Date.now(),
          sequenceId: this.sequenceId,
        };

        this.seats.set(data.seatId, seat);
        this.recordAndBroadcastEvent("seat_checkin", seat);
        return;
      }

      if (data.type === "seat_checkout") {
        this.seatHolds.delete(data.seatId);

        this.sequenceId++;
        const seat: SeatCheckin = {
          seatId: data.seatId,
          userId: data.userId || "",
          status: "AVAILABLE",
          timestamp: Date.now(),
          sequenceId: this.sequenceId,
        };

        this.seats.set(data.seatId, seat);
        this.recordAndBroadcastEvent("seat_checkout", seat);
        return;
      }
    } catch (err) {
      sender.send(
        JSON.stringify({
          type: "error",
          message: "Failed to parse or process room message",
        })
      );
    }
  }

  /**
   * Reconciles delta state requests from reconnecting clients.
   */
  public handleSyncRequest(
    conn: Party.Connection,
    lastSeq: number,
    clientEpoch?: number
  ): void {
    // If epoch changed (server restarted / migrated), provide full snapshot fallback
    if (typeof clientEpoch === "number" && clientEpoch !== this.serverEpoch) {
      this.sendFullSyncFallback(conn, "epoch_mismatch");
      return;
    }

    // Client is already up to date
    if (lastSeq >= this.sequenceId) {
      conn.send(
        JSON.stringify({
          type: "sync_ack",
          epoch: this.serverEpoch,
          latestSeq: this.sequenceId,
          status: "synchronized",
        })
      );
      return;
    }

    const oldestEvent = this.eventHistory[0];
    const oldestSeq = oldestEvent ? oldestEvent.sequenceId : this.sequenceId + 1;

    // History gap: client is farther behind than retained history
    if (lastSeq + 1 < oldestSeq) {
      this.sendFullSyncFallback(conn, "history_unavailable");
      return;
    }

    // Filter missed events in chronological sequence order
    const missedEvents = this.eventHistory.filter(
      (e) => e.sequenceId > lastSeq && e.sequenceId <= this.sequenceId
    );

    conn.send(
      JSON.stringify({
        type: "sync_replay",
        epoch: this.serverEpoch,
        fromSeq: lastSeq + 1,
        toSeq: this.sequenceId,
        events: missedEvents,
      })
    );
  }

  private sendFullSyncFallback(conn: Party.Connection, reason: string): void {
    conn.send(
      JSON.stringify({
        type: "sync_fallback",
        reason,
        epoch: this.serverEpoch,
        latestSeq: this.sequenceId,
        seats: Array.from(this.seats.values()),
      })
    );
  }

  private recordAndBroadcastEvent(
    type: "seat_checkin" | "seat_checkout" | "seat_hold" | "seat_release",
    seat: SeatCheckin
  ): void {
    const event: VenueRoomEvent = {
      sequenceId: this.sequenceId,
      epoch: this.serverEpoch,
      type,
      seat,
      timestamp: Date.now(),
    };

    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    this.room.broadcast(
      JSON.stringify({
        type: "seat_update",
        epoch: this.serverEpoch,
        sequenceId: this.sequenceId,
        event,
      })
    );
  }
}
