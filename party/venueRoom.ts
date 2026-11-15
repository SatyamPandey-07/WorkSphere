import type * as Party from "partykit/server";

/**
 * VenueRoom.ts
 * PartyKit room server managing real-time seat check-ins, CRDT sequence tracking,
 * and delta state synchronization for nomadic workers.
 */

export interface SeatCheckin {
  seatId: string;
  userId: string;
  userName?: string;
  status: "OCCUPIED" | "AVAILABLE" | "HELD";
  timestamp: number;
  sequenceId: number;
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
  private eventHistory: VenueRoomEvent[] = [];
  private readonly maxHistorySize: number = 500;

  constructor(readonly room: Party.Room) {}

  public getSequenceId(): number {
    return this.sequenceId;
  }

  public getEpoch(): number {
    return this.serverEpoch;
  }

  public getSeats(): SeatCheckin[] {
    return Array.from(this.seats.values());
  }

  public getEventHistory(): VenueRoomEvent[] {
    return [...this.eventHistory];
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
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

  async onMessage(message: string | ArrayBuffer, sender: Party.Connection) {
    if (typeof message !== "string") return;

    try {
      const data = JSON.parse(message);

      if (data.type === "sync_request") {
        const lastSeq = typeof data.lastSeq === "number" ? data.lastSeq : 0;
        const epoch = typeof data.epoch === "number" ? data.epoch : undefined;
        this.handleSyncRequest(sender, lastSeq, epoch);
        return;
      }

      if (data.type === "seat_checkin") {
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
