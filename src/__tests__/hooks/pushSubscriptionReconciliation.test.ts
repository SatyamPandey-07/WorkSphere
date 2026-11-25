import { GET, POST } from "@/app/api/push/subscribe/route";
import { purgeServiceWorkerCachesOnSignOut } from "@/lib/pwa/serviceWorkerAuthSync";
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    pushSubscription: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
}));

describe("Push Subscription Account Reconciliation and Lifecycle", () => {
  const mockAuth = auth as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/push/subscribe - Endpoint Ownership Verification", () => {
    it("returns 401 when user is not authenticated", async () => {
      mockAuth.mockResolvedValue({ userId: null });
      const req = new NextRequest(
        "https://example.com/api/push/subscribe?endpoint=https%3A%2F%2Fpush.example.com%2Fsub1",
      );
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it("returns 400 when endpoint query param is missing", async () => {
      mockAuth.mockResolvedValue({ userId: "user_B" });
      const req = new NextRequest("https://example.com/api/push/subscribe");
      const res = await GET(req);
      expect(res.status).toBe(400);
    });

    it("reports isOwnedByOther=true when endpoint belongs to a different user (account switch)", async () => {
      mockAuth.mockResolvedValue({ userId: "user_B" });
      (prisma.pushSubscription.findUnique as jest.Mock).mockResolvedValue({
        userId: "user_A", // Owned by User A
      });

      const req = new NextRequest(
        "https://example.com/api/push/subscribe?endpoint=https%3A%2F%2Fpush.example.com%2FsubA",
      );
      const res = await GET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toEqual({
        isSubscribed: false,
        isOwnedByOther: true,
      });
    });

    it("reports isSubscribed=true when endpoint belongs to the authenticated user", async () => {
      mockAuth.mockResolvedValue({ userId: "user_B" });
      (prisma.pushSubscription.findUnique as jest.Mock).mockResolvedValue({
        userId: "user_B",
      });

      const req = new NextRequest(
        "https://example.com/api/push/subscribe?endpoint=https%3A%2F%2Fpush.example.com%2FsubB",
      );
      const res = await GET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toEqual({
        isSubscribed: true,
        isOwnedByOther: false,
      });
    });

    it("reports isSubscribed=false and isOwnedByOther=false when endpoint does not exist", async () => {
      mockAuth.mockResolvedValue({ userId: "user_B" });
      (prisma.pushSubscription.findUnique as jest.Mock).mockResolvedValue(null);

      const req = new NextRequest(
        "https://example.com/api/push/subscribe?endpoint=https%3A%2F%2Fpush.example.com%2Funregistered",
      );
      const res = await GET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toEqual({
        isSubscribed: false,
        isOwnedByOther: false,
      });
    });
  });

  describe("POST /api/push/subscribe - Conflict Protection", () => {
    it("returns 409 Conflict when attempting to register an endpoint owned by another user", async () => {
      mockAuth.mockResolvedValue({ userId: "user_B" });
      (prisma.pushSubscription.findUnique as jest.Mock).mockResolvedValue({
        userId: "user_A",
      });

      const req = new NextRequest("https://example.com/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: "https://push.example.com/subA",
          p256dh: "key_p256dh",
          auth: "key_auth",
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toBe("Endpoint already registered to another user");
      expect(prisma.pushSubscription.upsert).not.toHaveBeenCalled();
    });
  });

  describe("purgeServiceWorkerCachesOnSignOut - Push Cleanup", () => {
    it("unsubscribes pushManager subscription during sign-out", async () => {
      const mockUnsubscribe = jest.fn().mockResolvedValue(true);
      const mockGetSubscription = jest.fn().mockResolvedValue({
        endpoint: "https://push.example.com/sub",
        unsubscribe: mockUnsubscribe,
      });

      const originalNavigator = global.navigator;
      Object.defineProperty(global, "navigator", {
        value: {
          serviceWorker: {
            ready: Promise.resolve({
              pushManager: {
                getSubscription: mockGetSubscription,
              },
            }),
            controller: null,
          },
        },
        configurable: true,
        writable: true,
      });

      await purgeServiceWorkerCachesOnSignOut();

      expect(mockGetSubscription).toHaveBeenCalled();
      expect(mockUnsubscribe).toHaveBeenCalled();

      Object.defineProperty(global, "navigator", {
        value: originalNavigator,
        configurable: true,
        writable: true,
      });
    });
  });
});
