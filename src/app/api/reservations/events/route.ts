import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEARTBEAT_INTERVAL_MS = 15_000;

export interface ReservationAvailabilityEvent {
  type: 'connected' | 'availability_update' | 'heartbeat';
  venueId: string;
  availableSeats?: number;
  crowdLevel?: 'QUIET' | 'MODERATE' | 'BUSY';
  timestamp: string;
}

type VenueEventListener = (event: ReservationAvailabilityEvent) => void;

// In-process pub/sub registry for reservation availability broadcasts
const globalForSse = globalThis as unknown as {
  __worksphereReservationListeners?: Map<string, Set<VenueEventListener>>;
};

const venueListeners =
  globalForSse.__worksphereReservationListeners ??
  new Map<string, Set<VenueEventListener>>();

if (!globalForSse.__worksphereReservationListeners) {
  globalForSse.__worksphereReservationListeners = venueListeners;
}

export function subscribeToVenueReservations(
  venueId: string,
  listener: VenueEventListener
): () => void {
  let listeners = venueListeners.get(venueId);
  if (!listeners) {
    listeners = new Set<VenueEventListener>();
    venueListeners.set(venueId, listeners);
  }
  listeners.add(listener);

  return () => {
    const current = venueListeners.get(venueId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      venueListeners.delete(venueId);
    }
  };
}

export function publishVenueReservationEvent(
  event: ReservationAvailabilityEvent
): void {
  const listeners = venueListeners.get(event.venueId);
  if (!listeners) return;
  for (const listener of listeners) {
    listener(event);
  }
}

function encodeSseFrame(payload: ReservationAvailabilityEvent): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(
    `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`
  );
}

export async function GET(request: NextRequest) {
  const venueId = request.nextUrl.searchParams.get('venueId')?.trim();

  if (!venueId) {
    return NextResponse.json(
      { error: 'Missing required query parameter: venueId' },
      { status: 400 }
    );
  }

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  let isClosed = false;

  const cleanup = () => {
    if (isClosed) {
      return;
    }
    isClosed = true;

    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }

    if (unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
    }

    request.signal.removeEventListener('abort', onAbort);
  };

  const onAbort = () => {
    cleanup();
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (event: ReservationAvailabilityEvent) => {
        if (isClosed || request.signal.aborted) {
          cleanup();
          return;
        }

        try {
          controller.enqueue(encodeSseFrame(event));
        } catch {
          // Controller was closed externally; clean up timer and subscription immediately
          cleanup();
        }
      };

      // Subscribe to live venue seat availability updates
      unsubscribe = subscribeToVenueReservations(venueId, (event) => {
        safeEnqueue(event);
      });

      // Emit initial handshake frame
      safeEnqueue({
        type: 'connected',
        venueId,
        timestamp: new Date().toISOString(),
      });

      // Periodic keep-alive heartbeat
      heartbeat = setInterval(() => {
        safeEnqueue({
          type: 'heartbeat',
          venueId,
          timestamp: new Date().toISOString(),
        });
      }, HEARTBEAT_INTERVAL_MS);

      if (request.signal.aborted) {
        cleanup();
      } else {
        request.signal.addEventListener('abort', onAbort, { once: true });
      }
    },

    cancel() {
      // Clear active heartbeat interval and unsubscribe immediately when reader.cancel() is called
      cleanup();
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}