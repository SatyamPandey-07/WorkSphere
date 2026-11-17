/**
 * @jest-environment node
 */
import { POST } from "@/app/api/bookings/bundles/route";
import { prisma } from "@/lib/prisma";
import { invalidateVenueAvailability } from "@/lib/cache/venueAvailabilityCache";
import { NextRequest } from "next/server";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: { findMany: jest.fn() },
    booking: { create: jest.fn() },
  },
}));

jest.mock("@/lib/cache/venueAvailabilityCache", () => ({
  invalidateVenueAvailability: jest.fn().mockResolvedValue(true),
  venueAvailabilityCacheKey: (venueId: string) =>
    `venue:availability:${venueId}`,
}));

jest.mock("@/lib/bundles/workHopEngine", () => ({
  calculateRevenueAttribution: jest.fn((_, legs) =>
    legs.map(({ venueId }: { venueId: string }) => ({
      venueId,
      allocatedRevenue: 1,
    })),
  ),
  generateWorkHopPassToken: jest.fn().mockReturnValue("test-qr-token"),
}));

describe("POST /api/bookings/bundles availability cache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.venue.findMany as jest.Mock).mockResolvedValue([
      { id: "venue_1", name: "Venue 1", category: "coworking", address: null },
      { id: "venue_2", name: "Venue 2", category: "coworking", address: null },
    ]);
    (prisma.booking.create as jest.Mock).mockImplementation(({ data }) =>
      Promise.resolve({ id: `booking_${data.venueId}`, ...data }),
    );
  });

  it("invalidates availability for each successfully booked seat venue", async () => {
    const request = new NextRequest("http://localhost/api/bookings/bundles", {
      method: "POST",
      body: JSON.stringify({
        userId: "user_1",
        date: "2026-12-01",
        customerEmail: "user@example.com",
        legs: [
          { venueId: "venue_1", seatId: "seat_1" },
          { venueId: "venue_2", seatId: "seat_2" },
        ],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(invalidateVenueAvailability).toHaveBeenCalledTimes(2);
    expect(invalidateVenueAvailability).toHaveBeenCalledWith(
      "venue:availability:venue_1",
    );
    expect(invalidateVenueAvailability).toHaveBeenCalledWith(
      "venue:availability:venue_2",
    );
  });

  it("does not invalidate venues whose bundle legs do not reserve a seat", async () => {
    const request = new NextRequest("http://localhost/api/bookings/bundles", {
      method: "POST",
      body: JSON.stringify({
        userId: "user_1",
        date: "2026-12-01",
        customerEmail: "user@example.com",
        legs: [{ venueId: "venue_1" }, { venueId: "venue_2" }],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(invalidateVenueAvailability).not.toHaveBeenCalled();
  });
});
