/**
 * @jest-environment node
 */
import { POST } from "@/app/api/reservations/recurring-book/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { invalidateVenueAvailability } from "@/lib/cache/venueAvailabilityCache";
import { NextRequest } from "next/server";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
  currentUser: jest.fn().mockResolvedValue({
    primaryEmailAddress: { emailAddress: "user@example.com" },
  }),
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
}));

jest.mock("@/lib/locks/seatHoldLock", () => ({
  releaseSeatWebLock: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/cache/venueAvailabilityCache", () => ({
  invalidateVenueAvailability: jest.fn().mockResolvedValue(true),
  venueAvailabilityCacheKey: (venueId: string) =>
    `venue:availability:${venueId}`,
}));

jest.mock("@/lib/reservations/event-bus", () => ({
  publishVenueAvailability: jest.fn(),
}));

jest.mock("@/lib/webhooks/deliver", () => ({
  emitWebhookEvent: jest.fn(),
}));

jest.mock("@/core/subscribers/booking", () => ({}));
jest.mock("@/core/subscribers/guests", () => ({}));

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
    venueSeat: { findFirst: jest.fn() },
    bookingGuest: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  },
}));

function request(date: string) {
  return new NextRequest(
    "http://localhost:3000/api/reservations/recurring-book",
    {
      method: "POST",
      body: JSON.stringify({
        venueId: "venue_1",
        seatId: "seat_1",
        date,
        time: "10:00",
        duration: 60,
        frequency: "weekly",
        occurrences: 1,
        customerEmail: "user@example.com",
      }),
    },
  );
}

describe("POST /api/reservations/recurring-book", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth as jest.Mock).mockResolvedValue({ userId: "user_123" });
    (prisma.venueSeat.findFirst as jest.Mock).mockResolvedValue({
      id: "seat_1",
      venueId: "venue_1",
      seatNumber: "A1",
      venue: { name: "Test Venue", category: "coworking", address: null },
    });
  });

  it("invalidates availability after each recurring reservation commits", async () => {
    const date = new Date(Date.now() + 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    let transactionCommitted = false;
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      booking: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: "booking_1",
          confirmationId: "WS-12345678",
        }),
      },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
      const result = await callback(tx);
      transactionCommitted = true;
      return result;
    });
    (invalidateVenueAvailability as jest.Mock).mockImplementation(() => {
      expect(transactionCommitted).toBe(true);
    });

    const response = await POST(request(date));

    expect(response.status).toBe(201);
    expect(invalidateVenueAvailability).toHaveBeenCalledWith(
      "venue:availability:venue_1",
    );
  });

  it("does not invalidate when a recurring reservation conflicts", async () => {
    const date = new Date(Date.now() + 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      booking: {
        findMany: jest.fn().mockResolvedValue([
          {
            date,
            time: "10:00",
            duration: 60,
            timeZone: "UTC",
          },
        ]),
        create: jest.fn(),
      },
    };
    (prisma.$transaction as jest.Mock).mockImplementation((callback) =>
      callback(tx),
    );

    const response = await POST(request(date));

    expect(response.status).toBe(201);
    expect((await response.json()).booked).toBe(0);
    expect(invalidateVenueAvailability).not.toHaveBeenCalled();
  });
});
