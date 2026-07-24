import { POST } from "@/app/api/reservations/book/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: jest.fn().mockResolvedValue({ id: "user_test_123" }),
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
  getRateLimitInfo: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/lib/reservations/event-bus", () => ({
  publishVenueAvailability: jest.fn(),
}));

jest.mock("@/core/events", () => ({
  eventBus: {
    emit: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    off: jest.fn(),
  },
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
  },
}));

describe("POST /api/reservations/book — Concurrent Seat Reservations & Transaction Locking (#1430)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth as unknown as jest.Mock).mockResolvedValue({
      userId: "user_123",
    });
  });

  it("enforces Serializable isolation level and executes SELECT FOR UPDATE locking", async () => {
    const mockTx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      seat: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: "seat_1", venueId: "venue_1", seatNumber: "A1" },
          ]),
      },
      booking: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: "booking_1",
            ...data,
            venue: { name: "Test Venue", address: "123 Main St" },
            seat: { id: "seat_1", seatNumber: "A1" },
          }),
        ),
      },
    };

    (prisma.$transaction as jest.Mock).mockImplementation(
      async (callback: any, options: any) => {
        expect(options?.isolationLevel).toBe(
          Prisma.TransactionIsolationLevel.Serializable,
        );
        return callback(mockTx);
      },
    );

    const req = new NextRequest("http://localhost:3000/api/reservations/book", {
      method: "POST",
      body: JSON.stringify({
        venueId: "venue_1",
        seatId: "seat_1",
        date: "2026-08-01",
        time: "10:00",
        duration: 60,
      }),
    });

    const res = await POST(req);
    expect(res!.status).toBe(201);
    expect(
      mockTx.$executeRawUnsafe.mock.calls.length +
        mockTx.$executeRaw.mock.calls.length,
    ).toBeGreaterThan(0);
  });

  it("returns 409 Conflict when a seat reservation overlaps with an existing booking", async () => {
    const mockTx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      seat: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: "seat_1", venueId: "venue_1", seatNumber: "A1" },
          ]),
      },
      booking: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ time: "10:00", duration: 60 }]),
        create: jest.fn(),
      },
    };

    (prisma.$transaction as jest.Mock).mockImplementation(
      async (callback: any) => callback(mockTx),
    );

    const req = new NextRequest("http://localhost:3000/api/reservations/book", {
      method: "POST",
      body: JSON.stringify({
        venueId: "venue_1",
        seatId: "seat_1",
        date: "2026-08-01",
        time: "10:30", // overlaps with 10:00-11:00
        duration: 60,
      }),
    });

    const res = await POST(req);
    const json = await res!.json();

    expect(res!.status).toBe(409);
    expect(json.error).toContain("reserved");
  });

  it("retries automatically on transient serialization failure (P2034)", async () => {
    let attempts = 0;
    const p2034Error = new Error(
      "Transaction failed due to serialization failure",
    );
    (p2034Error as any).code = "P2034";

    const mockTx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      seat: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: "seat_1", venueId: "venue_1", seatNumber: "A1" },
          ]),
      },
      booking: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: "booking_retry_1",
            ...data,
            venue: { name: "Test Venue", address: "123 Main St" },
            seat: { id: "seat_1", seatNumber: "A1" },
          }),
        ),
      },
    };

    (prisma.$transaction as jest.Mock).mockImplementation(
      async (callback: any) => {
        attempts++;
        if (attempts === 1) {
          throw p2034Error;
        }
        return callback(mockTx);
      },
    );

    const req = new NextRequest("http://localhost:3000/api/reservations/book", {
      method: "POST",
      body: JSON.stringify({
        venueId: "venue_1",
        seatId: "seat_1",
        date: "2026-08-01",
        time: "14:00",
        duration: 60,
      }),
    });

    const res = await POST(req);
    expect(res!.status).toBe(201);
    expect(attempts).toBe(2);
  });
});
