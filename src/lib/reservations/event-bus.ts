type Listener = (payload: string) => void;

const venueListeners = new Map<string, Set<Listener>>();

export function publishVenueAvailability(venueId: string, event: object) {
  const payload = JSON.stringify({
    ...event,
    venueId,
    timestamp: Date.now(),
  });

  const listeners = venueListeners.get(venueId);

  if (!listeners) return;

  for (const listener of listeners) {
    listener(payload);
  }
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
