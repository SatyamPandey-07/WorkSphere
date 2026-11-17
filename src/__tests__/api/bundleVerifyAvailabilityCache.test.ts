import { POST } from "@/app/api/bookings/bundles/verify/route";
import { prisma } from "@/lib/prisma";
import { invalidateVenueAvailability } from "@/lib/cache/venueAvailabilityCache";
import { NextRequest } from "next/server";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("@/lib/bundles/workHopEngine", () => ({
  verifyWorkHopPassToken: jest.fn().mockReturnValue({
    isValid: true,
    userId: "user-1",
    bundleId: "bundle-1",
  }),
}));

jest.mock("@/lib/cache/venueAvailabilityCache", () => ({
  invalidateVenueAvailability: jest.fn().mockResolvedValue(true),
  venueAvailabilityCacheKey: (venueId: string) =>
    `venue:availability:${venueId}`,
}));

describe("POST /api/bookings/bundles/verify availability cache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.booking.findFirst as jest.Mock).mockResolvedValue({
      id: "booking-1",
      venueId: "venue-1",
      venue: { name: "Venue" },
    });
    (prisma.booking.update as jest.Mock).mockResolvedValue({
      id: "booking-1",
    });
  });

  it("invalidates availability after a successful check-in update", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/bookings/bundles/verify", {
        method: "POST",
        body: JSON.stringify({ qrToken: "token", venueId: "venue-1" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(invalidateVenueAvailability).toHaveBeenCalledWith(
      "venue:availability:venue-1",
    );
    expect(
      (prisma.booking.update as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(
      (invalidateVenueAvailability as jest.Mock).mock.invocationCallOrder[0],
    );
  });

  it("does not invalidate if the booking update fails", async () => {
    (prisma.booking.update as jest.Mock).mockRejectedValue(
      new Error("update failed"),
    );

    const response = await POST(
      new NextRequest("http://localhost/api/bookings/bundles/verify", {
        method: "POST",
        body: JSON.stringify({ qrToken: "token", venueId: "venue-1" }),
      }),
    );

    expect(response.status).toBe(500);
    expect(invalidateVenueAvailability).not.toHaveBeenCalled();
  });
});
