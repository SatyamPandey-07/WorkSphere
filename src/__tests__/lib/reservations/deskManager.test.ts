import {
  processGeofenceExitCheck,
  registerSseClient,
  unregisterSseClient,
} from "@/lib/reservations/deskManager";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

describe("Issue #9514 - Durable Geofence Tracking & Atomic Booking Completion", () => {
  const venueCoords = { latitude: 37.7749, longitude: -122.4194 };
  // ~500 meters away (outside 250m threshold)
  const outsideCoords = { latitude: 37.7794, longitude: -122.4194 };
  // ~50 meters away (inside 250m threshold)
  const insideCoords = { latitude: 37.7752, longitude: -122.4194 };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("persists first exit timestamp in database when user exits geofence", async () => {
    const booking = {
      id: "b-001",
      venueId: "v-001",
      seatId: "seat-1",
      status: "CHECKED_IN",
      geofenceExitAt: null,
    };
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue(booking);
    (prisma.booking.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

    const result = await processGeofenceExitCheck({
      bookingId: "b-001",
      deskId: "seat-1",
      venueId: "v-001",
      userCoords: outsideCoords,
      venueCoords,
    });

    expect(result.status).toBe("OUTSIDE_PENDING");
    expect(result.message).toContain("Exit timer started");
    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: "b-001",
        geofenceExitAt: null,
        status: { in: ["CONFIRMED", "PENDING", "CHECKED_IN"] },
      },
      data: { geofenceExitAt: expect.any(Date) },
    });
  });

  it("calculates countdown from persisted timestamp during continued absence under 30 minutes", async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const booking = {
      id: "b-001",
      venueId: "v-001",
      seatId: "seat-1",
      status: "CHECKED_IN",
      geofenceExitAt: tenMinutesAgo,
    };
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue(booking);

    const result = await processGeofenceExitCheck({
      bookingId: "b-001",
      deskId: "seat-1",
      venueId: "v-001",
      userCoords: outsideCoords,
      venueCoords,
    });

    expect(result.status).toBe("OUTSIDE_COUNTDOWN");
    expect(result.message).toContain("Threshold is 30 mins");
    // No status change yet
    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
  });

  it("resets persisted exit tracking in database when user returns inside geofence", async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const booking = {
      id: "b-001",
      venueId: "v-001",
      seatId: "seat-1",
      status: "CHECKED_IN",
      geofenceExitAt: fiveMinutesAgo,
    };
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue(booking);
    (prisma.booking.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

    const result = await processGeofenceExitCheck({
      bookingId: "b-001",
      deskId: "seat-1",
      venueId: "v-001",
      userCoords: insideCoords,
      venueCoords,
    });

    expect(result.status).toBe("INSIDE");
    expect(result.message).toContain("within venue geofence boundary");
    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: "b-001", geofenceExitAt: { not: null } },
      data: { geofenceExitAt: null },
    });
  });

  it("atomically completes booking and broadcasts availability when absence exceeds 30 minutes", async () => {
    const thirtyFiveMinutesAgo = new Date(Date.now() - 35 * 60 * 1000);
    const booking = {
      id: "b-001",
      venueId: "v-001",
      seatId: "seat-1",
      status: "CHECKED_IN",
      geofenceExitAt: thirtyFiveMinutesAgo,
    };
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue(booking);
    (prisma.booking.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

    const mockController = {
      enqueue: jest.fn(),
    } as unknown as ReadableStreamDefaultController;
    registerSseClient(mockController);

    const result = await processGeofenceExitCheck({
      bookingId: "b-001",
      deskId: "seat-1",
      venueId: "v-001",
      userCoords: outsideCoords,
      venueCoords,
    });

    expect(result.status).toBe("COMPLETED");
    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: "b-001",
        status: { in: ["CONFIRMED", "PENDING", "CHECKED_IN"] },
      },
      data: {
        status: "COMPLETED",
        geofenceExitAt: null,
      },
    });

    // Verified SSE broadcast occurred after successful atomic completion
    expect(mockController.enqueue).toHaveBeenCalled();
    const enqueuedPayload = (mockController.enqueue as jest.Mock).mock
      .calls[0][0];
    const decoded = new TextDecoder().decode(enqueuedPayload);
    expect(decoded).toContain("AVAILABILITY_UPDATE");
    expect(decoded).toContain('"status":"AVAILABLE"');
    expect(decoded).toContain('"deskId":"seat-1"');

    unregisterSseClient(mockController);
  });

  it("does not broadcast duplicate availability updates if atomic update count is 0 (idempotent / race guard)", async () => {
    const thirtyFiveMinutesAgo = new Date(Date.now() - 35 * 60 * 1000);
    const booking = {
      id: "b-001",
      venueId: "v-001",
      seatId: "seat-1",
      status: "CHECKED_IN",
      geofenceExitAt: thirtyFiveMinutesAgo,
    };
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue(booking);
    // Concurrent request or instance already completed the booking
    (prisma.booking.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

    const mockController = {
      enqueue: jest.fn(),
    } as unknown as ReadableStreamDefaultController;
    registerSseClient(mockController);

    const result = await processGeofenceExitCheck({
      bookingId: "b-001",
      deskId: "seat-1",
      venueId: "v-001",
      userCoords: outsideCoords,
      venueCoords,
    });

    expect(result.status).toBe("COMPLETED");
    // Broadcast must NOT be called again
    expect(mockController.enqueue).not.toHaveBeenCalled();

    unregisterSseClient(mockController);
  });

  it("does not broadcast availability if database transaction throws an error", async () => {
    const thirtyFiveMinutesAgo = new Date(Date.now() - 35 * 60 * 1000);
    const booking = {
      id: "b-001",
      venueId: "v-001",
      seatId: "seat-1",
      status: "CHECKED_IN",
      geofenceExitAt: thirtyFiveMinutesAgo,
    };
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue(booking);
    (prisma.booking.updateMany as jest.Mock).mockRejectedValue(
      new Error("Database connection dropped"),
    );

    const mockController = {
      enqueue: jest.fn(),
    } as unknown as ReadableStreamDefaultController;
    registerSseClient(mockController);

    await expect(
      processGeofenceExitCheck({
        bookingId: "b-001",
        deskId: "seat-1",
        venueId: "v-001",
        userCoords: outsideCoords,
        venueCoords,
      }),
    ).rejects.toThrow("Database connection dropped");

    // Must NOT broadcast after DB failure
    expect(mockController.enqueue).not.toHaveBeenCalled();

    unregisterSseClient(mockController);
  });
});
