import { calculateDistanceMeters, Coordinates } from '../geo/geofence';

// In-memory or Redis-backed state tracker for exit durations
const exitTrackingMap = new Map<string, { startTime: number; venueId: string }>();

// SSE clients broadcaster registry
const sseClients = new Set<ReadableStreamDefaultController>();

export function registerSseClient(controller: ReadableStreamDefaultController) {
  sseClients.add(controller);
}

export function unregisterSseClient(controller: ReadableStreamDefaultController) {
  sseClients.delete(controller);
}

export function broadcastAvailabilityUpdate(venueId: string, deskId: string, status: string) {
  const payload = JSON.stringify({ type: 'AVAILABILITY_UPDATE', venueId, deskId, status, timestamp: Date.now() });
  for (const client of sseClients) {
    try {
      client.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

interface ProcessGeofenceExitParams {
  bookingId: string;
  deskId: string;
  venueId: string;
  userCoords: Coordinates;
  venueCoords: Coordinates;
}

export async function processGeofenceExitCheck({
  bookingId,
  deskId,
  venueId,
  userCoords,
  venueCoords,
}: ProcessGeofenceExitParams): Promise<{ status: string; message: string }> {
  const distance = calculateDistanceMeters(userCoords, venueCoords);
  const GEOFENCE_THRESHOLD_METERS = 250;
  const DURATION_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

  if (distance <= GEOFENCE_THRESHOLD_METERS) {
    // User is back within boundary, clear exit timer
    exitTrackingMap.delete(bookingId);
    return { status: 'INSIDE', message: 'User is within venue geofence boundary.' };
  }

  const now = Date.now();
  let tracking = exitTrackingMap.get(bookingId);

  if (!tracking || tracking.venueId !== venueId) {
    // First detection outside boundary
    exitTrackingMap.set(bookingId, { startTime: now, venueId });
    return {
      status: 'OUTSIDE_PENDING',
      message: `User is ${Math.round(distance)}m away. Exit timer started.`,
    };
  }

  const elapsedTime = now - tracking.startTime;

  if (elapsedTime > DURATION_THRESHOLD_MS) {
    // Exceeded 30 minutes outside boundary -> Complete booking and release desk
    exitTrackingMap.delete(bookingId);

    // TODO: Update database booking status to COMPLETED and free desk
    // await db.booking.update({ where: { id: bookingId }, data: { status: 'COMPLETED' } });

    // Broadcast real-time availability via SSE
    broadcastAvailabilityUpdate(venueId, deskId, 'AVAILABLE');

    return {
      status: 'COMPLETED',
      message: 'Booking automatically completed due to extended absence. Desk released.',
    };
  }

  return {
    status: 'OUTSIDE_COUNTDOWN',
    message: `User outside boundary for ${Math.round(elapsedTime / 1000)}s. Threshold is 30 mins.`,
  };
}