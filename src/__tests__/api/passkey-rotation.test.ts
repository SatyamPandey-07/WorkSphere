import {
  GET as getRotationStatus,
  POST as rotationAction,
} from "@/app/api/auth/passkey/rotation/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    passkeyCredential: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

describe("Passkey Rotation API Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/auth/passkey/rotation", () => {
    it("returns 401 if user is unauthenticated", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

      const res = await getRotationStatus();

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("returns rotation statuses for authenticated user", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({
        userId: "user_test123",
      });

      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 60);

      (prisma.passkeyCredential.findMany as jest.Mock).mockResolvedValue([
        {
          id: "cred_1",
          credentialId: "cred_id_1",
          name: "Test Passkey",
          deviceType: "singleDevice",
          backedUp: false,
          createdAt: new Date(),
          lastUsedAt: new Date(),
          expiresAt: futureDate,
        },
      ]);

      const res = await getRotationStatus();

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.credentials).toHaveLength(1);
      expect(data.credentials[0].needsRotation).toBe(false);
      expect(data.credentials[0].isExpired).toBe(false);
    });
  });

  describe("POST /api/auth/passkey/rotation", () => {
    it("returns 401 if user is unauthenticated", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

      const req = new Request(
        "http://localhost:3000/api/auth/passkey/rotation",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cleanup" }),
        },
      );

      const res = await rotationAction(req);

      expect(res.status).toBe(401);
    });

    it("cleans up expired passkeys", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({
        userId: "user_test123",
      });
      (prisma.passkeyCredential.deleteMany as jest.Mock).mockResolvedValue({
        count: 2,
      });

      const req = new Request(
        "http://localhost:3000/api/auth/passkey/rotation",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cleanup" }),
        },
      );

      const res = await rotationAction(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deletedCount).toBe(2);
    });

    it("rotates a specific passkey", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({
        userId: "user_test123",
      });

      const newExpiry = new Date();
      newExpiry.setDate(newExpiry.getDate() + 90);

      (prisma.passkeyCredential.findFirst as jest.Mock).mockResolvedValue({
        id: "cred_1",
        userId: "user_test123",
      });
      (prisma.passkeyCredential.update as jest.Mock).mockResolvedValue({
        expiresAt: newExpiry,
      });

      const req = new Request(
        "http://localhost:3000/api/auth/passkey/rotation",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "rotate", credentialId: "cred_1" }),
        },
      );

      const res = await rotationAction(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.newExpiresAt).toBeDefined();
    });

    it("returns error for invalid action", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({
        userId: "user_test123",
      });

      const req = new Request(
        "http://localhost:3000/api/auth/passkey/rotation",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "invalid" }),
        },
      );

      const res = await rotationAction(req);

      expect(res.status).toBe(400);
    });
  });
});
