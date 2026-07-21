import { GET as getRegisterOptions } from "@/app/api/auth/passkey/register/options/route";
import { GET as getAuthOptions } from "@/app/api/auth/passkey/authenticate/options/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    passkeyCredential: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    passkeyChallenge: {
      create: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

describe("Passkey API Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/auth/passkey/register/options", () => {
    it("returns 401 if user is unauthenticated", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

      const req = new Request(
        "http://localhost:3000/api/auth/passkey/register/options",
      );
      const res = await getRegisterOptions(req);

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("generates registration options for authenticated user", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({
        userId: "user_test123",
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: "user_test123",
        email: "test@example.com",
        firstName: "Test",
        lastName: "User",
      });
      (prisma.passkeyCredential.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.passkeyChallenge.create as jest.Mock).mockResolvedValue({});

      const req = new Request(
        "http://localhost:3000/api/auth/passkey/register/options",
      );
      const res = await getRegisterOptions(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.challenge).toBeDefined();
      expect(data.rp.name).toBe("WorkSphere");
    });
  });

  describe("GET /api/auth/passkey/authenticate/options", () => {
    it("generates authentication options", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });
      (prisma.passkeyChallenge.create as jest.Mock).mockResolvedValue({});

      const req = new Request(
        "http://localhost:3000/api/auth/passkey/authenticate/options",
      );
      const res = await getAuthOptions(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.challenge).toBeDefined();
    });
  });
});
