import {
  invalidateRegistrationChallenge,
  revokeChallenge,
  cancelRegistrationChallenge,
} from "@/lib/auth/passkeys/server/recovery";
import { verifyPasskeyRegistration } from "@/lib/auth/passkeys/server/verifyAttestation";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    passkeyChallenge: {
      findFirst: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    passkeyCredential: {
      create: jest.fn(),
    },
  },
}));

jest.mock("@simplewebauthn/server", () => ({
  verifyRegistrationResponse: jest.fn(),
}));

describe("Passkey Registration Challenge Invalidation (#4800)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("invalidateRegistrationChallenge / revokeChallenge in recovery.ts", () => {
    it("invalidates challenge by challengeId immediately", async () => {
      (prisma.passkeyChallenge.deleteMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const count = await invalidateRegistrationChallenge({
        challengeId: "challenge-123",
      });

      expect(prisma.passkeyChallenge.deleteMany).toHaveBeenCalledWith({
        where: { id: "challenge-123" },
      });
      expect(count).toBe(1);
    });

    it("invalidates challenge by challenge token string immediately", async () => {
      (prisma.passkeyChallenge.deleteMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const count = await revokeChallenge({
        challenge: "raw-challenge-token-abc",
      });

      expect(prisma.passkeyChallenge.deleteMany).toHaveBeenCalledWith({
        where: { challenge: "raw-challenge-token-abc" },
      });
      expect(count).toBe(1);
    });

    it("invalidates active challenges by userId upon cancellation", async () => {
      (prisma.passkeyChallenge.deleteMany as jest.Mock).mockResolvedValue({
        count: 2,
      });

      const count = await cancelRegistrationChallenge({
        userId: "user-456",
      });

      expect(prisma.passkeyChallenge.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user-456" },
      });
      expect(count).toBe(2);
    });
  });

  describe("verifyPasskeyRegistration invalidation upon failure", () => {
    const mockRequest = new Request("http://localhost:3000", {
      headers: { host: "localhost:3000" },
    });

    it("invalidates challenge immediately when verifyRegistrationResponse throws", async () => {
      const { verifyRegistrationResponse } = require("@simplewebauthn/server");
      verifyRegistrationResponse.mockRejectedValue(
        new Error("Verification failed / canceled"),
      );

      (prisma.passkeyChallenge.findFirst as jest.Mock).mockResolvedValue({
        id: "chal-999",
        challenge: "chal-token-999",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60000),
      });

      (prisma.passkeyChallenge.delete as jest.Mock).mockResolvedValue({});

      const result = await verifyPasskeyRegistration(
        mockRequest,
        "user-1",
        {
          id: "cred-1",
          rawId: "raw-1",
          response: {
            clientDataJSON: Buffer.from(
              JSON.stringify({
                type: "webauthn.create",
                challenge: "chal-token-999",
                origin: "http://localhost:3000",
              }),
            ).toString("base64"),
            attestationObject: "dummy",
          },
          type: "public-key",
          clientExtensionResults: {},
        } as any,
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Passkey verification failed");
      // Challenge MUST be deleted immediately
      expect(prisma.passkeyChallenge.delete).toHaveBeenCalledWith({
        where: { id: "chal-999" },
      });
    });

    it("disallows reusing old challenges on retry after failure", async () => {
      // First attempt fails and deletes challenge
      (prisma.passkeyChallenge.findFirst as jest.Mock)
        .mockResolvedValueOnce({
          id: "chal-old",
          challenge: "chal-token-old",
          userId: "user-1",
          expiresAt: new Date(Date.now() + 60000),
        })
        .mockResolvedValueOnce(null); // Second attempt: challenge no longer exists

      const { verifyRegistrationResponse } = require("@simplewebauthn/server");
      verifyRegistrationResponse.mockResolvedValueOnce({
        verified: false,
      });

      const responsePayload = {
        id: "cred-1",
        rawId: "raw-1",
        response: {
          clientDataJSON: Buffer.from(
            JSON.stringify({
              type: "webauthn.create",
              challenge: "chal-token-old",
              origin: "http://localhost:3000",
            }),
          ).toString("base64"),
          attestationObject: "dummy",
        },
        type: "public-key",
        clientExtensionResults: {},
      } as any;

      // Attempt 1: Fails verification
      const attempt1 = await verifyPasskeyRegistration(
        mockRequest,
        "user-1",
        responsePayload,
      );
      expect(attempt1.ok).toBe(false);
      expect(prisma.passkeyChallenge.delete).toHaveBeenCalledWith({
        where: { id: "chal-old" },
      });

      // Attempt 2: Replay of old challenge is rejected as expired/missing
      const attempt2 = await verifyPasskeyRegistration(
        mockRequest,
        "user-1",
        responsePayload,
      );
      expect(attempt2.ok).toBe(false);
      expect(attempt2.error).toContain("expired or missing");
    });
  });
});
