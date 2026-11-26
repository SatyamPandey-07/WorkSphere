import { NextRequest } from "next/server";
import { POST } from "@/app/api/venues/[venueId]/check-in/bulk/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findFirst: jest.fn(),
    },
    booking: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    checkIn: {
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/cache/venueAvailabilityCache", () => ({
  invalidateVenueAvailability: jest.fn().mockResolvedValue(undefined),
  venueAvailabilityCacheKey: jest.fn((id) => `venue-avail:${id}`),
}));

describe("Bulk Check-in Occupancy Transactional Consistency (#9854)", () => {
  const venueId = "venue-cuid-123";
  const bookingCuid1 = "c123456789012345678901234";
  const bookingCuid2 = "c123456789012345678901235";
  const routeContext = { params: Promise.resolve({ venueId }) };

  beforeEach(() => {
    jest.clearAllMocks();

    (auth as unknown as jest.Mock).mockResolvedValue({
      userId: "manager-user-id",
      sessionClaims: { metadata: { role: "manager" } },
    });

    (prisma.venue.findFirst as jest.Mock).mockResolvedValue({
      id: venueId,
      name: "Tokyo Work Central",
      ownerId: "manager-user-id",
    });
  });

  it("does not update booking status to CHECKED_IN when occupancy record creation fails", async () => {
    const mockBookings = [
      {
        id: bookingCuid1,
        userId: "user-1",
        venueId,
        status: "CONFIRMED",
      },
    ];

    const mockUpdateMany = jest.fn();

    // Mock transaction where checkIn.upsert fails
    (prisma.$transaction as jest.Mock).mockImplementationOnce(
      async (callback) => {
        const tx = {
          booking: {
            findMany: jest.fn().mockResolvedValue(mockBookings),
            updateMany: mockUpdateMany,
          },
          checkIn: {
            upsert: jest
              .fn()
              .mockRejectedValue(new Error("CheckIn constraint violation")),
          },
        };
        return callback(tx);
      },
    );

    const req = new NextRequest(
      `http://localhost/api/venues/${venueId}/check-in/bulk`,
      {
        method: "POST",
        body: JSON.stringify({
          bookingIds: [bookingCuid1],
        }),
      },
    );

    const res = await POST(req, routeContext);

    // Expect 500 error since transaction aborted
    expect(res.status).toBe(500);

    const data = await res.json();
    expect(data.error).toBe("Internal Server Error");
    expect(data.message).toContain("CheckIn constraint violation");

    // CRITICAL: booking.updateMany must NOT have been called!
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("atomically creates occupancy records and updates bookings on success", async () => {
    const mockBookings = [
      {
        id: bookingCuid1,
        userId: "user-1",
        venueId,
        status: "CONFIRMED",
      },
      {
        id: bookingCuid2,
        userId: "user-2",
        venueId,
        status: "CONFIRMED",
      },
    ];

    const mockUpdatedRows = [
      {
        id: bookingCuid1,
        userId: "user-1",
        venueId,
        status: "CHECKED_IN",
      },
      {
        id: bookingCuid2,
        userId: "user-2",
        venueId,
        status: "CHECKED_IN",
      },
    ];

    const mockUpsert = jest.fn().mockResolvedValue({});
    const mockUpdateMany = jest.fn().mockResolvedValue({ count: 2 });

    (prisma.$transaction as jest.Mock).mockImplementationOnce(
      async (callback) => {
        const tx = {
          booking: {
            findMany: jest
              .fn()
              .mockResolvedValueOnce(mockBookings)
              .mockResolvedValueOnce(mockUpdatedRows),
            updateMany: mockUpdateMany,
          },
          checkIn: {
            upsert: mockUpsert,
          },
        };
        return callback(tx);
      },
    );

    const req = new NextRequest(
      `http://localhost/api/venues/${venueId}/check-in/bulk`,
      {
        method: "POST",
        body: JSON.stringify({
          bookingIds: [bookingCuid1, bookingCuid2],
        }),
      },
    );

    const res = await POST(req, routeContext);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.successfulCount).toBe(2);

    // Both CheckIn occupancy records were created
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    // Booking statuses were updated
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        id: { in: [bookingCuid1, bookingCuid2] },
        venueId,
      },
      data: {
        status: "CHECKED_IN",
      },
    });
  });
});
