import type * as Party from "partykit/server";
import { HydrationGate, SEAT_HOLDS_STORAGE_KEY } from "./holdHydration";

/**
 * VenueRoom.ts
 * PartyKit room server managing real-time seat check-ins, CRDT sequence tracking,
 * seat hold locking, conflict resolution, and delta state synchronization for nomadic workers.
 */

export const DEFAULT_SEAT_HOLD_TTL_MS = 5 * 60 * 1000; // 5 minutes default hold TTL

/**
 * How long (ms) the client keeps the "Extend Hold" recovery prompt on screen
 * after a `lock_expired` notification (#7943). The seat is released on the
 * server immediately; this window only bounds the UI prompt.
 */
export const LOCK_EXPIRED_GRACE_MS = 30 * 1000;

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
  // Hibernation wake safety (#7954)
  private holdGate = new HydrationGate();
  private persistScheduled = false;

  readonly room: Party.Room;

  constructor(room: Party.Room) {
    this.room = room;
    // Closes the gate synchronously so no request is validated against an
    // empty lease table while persisted holds are still loading.
    if (room.storage) {
      void this.holdGate.begin(() => this.hydrateHolds());
    }
    // Periodic sweep for expired seat holds every 10 seconds
    this.holdCleanupInterval = setInterval(() => {
      this.pruneExpiredHolds();
    }, 10_000);
  }

  /** PartyKit waits for this before delivering traffic to a freshly woken room. */
  async onStart(): Promise<void> {
    await this.holdGate.whenReady();
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
        this.notifyLockExpired(hold, now);
        pruned++;
      }
    }
    if (pruned > 0) this.persistHolds();
    return pruned;
  }

  /**
   * Restores unexpired hold leases from room storage after a cold start or
   * hibernation wake (#7954). Restored seats are marked HELD so snapshots sent
   * to clients agree with the lease table.
   */
  private async hydrateHolds(): Promise<void> {
    const stored = await this.room.storage.get<SeatHoldLock[]>(
      SEAT_HOLDS_STORAGE_KEY
    );
    if (!Array.isArray(stored)) return;

    const now = Date.now();
    for (const hold of stored) {
      if (
        !hold ||
        typeof hold.seatId !== "string" ||
        typeof hold.userId !== "string" ||
        typeof hold.connId !== "string" ||
        typeof hold.holdExpiresAt !== "number" ||
        now >= hold.holdExpiresAt ||
        this.seatHolds.has(hold.seatId)
      ) {
        continue;
      }

      this.seatHolds.set(hold.seatId, { ...hold });
      this.seats.set(hold.seatId, {
        seatId: hold.seatId,
        userId: hold.userId,
        userName: hold.userName,
        status: "HELD",
        timestamp: now,
        sequenceId: this.sequenceId,
      });
    }
  }

  /**
   * Writes the lease table to room storage, coalesced to one write per tick
   * and skipped during hydration so an empty table never overwrites it.
   */
  private persistHolds(): void {
    if (!this.room.storage || !this.holdGate.isReady || this.persistScheduled) {
      return;
    }
    this.persistScheduled = true;
    void Promise.resolve().then(() => {
      this.persistScheduled = false;
      const snapshot = Array.from(this.seatHolds.values());
      return Promise.resolve(
        this.room.storage.put(SEAT_HOLDS_STORAGE_KEY, snapshot)
      ).catch((err: unknown) => {
        console.error("[VenueRoom] failed to persist seat holds:", err);
      });
    });
  }

  /**
   * Tells the connection that owned an expired hold, and only that connection,
   * so its client can offer a one-click renewal instead of failing at checkout.
   */
  private notifyLockExpired(hold: SeatHoldLock, now: number): void {
    const conn =
      typeof this.room.getConnection === "function"
        ? this.room.getConnection(hold.connId)
        : undefined;
    if (!conn) return;

    try {
      conn.send(
        JSON.stringify({
          type: "lock_expired",
          epoch: this.serverEpoch,
          seatId: hold.seatId,
          userId: hold.userId,
          expiredAt: now,
          graceMs: LOCK_EXPIRED_GRACE_MS,
        })
      );
    } catch {
      // Connection closed between lookup and send; nothing to recover.
    }
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    if (!this.holdGate.isReady) await this.holdGate.whenReady();
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
    if (!this.holdGate.isReady) await this.holdGate.whenReady();
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
        this.persistHolds();
      }
    }
  }

  async onMessage(message: string | ArrayBuffer, sender: Party.Connection) {
    // Queue behind hydration: every waiter resumes in arrival order, and the
    // handler below has no awaits, so lock validation is strictly serialized
    // against the restored lease table (#7954).
    if (!this.holdGate.isReady) await this.holdGate.whenReady();
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

        this.applySeatHold(data, sender);
        return;
      }

      // Atomic renewal after a hold expired (#7943). The room is single
      // threaded, so the availability check and the re-acquire below cannot
      // interleave with another user's seat_hold or seat_checkin.
      if (data.type === "lock_extend") {
        const existing = this.seats.get(data.seatId);
        const activeHold = this.seatHolds.get(data.seatId);

        if (existing?.status === "OCCUPIED") {
          sender.send(
            JSON.stringify({
              type: "seat_conflict",
              seatId: data.seatId,
              reason: "ALREADY_OCCUPIED",
              message: "Seat was taken while your hold was expired",
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

        const holdExpiresAt = this.applySeatHold(data, sender);
        sender.send(
          JSON.stringify({
            type: "lock_extended",
            seatId: data.seatId,
            holdExpiresAt,
          })
        );
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
        this.persistHolds();
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
        this.persistHolds();

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
        this.persistHolds();

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
   * Creates (or renews) a seat hold for the sender and broadcasts it.
   * Callers must have already validated that the seat can be held.
   * Returns the new hold expiry timestamp.
   */
  private applySeatHold(
    data: { seatId: string; userId: string; userName?: string; ttlMs?: unknown },
    sender: Party.Connection
  ): number {
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
    this.persistHolds();

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
    return holdExpiresAt;
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
