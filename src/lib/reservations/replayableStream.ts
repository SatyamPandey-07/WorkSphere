/**
 * Replayable Multi-Instance Reservation Availability Stream & CDC Normalizer (#10685)
 *
 * Provides:
 * - Normalization of PostgreSQL CDC records (`stream:db:changes`) for reservation/seat tables
 * - Bounded, monotonically-ordered replay log with Last-Event-ID cursor support
 * - Multi-instance fanout across instances sharing the same stream backend
 * - Explicit RESYNC_REQUIRED signaling when a cursor is malformed or expired
 */

export interface ReservationEventEnvelope {
  eventId: string;
  cursor: number;
  venueId: string;
  type: string;
  entityId?: string;
  occurredAt: number;
  payload: Record<string, unknown>;
}

export interface RawCdcRecord {
  id?: string;
  table?: string;
  operation?: "INSERT" | "UPDATE" | "DELETE" | string;
  committedAt?: number;
  after?: Record<string, unknown> | null;
  before?: Record<string, unknown> | null;
}

const RESERVATION_TABLES = new Set([
  "Booking",
  "bookings",
  "Reservation",
  "reservations",
  "DeskHold",
  "SeatHold",
]);

export function normalizeCdcToReservationEvent(
  raw: unknown,
): Omit<ReservationEventEnvelope, "cursor"> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const rec = raw as RawCdcRecord;
  if (!rec.table || !RESERVATION_TABLES.has(rec.table)) {
    return null;
  }

  const row = rec.after ?? rec.before;
  if (!row || typeof row !== "object") {
    return null;
  }

  const venueId = typeof row.venueId === "string" ? row.venueId.trim() : "";
  if (!venueId) {
    return null;
  }

  const entityId =
    typeof row.id === "string"
      ? row.id
      : typeof row.deskId === "string"
        ? row.deskId
        : undefined;

  const eventId =
    typeof rec.id === "string" && rec.id.trim()
      ? rec.id
      : `cdc_${rec.table}_${entityId ?? "unknown"}_${rec.committedAt ?? Date.now()}`;

  const op = (rec.operation ?? "UPDATE").toUpperCase();
  const type =
    op === "DELETE"
      ? "RESERVATION_RELEASED"
      : op === "INSERT"
        ? "RESERVATION_CREATED"
        : "RESERVATION_UPDATED";

  return {
    eventId,
    venueId,
    type,
    entityId,
    occurredAt:
      typeof rec.committedAt === "number" && Number.isFinite(rec.committedAt)
        ? rec.committedAt
        : Date.now(),
    payload: {
      type,
      venueId,
      entityId,
      deskId: row.deskId,
      seatId: row.seatId,
      status: row.status,
    },
  };
}

export type ReplayResult =
  | {
      status: "OK";
      events: ReservationEventEnvelope[];
      latestCursor: number;
    }
  | {
      status: "RESYNC_REQUIRED";
      reason: "malformed_cursor" | "cursor_expired" | "cursor_ahead_of_stream";
      latestCursor: number;
    };

type StreamSubscriber = (envelope: ReservationEventEnvelope) => void;

/**
 * Shared replayable stream backend supporting multiple application instances.
 */
export class SharedReservationReplayLog {
  private events: ReservationEventEnvelope[] = [];
  private seenEventIds = new Set<string>();
  private nextCursor = 1;
  private oldestRetainedCursor = 1;
  private subscribers = new Map<string, Set<StreamSubscriber>>();

  constructor(private readonly maxRetainedEvents: number = 1000) {}

  public publish(
    event: Omit<ReservationEventEnvelope, "cursor">,
  ): ReservationEventEnvelope | null {
    // At-least-once consumer deduplication by stable eventId
    if (this.seenEventIds.has(event.eventId)) {
      return null;
    }

    const cursor = this.nextCursor++;
    const envelope: ReservationEventEnvelope = {
      ...event,
      cursor,
    };

    this.events.push(envelope);
    this.seenEventIds.add(event.eventId);

    if (this.events.length > this.maxRetainedEvents) {
      const evicted = this.events.shift();
      if (evicted) {
        this.oldestRetainedCursor = this.events[0]?.cursor ?? this.nextCursor;
        this.seenEventIds.delete(evicted.eventId);
      }
    }

    const listeners = this.subscribers.get(envelope.venueId);
    if (listeners) {
      for (const listener of listeners) {
        listener(envelope);
      }
    }

    return envelope;
  }

  public ingestCdcRecord(raw: unknown): ReservationEventEnvelope | null {
    const normalized = normalizeCdcToReservationEvent(raw);
    if (!normalized) return null;
    return this.publish(normalized);
  }

  public subscribe(
    venueId: string,
    listener: StreamSubscriber,
  ): () => void {
    let set = this.subscribers.get(venueId);
    if (!set) {
      set = new Set();
      this.subscribers.set(venueId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set?.size === 0) {
        this.subscribers.delete(venueId);
      }
    };
  }

  public replayAfter(venueId: string, rawCursor: string): ReplayResult {
    const latestCursor = this.nextCursor - 1;
    if (!/^\d+$/.test(rawCursor.trim())) {
      return {
        status: "RESYNC_REQUIRED",
        reason: "malformed_cursor",
        latestCursor,
      };
    }

    const parsedCursor = Number(rawCursor.trim());
    if (!Number.isSafeInteger(parsedCursor) || parsedCursor < 0) {
      return {
        status: "RESYNC_REQUIRED",
        reason: "malformed_cursor",
        latestCursor,
      };
    }

    if (parsedCursor > latestCursor) {
      return {
        status: "RESYNC_REQUIRED",
        reason: "cursor_ahead_of_stream",
        latestCursor,
      };
    }

    // If events were evicted, any cursor strictly before (oldestRetainedCursor - 1)
    // cannot be replayed completely.
    if (this.events.length > 0 && parsedCursor < this.oldestRetainedCursor - 1) {
      return {
        status: "RESYNC_REQUIRED",
        reason: "cursor_expired",
        latestCursor,
      };
    }

    const matching = this.events.filter(
      (ev) => ev.venueId === venueId && ev.cursor > parsedCursor,
    );

    return {
      status: "OK",
      events: matching,
      latestCursor,
    };
  }

  public getLatestCursor(): number {
    return this.nextCursor - 1;
  }
}

export const defaultReservationReplayLog = new SharedReservationReplayLog();
