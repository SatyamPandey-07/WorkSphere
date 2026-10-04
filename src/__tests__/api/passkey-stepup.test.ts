import { GET as getStepUpOptions } from "@/app/api/auth/passkey/step-up/options/route";
import { POST as verifyStepUp } from "@/app/api/auth/passkey/step-up/verify/route";
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
    },
    passkeyChallenge: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

describe("Step-Up Passkey Re-Authentication API Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/auth/passkey/step-up/options", () => {
    it("returns 401 if unauthenticated", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });
      const req = new Request("http://localhost:3000/api/auth/passkey/step-up/options");
      const res = await getStepUpOptions(req);

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 400 if user has no registered passkeys", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_123" });
      (prisma.passkeyCredential.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.passkeyChallenge.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

      const req = new Request("http://localhost:3000/api/auth/passkey/step-up/options");
      const res = await getStepUpOptions(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("No registered passkeys");
    });

    it("generates step-up options with userVerification: 'required'", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_123" });
      (prisma.passkeyCredential.findMany as jest.Mock).mockResolvedValue([
        { credentialId: "cred_123", transports: ["internal"] },
      ]);
      (prisma.passkeyChallenge.create as jest.Mock).mockResolvedValue({});
      (prisma.passkeyChallenge.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

      const req = new Request("http://localhost:3000/api/auth/passkey/step-up/options?action=revoke");
      const res = await getStepUpOptions(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.options).toBeDefined();
      expect(data.options.userVerification).toBe("required");
      expect(data.action).toBe("revoke");
    });
  });

  describe("POST /api/auth/passkey/step-up/verify", () => {
    it("returns 401 if unauthenticated", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });
      const req = new Request("http://localhost:3000/api/auth/passkey/step-up/verify", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const res = await verifyStepUp(req);
      expect(res.status).toBe(401);
    });

    it("returns 400 if authenticationResponse is missing", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_123" });
      const req = new Request("http://localhost:3000/api/auth/passkey/step-up/verify", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const res = await verifyStepUp(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Authentication response is required");
    });
  });
});
