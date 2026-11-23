/** @jest-environment node */

import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { POST as checkoutPost } from "@/app/api/peripherals/checkout/route";
import { POST as returnPost } from "@/app/api/peripherals/return/route";
import { prisma } from "@/lib/prisma";
import { generateLockerPin } from "@/lib/peripherals/peripheralEngine";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    peripheralRental: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

const mockAuth = auth as jest.Mock;
const mockFindFirst = prisma.peripheralRental.findFirst as jest.Mock;
const mockFindUnique = prisma.peripheralRental.findUnique as jest.Mock;
const mockCreate = prisma.peripheralRental.create as jest.Mock;
const mockUpdate = prisma.peripheralRental.update as jest.Mock;

function createRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Issue #9582 - Persistent Peripheral Rental Lifecycle & Security", () => {
  const currentUserId = "user_hardware_dev";

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: currentUserId });
    mockFindFirst.mockResolvedValue(null);
    mockFindUnique.mockResolvedValue(null);
  });

  describe("generateLockerPin", () => {
    it("generates an unpredictable 4-digit numeric PIN", () => {
      const pin = generateLockerPin();
      expect(pin).toMatch(/^\d{4}$/);
      const num = parseInt(pin, 10);
      expect(num).toBeGreaterThanOrEqual(1000);
      expect(num).toBeLessThan(10000);
    });
  });

  describe("POST /api/peripherals/checkout", () => {
    const validCheckoutBody = {
      itemId: "periph-4k-screen-01",
      venueId: "venue-sf-01",
      hourlyRate: 3.5,
      depositAmount: 50.0,
      lockerBayNumber: 2,
    };

    it("rejects unauthenticated requests with 401 Unauthorized", async () => {
      mockAuth.mockResolvedValue({ userId: null });

      const res = await checkoutPost(
        createRequest(
          "http://localhost/api/peripherals/checkout",
          validCheckoutBody,
        ),
      );
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("rejects missing itemId with 400 Bad Request", async () => {
      const res = await checkoutPost(
        createRequest("http://localhost/api/peripherals/checkout", {
          venueId: "venue-sf-01",
        }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/missing itemId/i);
    });

    it("rejects checkout with 409 Conflict when item is already actively rented in database", async () => {
      mockFindFirst.mockResolvedValue({
        id: "rent_db_1",
        rentalId: "RENT-999999-BAY2",
        itemId: "periph-4k-screen-01",
        status: "ACTIVE",
      });

      const res = await checkoutPost(
        createRequest(
          "http://localhost/api/peripherals/checkout",
          validCheckoutBody,
        ),
      );
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.code).toBe("PERIPHERAL_ALREADY_RESERVED");
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("persists rental in database and returns unlock instructions upon successful checkout", async () => {
      const now = new Date();
      mockCreate.mockResolvedValue({
        id: "rent_rec_123",
        rentalId: "RENT-123456-BAY2",
        itemId: validCheckoutBody.itemId,
        userId: currentUserId,
        venueId: validCheckoutBody.venueId,
        lockerBayNumber: 2,
        unlockPin: "4821",
        depositAmount: 50.0,
        hourlyRate: 3.5,
        startTime: now,
        status: "ACTIVE",
      });

      const res = await checkoutPost(
        createRequest(
          "http://localhost/api/peripherals/checkout",
          validCheckoutBody,
        ),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.message).toContain("Locker Bay #2 Unlocked!");
      expect(json.rental.userId).toBe(currentUserId);
      expect(json.instructions).toContain("Locker Bay #2");
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          itemId: validCheckoutBody.itemId,
          userId: currentUserId,
          status: "ACTIVE",
          depositAmount: 50.0,
          hourlyRate: 3.5,
        }),
      });
    });
  });

  describe("POST /api/peripherals/return", () => {
    it("rejects unauthenticated requests with 401 Unauthorized", async () => {
      mockAuth.mockResolvedValue({ userId: null });

      const res = await returnPost(
        createRequest("http://localhost/api/peripherals/return", {
          rentalId: "RENT-123456-BAY2",
        }),
      );
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("rejects request missing rentalId with 400 Bad Request", async () => {
      const res = await returnPost(
        createRequest("http://localhost/api/peripherals/return", {}),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/missing or invalid rentalId/i);
    });

    it("returns 404 Not Found when rental does not exist in database", async () => {
      mockFindUnique.mockResolvedValue(null);

      const res = await returnPost(
        createRequest("http://localhost/api/peripherals/return", {
          rentalId: "RENT-UNKNOWN-BAY1",
        }),
      );
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.code).toBe("RENTAL_NOT_FOUND");
    });

    it("rejects return with 403 Forbidden when caller is not the owner", async () => {
      mockFindUnique.mockResolvedValue({
        rentalId: "RENT-123456-BAY2",
        userId: "user_other_victim",
        status: "ACTIVE",
      });

      const res = await returnPost(
        createRequest("http://localhost/api/peripherals/return", {
          rentalId: "RENT-123456-BAY2",
        }),
      );
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe("FORBIDDEN");
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("returns idempotent 200 summary when rental was already completed", async () => {
      const startTime = new Date(Date.now() - 3600000);
      const endTime = new Date();
      mockFindUnique.mockResolvedValue({
        rentalId: "RENT-123456-BAY2",
        userId: currentUserId,
        status: "COMPLETED",
        lockerBayNumber: 2,
        startTime,
        endTime,
        updatedAt: endTime,
        hourlyRate: 3.5,
        depositAmount: 50.0,
        totalCostUsd: 3.5,
      });

      const res = await returnPost(
        createRequest("http://localhost/api/peripherals/return", {
          rental: { rentalId: "RENT-123456-BAY2" },
        }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.message).toContain("already returned");
      expect(json.summary.status).toBe("COMPLETED");
      expect(json.summary.rentalCostUsd).toBe(3.5);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("transactionally completes active rental and computes deposit refund from server records", async () => {
      const twoHoursAgo = new Date(Date.now() - 115 * 60 * 1000); // 1h 55m ago, rounded up to 2 hours ceiling
      mockFindUnique.mockResolvedValue({
        id: "rent_db_rec",
        rentalId: "RENT-123456-BAY2",
        userId: currentUserId,
        itemId: "periph-4k-screen-01",
        lockerBayNumber: 2,
        hourlyRate: 3.5,
        depositAmount: 50.0,
        startTime: twoHoursAgo,
        status: "ACTIVE",
      });

      mockUpdate.mockResolvedValue({
        rentalId: "RENT-123456-BAY2",
        status: "COMPLETED",
      });

      const res = await returnPost(
        createRequest("http://localhost/api/peripherals/return", {
          rentalId: "RENT-123456-BAY2",
        }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.summary.status).toBe("COMPLETED");
      expect(json.summary.durationHours).toBe(2);
      expect(json.summary.rentalCostUsd).toBe(7.0);
      expect(json.summary.depositRefundedUsd).toBe(43.0);
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { rentalId: "RENT-123456-BAY2" },
        data: expect.objectContaining({
          status: "COMPLETED",
          totalCostUsd: 7.0,
        }),
      });
    });
  });
});
