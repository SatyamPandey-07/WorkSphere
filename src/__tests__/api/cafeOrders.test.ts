/** @jest-environment node */

import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { POST, GET, DELETE } from "@/app/api/cafe/orders/route";
import { prisma } from "@/lib/prisma";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    cafeOrder: {
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

const mockAuth = auth as jest.Mock;
const mockCount = prisma.cafeOrder.count as jest.Mock;
const mockCreate = prisma.cafeOrder.create as jest.Mock;
const mockFindUnique = prisma.cafeOrder.findUnique as jest.Mock;
const mockUpdate = prisma.cafeOrder.update as jest.Mock;

function createPostRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/cafe/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createGetRequest(query = ""): NextRequest {
  const url = query
    ? `http://localhost/api/cafe/orders?${query}`
    : "http://localhost/api/cafe/orders";
  return new NextRequest(url, { method: "GET" });
}

function createDeleteRequest(query = ""): NextRequest {
  const url = query
    ? `http://localhost/api/cafe/orders?${query}`
    : "http://localhost/api/cafe/orders";
  return new NextRequest(url, { method: "DELETE" });
}

describe("Issue #9583 - Persistent Cafe Order Lifecycle & Security", () => {
  const currentUserId = "user_nomad_cafe";

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: currentUserId });
    mockCount.mockResolvedValue(0);
    mockFindUnique.mockResolvedValue(null);
  });

  describe("POST /api/cafe/orders", () => {
    const validItems = [
      {
        menuItemId: "oat-cortado",
        quantity: 1,
        customizations: [],
      },
    ];

    it("rejects unauthenticated requests with 401 Unauthorized", async () => {
      mockAuth.mockResolvedValue({ userId: null });

      const res = await POST(createPostRequest({ items: validItems }));
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("rejects empty items array with 400 Bad Request", async () => {
      const res = await POST(createPostRequest({ items: [] }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/at least one item/i);
    });

    it("calculates prices server-side from menu, binds order to session userId, and persists in DB", async () => {
      const now = new Date();
      mockCreate.mockImplementation(({ data }) => ({
        ...data,
        createdAt: now,
        estimatedReadyTime: new Date(now.getTime() + 180000),
      }));

      const res = await POST(
        createPostRequest({
          items: validItems,
          customerName: "Alice Nomad",
          deskNumber: "Desk #4A",
          venueId: "venue-sf-01",
        }),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.order.userId).toBe(currentUserId);
      expect(json.order.status).toBe("received");
      expect(json.order.subtotal).toBe(5.5);
      expect(json.order.total).toBeGreaterThan(5.5); // Includes tax
      expect(json.order.pickupCode).toBeDefined();
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: currentUserId,
            subtotal: 5.5,
            status: "received",
          }),
        }),
      );
    });
  });

  describe("GET /api/cafe/orders", () => {
    it("rejects unauthenticated requests with 401 Unauthorized", async () => {
      mockAuth.mockResolvedValue({ userId: null });

      const res = await GET(createGetRequest("orderId=ord-123"));
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("rejects missing orderId parameter with 400 Bad Request", async () => {
      const res = await GET(createGetRequest());
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/missing required query parameter/i);
    });

    it("returns 404 Not Found when order does not exist in DB", async () => {
      mockFindUnique.mockResolvedValue(null);

      const res = await GET(createGetRequest("orderId=ord-nonexistent"));
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toMatch(/order not found/i);
    });

    it("rejects cross-user access with 403 Forbidden", async () => {
      mockFindUnique.mockResolvedValue({
        id: "ord-123",
        userId: "user_other_person",
        status: "brewing",
        createdAt: new Date(),
        estimatedReadyTime: new Date(Date.now() + 60000),
      });

      const res = await GET(createGetRequest("orderId=ord-123"));
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/forbidden/i);
    });

    it("returns persistent order without timer-based fake status mutations", async () => {
      const pastTime = new Date(Date.now() - 600000); // 10 minutes ago
      mockFindUnique.mockResolvedValue({
        id: "ord-123",
        userId: currentUserId,
        status: "received", // status in DB is still received
        createdAt: pastTime,
        estimatedReadyTime: new Date(pastTime.getTime() + 180000),
      });

      const res = await GET(createGetRequest("orderId=ord-123"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.order.status).toBe("received"); // Must NOT artificially jump to brewing or ready
    });
  });

  describe("DELETE /api/cafe/orders", () => {
    it("rejects unauthenticated requests with 401 Unauthorized", async () => {
      mockAuth.mockResolvedValue({ userId: null });

      const res = await DELETE(createDeleteRequest("orderId=ord-123"));
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("returns 404 when order does not exist", async () => {
      mockFindUnique.mockResolvedValue(null);

      const res = await DELETE(createDeleteRequest("orderId=ord-missing"));
      expect(res.status).toBe(404);
    });

    it("rejects cross-user cancellation with 403 Forbidden", async () => {
      mockFindUnique.mockResolvedValue({
        id: "ord-123",
        userId: "user_other_person",
        status: "received",
        createdAt: new Date(),
        estimatedReadyTime: new Date(),
      });

      const res = await DELETE(createDeleteRequest("orderId=ord-123"));
      expect(res.status).toBe(403);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("rejects cancellation with 409 Conflict when order has already started brewing", async () => {
      mockFindUnique.mockResolvedValue({
        id: "ord-123",
        userId: currentUserId,
        status: "brewing",
        createdAt: new Date(),
        estimatedReadyTime: new Date(),
      });

      const res = await DELETE(createDeleteRequest("orderId=ord-123"));
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toMatch(/only orders that have not started brewing/i);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("cancels received order and marks status as cancelled in database", async () => {
      const now = new Date();
      mockFindUnique.mockResolvedValue({
        id: "ord-123",
        userId: currentUserId,
        status: "received",
        createdAt: now,
        estimatedReadyTime: new Date(now.getTime() + 180000),
      });

      mockUpdate.mockResolvedValue({
        id: "ord-123",
        userId: currentUserId,
        status: "cancelled",
        createdAt: now,
        estimatedReadyTime: new Date(now.getTime() + 180000),
      });

      const res = await DELETE(createDeleteRequest("orderId=ord-123"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.order.status).toBe("cancelled");
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "ord-123" },
        data: { status: "cancelled" },
      });
    });
  });
});
