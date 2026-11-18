import { NextRequest } from "next/server";
import { POST, BulkCheckInSchema } from "@/app/api/venues/[venueId]/check-in/bulk/route";
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

describe("POST /api/venues/:venueId/check-in/bulk", () => {
  const venueId = "venue-cuid-123";
  const validCuid1 = "c123456789012345678901234";
  const validCuid2 = "c123456789012345678901235";
  const routeContext = { params: Promise.resolve({ venueId }) };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("BulkCheckInSchema Validation", () => {
    it("accepts valid bookingIds and optional metadata", () => {
      const validPayload = {
        bookingIds: [validCuid1, validCuid2],
        checkedInBy: "manager-alice",
        checkInTimestamp: "2026-11-10T14:30:00.000Z",
      };
      const result = BulkCheckInSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("rejects empty bookingIds array", () => {
      const result = BulkCheckInSchema.safeParse({
        bookingIds: [],
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-cuid booking IDs", () => {
      const result = BulkCheckInSchema.safeParse({
        bookingIds: ["not-a-cuid"],
      });
      expect(result.success).toBe(false);
    });

    it("rejects more than 50 booking IDs", () => {
      const excessiveIds = Array.from(
        { length: 51 },
        (_, i) => `c${String(i).padStart(24, "0")}`,
      );
      const result = BulkCheckInSchema.safeParse({
        bookingIds: excessiveIds,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Authentication & Venue Manager Verification", () => {
    it("returns 401 Unauthorized when not signed in", async () => {
      (auth as unknown as jest.Mock).mockResolvedValueOnce({ userId: null });

      const req = new NextRequest(
        `http://localhost/api/venues/${venueId}/check-in/bulk`,
        {
          method: "POST",
          body: JSON.stringify({ bookingIds: [validCuid1] }),
        },
      );

      const res = await POST(req, routeContext);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 404 Venue Not Found if venue does not exist", async () => {
      (auth as unknown as jest.Mock).mockResolvedValueOnce({
        userId: "user-manager-1",
        sessionClaims: { metadata: { role: "manager" } },
      });
      (prisma.venue.findFirst as jest.Mock).mockResolvedValueOnce(null);

      const req = new NextRequest(
        `http://localhost/api/venues/${venueId}/check-in/bulk`,
        {
          method: "POST",
          body: JSON.stringify({ bookingIds: [validCuid1] }),
        },
      );

      const res = await POST(req, routeContext);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Venue not found");
    });

    it("returns 403 Forbidden when caller is not the owner or a venue manager", async () => {
      (auth as unknown as jest.Mock).mockResolvedValueOnce({
        userId: "regular-user-id",
        sessionClaims: { metadata: { role: "member" } },
      });
      (prisma.venue.findFirst as jest.Mock).mockResolvedValueOnce({
        id: venueId,
        ownerId: "different-owner-id",
        creatorId: "different-creator-id",
      });

      const req = new NextRequest(
        `http://localhost/api/venues/${venueId}/check-in/bulk`,
        {
          method: "POST",
          body: JSON.stringify({ bookingIds: [validCuid1] }),
        },
      );

      const res = await POST(req, routeContext);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Forbidden");
    });
  });

  describe("Atomic Bulk Check-In Execution", () => {
    it("executes updates atomically in a Prisma transaction and returns counts and updated rows", async () => {
      const managerId = "owner-user-id";
      (auth as unknown as jest.Mock).mockResolvedValueOnce({
        userId: managerId,
      });

      (prisma.venue.findFirst as jest.Mock).mockResolvedValueOnce({
        id: venueId,
        name: "Central Coworking",
        ownerId: managerId,
      });

      const mockBookings = [
        {
          id: validCuid1,
          userId: "user-a",
          venueId,
          status: "CONFIRMED",
        },
        {
          id: validCuid2,
          userId: "user-b",
          venueId,
          status: "CONFIRMED",
        },
      ];

      const mockUpdatedRows = mockBookings.map((b) => ({
        ...b,
        status: "CHECKED_IN",
      }));

      // Mock prisma.$transaction
      (prisma.$transaction as jest.Mock).mockImplementationOnce(
        async (callback) => {
          const tx = {
            booking: {
              findMany: jest
                .fn()
                .mockResolvedValueOnce(mockBookings) // first lookup
                .mockResolvedValueOnce(mockUpdatedRows), // after update
              updateMany: jest.fn().mockResolvedValueOnce({ count: 2 }),
            },
            checkIn: {
              upsert: jest.fn().mockResolvedValue({}),
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
            bookingIds: [validCuid1, validCuid2],
            checkedInBy: "manager-bob",
          }),
        },
      );

      const res = await POST(req, routeContext);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.successfulCount).toBe(2);
      expect(data.failedIds).toEqual([]);
      expect(data.updatedBookings).toHaveLength(2);
      expect(data.updatedBookings[0].status).toBe("CHECKED_IN");
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("handles partial failures when some booking IDs do not exist or are cancelled", async () => {
      const managerId = "manager-user-id";
      (auth as unknown as jest.Mock).mockResolvedValueOnce({
        userId: managerId,
        sessionClaims: { metadata: { role: "manager" } },
      });

      (prisma.venue.findFirst as jest.Mock).mockResolvedValueOnce({
        id: venueId,
        name: "Downtown WorkHub",
        ownerId: "someone-else",
      });

      const missingCuid = "c123456789012345678901239";
      const cancelledCuid = "c123456789012345678901240";

      const mockBookings = [
        {
          id: validCuid1,
          userId: "user-a",
          venueId,
          status: "CONFIRMED",
        },
        {
          id: cancelledCuid,
          userId: "user-c",
          venueId,
          status: "CANCELLED",
        },
      ];

      const mockUpdatedRows = [
        {
          id: validCuid1,
          userId: "user-a",
          venueId,
          status: "CHECKED_IN",
        },
      ];

      (prisma.$transaction as jest.Mock).mockImplementationOnce(
        async (callback) => {
          const tx = {
            booking: {
              findMany: jest
                .fn()
                .mockResolvedValueOnce(mockBookings)
                .mockResolvedValueOnce(mockUpdatedRows),
              updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }),
            },
            checkIn: {
              upsert: jest.fn().mockResolvedValue({}),
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
            bookingIds: [validCuid1, missingCuid, cancelledCuid],
          }),
        },
      );

      const res = await POST(req, routeContext);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.successfulCount).toBe(1);
      expect(data.failedIds).toContain(missingCuid);
      expect(data.failedIds).toContain(cancelledCuid);
      expect(data.updatedBookings).toHaveLength(1);
    });
  });
});
