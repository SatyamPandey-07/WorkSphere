import { GET, POST } from "@/app/api/user/notifications/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    pushNotificationLog: {
      findMany: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

describe("User Notifications API Persistence (#9808)", () => {
  const mockUserId = "user_test_persistence_123";

  beforeEach(() => {
    jest.clearAllMocks();
    (auth as unknown as jest.Mock).mockResolvedValue({
      userId: mockUserId,
    });
  });

  describe("GET /api/user/notifications", () => {
    it("returns 401 Unauthorized when session is missing", async () => {
      (auth as unknown as jest.Mock).mockResolvedValueOnce({ userId: null });

      const response = await GET();
      const json = await response.json();

      expect(response.status).toBe(401);
      expect(json.error).toBe("Unauthorized");
    });

    it("filters out dismissed and archived notifications and counts unread accurately", async () => {
      const mockNotifications = [
        {
          id: "notif-1",
          userId: mockUserId,
          title: "Desk Reserved",
          body: "Your desk is ready",
          status: "DELIVERED",
          read: false,
          createdAt: new Date().toISOString(),
        },
      ];

      (prisma.pushNotificationLog.findMany as jest.Mock).mockResolvedValueOnce(
        mockNotifications,
      );
      (prisma.pushNotificationLog.count as jest.Mock).mockResolvedValueOnce(1);

      const response = await GET();
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.notifications).toEqual(mockNotifications);
      expect(json.unreadCount).toBe(1);

      expect(prisma.pushNotificationLog.findMany).toHaveBeenCalledWith({
        where: {
          userId: mockUserId,
          status: { notIn: ["DISMISSED", "ARCHIVED"] },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      });

      expect(prisma.pushNotificationLog.count).toHaveBeenCalledWith({
        where: {
          userId: mockUserId,
          status: { notIn: ["READ", "DISMISSED", "ARCHIVED"] },
        },
      });
    });
  });

  describe("POST /api/user/notifications — clearAll", () => {
    it("returns 401 Unauthorized when session is missing", async () => {
      (auth as unknown as jest.Mock).mockResolvedValueOnce({ userId: null });

      const req = new Request("http://localhost:3000/api/user/notifications", {
        method: "POST",
        body: JSON.stringify({ action: "clearAll" }),
      });

      const response = await POST(req);
      const json = await response.json();

      expect(response.status).toBe(401);
      expect(json.error).toBe("Unauthorized");
    });

    it("clears all notifications scoped strictly to the authenticated user", async () => {
      (
        prisma.pushNotificationLog.deleteMany as jest.Mock
      ).mockResolvedValueOnce({ count: 5 });

      const req = new Request("http://localhost:3000/api/user/notifications", {
        method: "POST",
        body: JSON.stringify({ action: "clearAll" }),
      });

      const response = await POST(req);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.success).toBe(true);

      expect(prisma.pushNotificationLog.deleteMany).toHaveBeenCalledWith({
        where: { userId: mockUserId },
      });
    });

    it("retries clearAll on transient serialization conflicts and succeeds", async () => {
      const conflictError = new Error("Serialization failure 40001");
      (conflictError as any).code = "P2034";

      (prisma.pushNotificationLog.deleteMany as jest.Mock)
        .mockRejectedValueOnce(conflictError)
        .mockResolvedValueOnce({ count: 3 });

      const req = new Request("http://localhost:3000/api/user/notifications", {
        method: "POST",
        body: JSON.stringify({ action: "clearAll" }),
      });

      const response = await POST(req);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(prisma.pushNotificationLog.deleteMany).toHaveBeenCalledTimes(2);
    });
  });

  describe("POST /api/user/notifications — dismiss", () => {
    it("returns 401 Unauthorized when session is missing", async () => {
      (auth as unknown as jest.Mock).mockResolvedValueOnce({ userId: null });

      const req = new Request("http://localhost:3000/api/user/notifications", {
        method: "POST",
        body: JSON.stringify({ action: "dismiss", id: "notif-1" }),
      });

      const response = await POST(req);
      const json = await response.json();

      expect(response.status).toBe(401);
      expect(json.error).toBe("Unauthorized");
    });

    it("returns 400 Bad Request when notification id is missing or invalid", async () => {
      const req = new Request("http://localhost:3000/api/user/notifications", {
        method: "POST",
        body: JSON.stringify({ action: "dismiss" }),
      });

      const response = await POST(req);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error).toMatch(/notification id is required/i);
      expect(prisma.pushNotificationLog.deleteMany).not.toHaveBeenCalled();
    });

    it("dismisses specified notification scoped strictly to the authenticated user", async () => {
      (
        prisma.pushNotificationLog.deleteMany as jest.Mock
      ).mockResolvedValueOnce({ count: 1 });

      const req = new Request("http://localhost:3000/api/user/notifications", {
        method: "POST",
        body: JSON.stringify({ action: "dismiss", id: "notif-target-999" }),
      });

      const response = await POST(req);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.success).toBe(true);

      expect(prisma.pushNotificationLog.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: mockUserId,
          id: "notif-target-999",
        },
      });
    });
  });

  describe("POST /api/user/notifications — error handling", () => {
    it("returns 400 Bad Request on unknown action", async () => {
      const req = new Request("http://localhost:3000/api/user/notifications", {
        method: "POST",
        body: JSON.stringify({ action: "unsupportedAction" }),
      });

      const response = await POST(req);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error).toBe("Invalid action");
    });
  });
});
