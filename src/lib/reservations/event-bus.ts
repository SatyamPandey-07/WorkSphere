import {
  defaultReservationReplayLog,
  type ReplayResult,
} from "@/lib/reservations/replayableStream";

type Listener = (payload: string) => void;

const venueListeners = new Map<string, Set<Listener>>();

export function publishVenueAvailability(venueId: string, event: object) {
  const timestamp = Date.now();
  const envelope = defaultReservationReplayLog.publish({
    eventId: `evt_${timestamp}_${Math.random().toString(36).slice(2, 8)}`,
    venueId,
    type:
      typeof (event as Record<string, unknown>).type === "string"
        ? ((event as Record<string, unknown>).type as string)
        : "AVAILABILITY_UPDATED",
    occurredAt: timestamp,
    payload: {
      ...event,
      venueId,
      timestamp,
    },
  });

  const payload = JSON.stringify({
    ...event,
    venueId,
    timestamp,
    ...(envelope ? { cursor: envelope.cursor, eventId: envelope.eventId } : {}),
  });

  const listeners = venueListeners.get(venueId);

  if (!listeners) return;

  for (const listener of listeners) {
    listener(payload);
  }
}

export function replayVenueAvailabilityAfter(
  venueId: string,
  lastEventId: string,
): ReplayResult {
  return defaultReservationReplayLog.replayAfter(venueId, lastEventId);
}

export function subscribeVenueAvailability(
  venueId: string,
  listener: Listener,
) {
  const listeners = venueListeners.get(venueId) ?? new Set<Listener>();
  listeners.add(listener);
  venueListeners.set(venueId, listeners);

  return () => {
    const current = venueListeners.get(venueId);
    current?.delete(listener);

    if (current?.size === 0) {
      venueListeners.delete(venueId);
    }
  };
}

/**
 * Publishes a desk countdown expiration event across the venue availability bus.
 */
export function publishDeskCountdownExpired(
  venueId: string,
  deskId: string,
  seatId?: string,
) {
  publishVenueAvailability(venueId, {
    type: "DESK_HOLD_EXPIRED",
    deskId,
    seatId: seatId || deskId,
    timestamp: Date.now(),
  });
}

/**
 * Publishes a desk countdown acquisition event across the venue availability bus.
 */
export function publishDeskCountdownAcquired(
  venueId: string,
  deskId: string,
  expiresAt: number,
  seatId?: string,
) {
  publishVenueAvailability(venueId, {
    type: "DESK_HOLD_ACQUIRED",
    deskId,
    seatId: seatId || deskId,
    expiresAt,
    timestamp: Date.now(),
  });
}
