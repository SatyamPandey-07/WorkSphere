import {
  calculateDistanceMeters,
  Coordinates,
  GEOFENCE_RADIUS_METERS,
} from "../geo/geofence";
import { prisma } from "@/lib/prisma";

// SSE clients broadcaster registry
const sseClients = new Set<ReadableStreamDefaultController>();

export function registerSseClient(controller: ReadableStreamDefaultController) {
  sseClients.add(controller);
}

export function unregisterSseClient(
  controller: ReadableStreamDefaultController,
) {
  sseClients.delete(controller);
}

export function broadcastAvailabilityUpdate(
  venueId: string,
  deskId: string,
  status: string,
) {
  const payload = JSON.stringify({
    type: "AVAILABILITY_UPDATE",
    venueId,
    deskId,
    status,
    timestamp: Date.now(),
  });
  for (const client of sseClients) {
    try {
      client.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));
    } catch {
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
  const DURATION_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

  // Retrieve authoritative booking from database to check durable tracking state
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
  });

  if (!booking) {
    return { status: "NOT_FOUND", message: "Booking not found." };
  }

  // If booking is already completed or inactive, return immediately without duplicate transitions
  if (booking.status === "COMPLETED") {
    return {
      status: "COMPLETED",
      message: "Booking is already completed.",
    };
  }

  const activeStatuses = ["CONFIRMED", "PENDING", "CHECKED_IN"];
  if (!activeStatuses.includes(booking.status)) {
    return {
      status: "INACTIVE",
      message: `Booking is not active (current status: ${booking.status}).`,
    };
  }

  // Case 1: User is inside the geofence boundary
  if (distance <= GEOFENCE_RADIUS_METERS) {
    // If exit tracking was previously recorded, reset it in database
    if (booking.geofenceExitAt) {
      await prisma.booking.updateMany({
        where: { id: bookingId, geofenceExitAt: { not: null } },
        data: { geofenceExitAt: null },
      });
    }
    return {
      status: "INSIDE",
      message: "User is within venue geofence boundary.",
    };
  }

  // Case 2: User is outside the geofence boundary
  const now = Date.now();

  // Subcase 2A: First detection outside boundary -> Persist exit timestamp in database
  if (!booking.geofenceExitAt) {
    await prisma.booking.updateMany({
      where: {
        id: bookingId,
        geofenceExitAt: null,
        status: { in: ["CONFIRMED", "PENDING", "CHECKED_IN"] },
      },
      data: { geofenceExitAt: new Date(now) },
    });
    return {
      status: "OUTSIDE_PENDING",
      message: `User is ${Math.round(distance)}m away. Exit timer started.`,
    };
  }

  // Subcase 2B: Continued absence -> Calculate elapsed duration from persisted timestamp
  const startTime = new Date(booking.geofenceExitAt).getTime();
  const elapsedTime = now - startTime;

  if (elapsedTime > DURATION_THRESHOLD_MS) {
    // Exceeded 30 minutes outside boundary -> Atomically complete booking and release desk
    const updateResult = await prisma.booking.updateMany({
      where: {
        id: bookingId,
        status: { in: ["CONFIRMED", "PENDING", "CHECKED_IN"] },
      },
      data: {
        status: "COMPLETED",
        geofenceExitAt: null,
      },
    });

    // Broadcast real-time availability via SSE ONLY if this atomic transaction succeeded
    // This prevents repeated requests or concurrent instances from releasing the same seat multiple times
    if (updateResult.count > 0) {
      broadcastAvailabilityUpdate(venueId, deskId, "AVAILABLE");
    }

    return {
      status: "COMPLETED",
      message:
        "Booking automatically completed due to extended absence. Desk released.",
    };
  }

  return {
    status: "OUTSIDE_COUNTDOWN",
    message: `User outside boundary for ${Math.round(elapsedTime / 1000)}s. Threshold is 30 mins.`,
  };
}
