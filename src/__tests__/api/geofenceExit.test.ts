import { POST } from "@/app/api/checkin/geofence-exit/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { processGeofenceExitCheck } from "@/lib/reservations/deskManager";
import { NextRequest } from "next/server";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock("@/lib/reservations/deskManager", () => ({
  processGeofenceExitCheck: jest.fn(),
}));

describe("Issue #9513 - Geofence Booking Ownership & Coordinate Validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when request is unauthenticated", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: null });

    const req = new NextRequest(
      "http://localhost:3000/api/checkin/geofence-exit",
      {
        method: "POST",
        body: JSON.stringify({
          bookingId: "b-001",
          userCoords: { latitude: 37.7749, longitude: -122.4194 },
        }),
      },
    );

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("Unauthorized");
  });

  it("returns 400 when bookingId is missing", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });

    const req = new NextRequest(
      "http://localhost:3000/api/checkin/geofence-exit",
      {
        method: "POST",
        body: JSON.stringify({
          userCoords: { latitude: 37.7749, longitude: -122.4194 },
        }),
      },
    );

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Missing required parameter: bookingId");
  });

  it("returns 400 when user coordinates are invalid or out of range", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });

    // Latitude out of range (> 90)
    let req = new NextRequest(
      "http://localhost:3000/api/checkin/geofence-exit",
      {
        method: "POST",
        body: JSON.stringify({
          bookingId: "b-001",
          userCoords: { latitude: 95.0, longitude: -122.4194 },
        }),
      },
    );
    let res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Invalid user coordinates");

    // Longitude out of range (< -180)
    req = new NextRequest("http://localhost:3000/api/checkin/geofence-exit", {
      method: "POST",
      body: JSON.stringify({
        bookingId: "b-001",
        userCoords: { latitude: 37.7749, longitude: -195.0 },
      }),
    });
    res = await POST(req);
    expect(res.status).toBe(400);

    // Non-finite or missing coordinates
    req = new NextRequest("http://localhost:3000/api/checkin/geofence-exit", {
      method: "POST",
      body: JSON.stringify({
        bookingId: "b-001",
        userCoords: { latitude: NaN, longitude: -122.4194 },
      }),
    });
    res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when booking is not found or owned by another user", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    (prisma.booking.findFirst as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest(
      "http://localhost:3000/api/checkin/geofence-exit",
      {
        method: "POST",
        body: JSON.stringify({
          bookingId: "b-other-user",
          userCoords: { latitude: 37.7749, longitude: -122.4194 },
        }),
      },
    );

    const res = await POST(req);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Booking not found.");
    expect(prisma.booking.findFirst).toHaveBeenCalledWith({
      where: { id: "b-other-user", userId: "user_123" },
      include: { venue: true },
    });
  });

  it("returns 400 when booking is not in an active state (e.g. COMPLETED or CANCELLED)", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    (prisma.booking.findFirst as jest.Mock).mockResolvedValue({
      id: "b-001",
      userId: "user_123",
      status: "COMPLETED",
      venueId: "v-001",
      venue: { latitude: 37.7749, longitude: -122.4194 },
    });

    const req = new NextRequest(
      "http://localhost:3000/api/checkin/geofence-exit",
      {
        method: "POST",
        body: JSON.stringify({
          bookingId: "b-001",
          userCoords: { latitude: 37.7749, longitude: -122.4194 },
        }),
      },
    );

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Booking is not in an active state");
  });

  it("derives venue coordinates and deskId authoritatively from database and processes exit check", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    (prisma.booking.findFirst as jest.Mock).mockResolvedValue({
      id: "b-001",
      userId: "user_123",
      status: "CHECKED_IN",
      seatId: "seat-desk-42",
      venueId: "v-001",
      venue: {
        latitude: 37.7749,
        longitude: -122.4194,
      },
    });

    (processGeofenceExitCheck as jest.Mock).mockResolvedValue({
      status: "INSIDE",
      message: "User is within venue geofence boundary.",
    });

    const req = new NextRequest(
      "http://localhost:3000/api/checkin/geofence-exit",
      {
        method: "POST",
        body: JSON.stringify({
          bookingId: "b-001",
          // Client attempts to pass spoofed venueCoords and deskId
          deskId: "spoofed-desk",
          venueCoords: { latitude: 0, longitude: 0 },
          userCoords: { latitude: 37.775, longitude: -122.4195 },
        }),
      },
    );

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.status).toBe("INSIDE");

    // Verify processGeofenceExitCheck received authoritative database coordinates and seatId
    expect(processGeofenceExitCheck).toHaveBeenCalledWith({
      bookingId: "b-001",
      deskId: "seat-desk-42", // Derived from booking.seatId
      venueId: "v-001", // Derived from booking.venueId
      userCoords: { latitude: 37.775, longitude: -122.4195 },
      venueCoords: { latitude: 37.7749, longitude: -122.4194 }, // Derived from booking.venue
    });
  });
});
