import { POST } from "@/app/api/venues/[venueId]/check-in/bulk/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { invalidateVenueAvailability } from "@/lib/cache/venueAvailabilityCache";
import { NextRequest } from "next/server";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/cache/venueAvailabilityCache", () => ({
  invalidateVenueAvailability: jest.fn().mockResolvedValue(true),
  venueAvailabilityCacheKey: (venueId: string) =>
    `venue:availability:${venueId}`,
}));

describe("POST /api/venues/[venueId]/check-in/bulk availability cache", () => {
  const booking = {
    id: "clbooking12345678901234567",
    userId: "user-1",
    status: "CONFIRMED",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (auth as jest.Mock).mockResolvedValue({
      userId: "manager-1",
      sessionClaims: { metadata: { role: "manager" } },
    });
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue({
      id: "venue-1",
      name: "Venue",
      ownerId: "manager-1",
      creatorId: null,
    });
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback) =>
      callback({
        booking: {
          findMany: jest.fn().mockResolvedValue([booking]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        checkIn: { upsert: jest.fn().mockResolvedValue({}) },
      }),
    );
  });

  function request() {
    return new NextRequest(
      "http://localhost/api/venues/venue-1/check-in/bulk",
      {
        method: "POST",
        body: JSON.stringify({ bookingIds: [booking.id] }),
      },
    );
  }

  it("invalidates availability only after a check-in transaction succeeds", async () => {
    let committed = false;
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
      const result = await callback({
        booking: {
          findMany: jest.fn().mockResolvedValue([booking]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        checkIn: { upsert: jest.fn().mockResolvedValue({}) },
      });
      committed = true;
      return result;
    });
    (invalidateVenueAvailability as jest.Mock).mockImplementation(() => {
      expect(committed).toBe(true);
      return Promise.resolve(true);
    });

    const response = await POST(request(), {
      params: Promise.resolve({ venueId: "venue-1" }),
    });

    expect(response.status).toBe(200);
    expect(invalidateVenueAvailability).toHaveBeenCalledWith(
      "venue:availability:venue-1",
    );
  });

  it("does not invalidate if the transaction fails", async () => {
    (prisma.$transaction as jest.Mock).mockRejectedValue(
      new Error("transaction failed"),
    );

    const response = await POST(request(), {
      params: Promise.resolve({ venueId: "venue-1" }),
    });

    expect(response.status).toBe(500);
    expect(invalidateVenueAvailability).not.toHaveBeenCalled();
  });
});
