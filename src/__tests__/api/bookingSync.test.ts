import { POST } from "@/app/api/bookings/sync/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

describe("Issue #9515 - Authoritative Offline Booking Synchronization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when request is unauthenticated", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: null });

    const req = new NextRequest("http://localhost:3000/api/bookings/sync", {
      method: "POST",
      body: JSON.stringify({
        draftId: "b-001",
        draftPayload: { customerPhone: "+15551234567" },
        serverVersion: 1,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 400 when draftId or draftPayload is missing", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });

    // Missing draftId
    let req = new NextRequest("http://localhost:3000/api/bookings/sync", {
      method: "POST",
      body: JSON.stringify({
        draftPayload: { customerPhone: "+15551234567" },
        serverVersion: 1,
      }),
    });
    let res = await POST(req);
    expect(res.status).toBe(400);

    // Missing draftPayload
    req = new NextRequest("http://localhost:3000/api/bookings/sync", {
      method: "POST",
      body: JSON.stringify({
        draftId: "b-001",
        serverVersion: 1,
      }),
    });
    res = await POST(req);
    expect(res.status).toBe(400);

    // Missing serverVersion
    req = new NextRequest("http://localhost:3000/api/bookings/sync", {
      method: "POST",
      body: JSON.stringify({
        draftId: "b-001",
        draftPayload: { customerPhone: "+15551234567" },
      }),
    });
    res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when attempting to modify protected fields (status, seatId, userId, price)", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });

    const req = new NextRequest("http://localhost:3000/api/bookings/sync", {
      method: "POST",
      body: JSON.stringify({
        draftId: "b-001",
        draftPayload: {
          status: "COMPLETED", // Protected
          price: 0, // Protected
        },
        serverVersion: 1,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Attempt to modify protected field");
  });

  it("returns 400 when draftPayload contains unknown or unmodifiable fields", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });

    const req = new NextRequest("http://localhost:3000/api/bookings/sync", {
      method: "POST",
      body: JSON.stringify({
        draftId: "b-001",
        draftPayload: {
          arbitraryInjection: "hacked",
        },
        serverVersion: 1,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain(
      "Invalid or unmodifiable field in draftPayload",
    );
  });

  it("returns 404 when booking is not found or owned by a different user", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest("http://localhost:3000/api/bookings/sync", {
      method: "POST",
      body: JSON.stringify({
        draftId: "b-other-user",
        draftPayload: { customerPhone: "+15551234567" },
        serverVersion: 1,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Booking not found");
  });

  it("successfully updates booking with optimistic lock and increments version", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    const existingBooking = {
      id: "b-001",
      userId: "user_123",
      customerEmail: "user@example.com",
      customerPhone: "+15551111111",
      projectBillingCode: "PROJ-A",
      amenitiesNeeded: ["WIFI"],
      status: "CONFIRMED",
      version: 1,
    };
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue(existingBooking);
    (prisma.booking.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

    const req = new NextRequest("http://localhost:3000/api/bookings/sync", {
      method: "POST",
      body: JSON.stringify({
        draftId: "b-001",
        draftPayload: {
          customerPhone: "+15559999999",
          amenitiesNeeded: ["WIFI", "WHITEBOARD"],
        },
        serverVersion: 1,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.action).toBe("MERGED");
    expect(json.newVersion).toBe(2);
    expect(json.resolvedPayload.customerPhone).toBe("+15559999999");
    expect(json.resolvedPayload.amenitiesNeeded).toEqual([
      "WIFI",
      "WHITEBOARD",
    ]);

    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: "b-001",
        userId: "user_123",
        version: 1,
      },
      data: {
        customerPhone: "+15559999999",
        amenitiesNeeded: ["WIFI", "WHITEBOARD"],
        version: 2,
      },
    });
  });

  it("returns 409 Conflict when client submits a stale version", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    const existingBooking = {
      id: "b-001",
      userId: "user_123",
      customerEmail: "user@example.com",
      customerPhone: "+15559999999",
      projectBillingCode: "PROJ-A",
      amenitiesNeeded: ["WIFI"],
      status: "CONFIRMED",
      version: 3, // Server is already at version 3
    };
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue(existingBooking);

    const req = new NextRequest("http://localhost:3000/api/bookings/sync", {
      method: "POST",
      body: JSON.stringify({
        draftId: "b-001",
        draftPayload: {
          customerPhone: "+15550000000",
        },
        serverVersion: 1, // Stale version 1
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("Conflict: Stale version");
    expect(json.serverVersion).toBe(3);
    expect(json.currentServerState).toBeDefined();
    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
  });

  it("handles idempotent retries when payload matches current server state", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    const existingBooking = {
      id: "b-001",
      userId: "user_123",
      customerEmail: "user@example.com",
      customerPhone: "+15559999999",
      projectBillingCode: "PROJ-A",
      amenitiesNeeded: ["WIFI"],
      status: "CONFIRMED",
      version: 2,
    };
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue(existingBooking);

    // Client retries with version 1, but customerPhone is already +15559999999 on server
    const req = new NextRequest("http://localhost:3000/api/bookings/sync", {
      method: "POST",
      body: JSON.stringify({
        draftId: "b-001",
        draftPayload: {
          customerPhone: "+15559999999",
        },
        serverVersion: 1,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.action).toBe("MERGED");
    expect(json.newVersion).toBe(2);
    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
  });

  it("returns 409 Conflict when concurrent update race occurs (updateMany count is 0)", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    const existingBooking = {
      id: "b-001",
      userId: "user_123",
      customerEmail: "user@example.com",
      customerPhone: "+15551111111",
      status: "CONFIRMED",
      version: 1,
    };
    (prisma.booking.findUnique as jest.Mock).mockResolvedValue(existingBooking);
    // Concurrent transaction updated version between findUnique and updateMany
    (prisma.booking.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

    const req = new NextRequest("http://localhost:3000/api/bookings/sync", {
      method: "POST",
      body: JSON.stringify({
        draftId: "b-001",
        draftPayload: { customerPhone: "+15552222222" },
        serverVersion: 1,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("Conflict: Concurrent modification detected");
  });
});
