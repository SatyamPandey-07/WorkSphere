import { POST as authVerify } from "@/app/api/auth/passkey/authenticate/verify/route";
import { prisma } from "@/lib/prisma";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";

jest.mock("@clerk/nextjs/server", () => ({
  createClerkClient: jest.fn(() => ({
    signInTokens: {
      createSignInToken: jest
        .fn()
        .mockResolvedValue({ url: "https://clerk.example/ticket" }),
    },
  })),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    passkeyChallenge: {
      delete: jest.fn(),
      findUnique: jest.fn(),
    },
    passkeyCredential: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("@simplewebauthn/server", () => ({
  verifyAuthenticationResponse: jest.fn(),
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
}));

describe("Passkey Challenge Atomic Consumption (#9853)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, CLERK_SECRET_KEY: "test_clerk_secret" };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const mockPasskey = {
    id: "cred-db-id",
    credentialId: "test-cred-id",
    userId: "user-456",
    publicKey: Buffer.from("test-public-key"),
    counter: BigInt(10),
    transports: ["internal"],
    backedUp: true,
    deviceType: "singleDevice",
    name: "MacBook Touch ID",
    lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    user: {
      id: "user-456",
      email: "engineer@example.com",
      firstName: "Dev",
      lastName: "Tester",
    },
  };

  function createAuthRequest(challenge: string, credentialId = "test-cred-id") {
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: "webauthn.get",
        challenge,
        origin: "http://localhost",
      }),
    ).toString("base64url");

    return new Request(
      "http://localhost/api/auth/passkey/authenticate/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authenticationResponse: {
            id: credentialId,
            rawId: credentialId,
            response: {
              clientDataJSON,
              authenticatorData: "authdata",
              signature: "signature",
            },
          },
        }),
      },
    );
  }

  it("atomically consumes challenge during successful verification", async () => {
    (prisma.passkeyCredential.findUnique as jest.Mock).mockResolvedValue(
      mockPasskey,
    );
    (prisma.passkeyChallenge.delete as jest.Mock).mockResolvedValue({
      id: "chal-1",
      challenge: "valid-challenge-123",
      userId: "user-456",
      expiresAt: new Date(Date.now() + 60000),
    });
    (verifyAuthenticationResponse as jest.Mock).mockResolvedValue({
      verified: true,
      authenticationInfo: {
        newCounter: 11,
        credentialDeviceType: "singleDevice",
        credentialBackedUp: true,
      },
    });
    (prisma.passkeyCredential.update as jest.Mock).mockResolvedValue({
      ...mockPasskey,
      counter: BigInt(11),
      lastUsedAt: new Date(),
    });

    const req = createAuthRequest("valid-challenge-123");
    const res = await authVerify(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.verified).toBe(true);
    expect(data.userId).toBe("user-456");
    expect(data.signInUrl).toBe("https://clerk.example/ticket");

    // Verified that challenge is atomically deleted with challenge unique key
    expect(prisma.passkeyChallenge.delete).toHaveBeenCalledWith({
      where: { challenge: "valid-challenge-123" },
    });
    expect(prisma.passkeyCredential.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cred-db-id" },
        data: expect.objectContaining({
          counter: BigInt(11),
        }),
      }),
    );
  });

  it("prevents concurrent requests from reusing the same challenge", async () => {
    (prisma.passkeyCredential.findUnique as jest.Mock).mockResolvedValue(
      mockPasskey,
    );

    let consumed = false;
    (prisma.passkeyChallenge.delete as jest.Mock).mockImplementation(
      async ({ where }) => {
        if (where.challenge === "concurrent-challenge-xyz") {
          if (consumed) {
            const p2025Error: any = new Error(
              "Record to delete does not exist.",
            );
            p2025Error.code = "P2025";
            throw p2025Error;
          }
          consumed = true;
          return {
            id: "chal-concurrent",
            challenge: "concurrent-challenge-xyz",
            userId: "user-456",
            expiresAt: new Date(Date.now() + 60000),
          };
        }
        throw new Error("Unexpected challenge lookup");
      },
    );
    (prisma.passkeyChallenge.findUnique as jest.Mock).mockResolvedValue(null);

    (verifyAuthenticationResponse as jest.Mock).mockResolvedValue({
      verified: true,
      authenticationInfo: {
        newCounter: 11,
        credentialDeviceType: "singleDevice",
        credentialBackedUp: true,
      },
    });
    (prisma.passkeyCredential.update as jest.Mock).mockResolvedValue({
      ...mockPasskey,
      counter: BigInt(11),
      lastUsedAt: new Date(),
    });

    const req1 = createAuthRequest("concurrent-challenge-xyz");
    const req2 = createAuthRequest("concurrent-challenge-xyz");

    // Fire both requests concurrently
    const [res1, res2] = await Promise.all([
      authVerify(req1),
      authVerify(req2),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 400]);

    // Exactly one request succeeded, the other failed with challenge expired/missing
    const successfulRes = res1.status === 200 ? res1 : res2;
    const failedRes = res1.status === 400 ? res1 : res2;

    const successData = await successfulRes.json();
    expect(successData.verified).toBe(true);

    const failData = await failedRes.json();
    expect(failData.error).toBe(
      "Passkey challenge expired or missing. Please try again.",
    );

    // SimpleWebAuthn verify and DB credential update are only invoked once
    expect(verifyAuthenticationResponse).toHaveBeenCalledTimes(1);
    expect(prisma.passkeyCredential.update).toHaveBeenCalledTimes(1);
  });

  it("rejects expired challenge even if present in database", async () => {
    (prisma.passkeyCredential.findUnique as jest.Mock).mockResolvedValue(
      mockPasskey,
    );
    (prisma.passkeyChallenge.delete as jest.Mock).mockResolvedValue({
      id: "chal-expired",
      challenge: "expired-challenge",
      userId: "user-456",
      expiresAt: new Date(Date.now() - 5000), // expired 5 seconds ago
    });

    const req = createAuthRequest("expired-challenge");
    const res = await authVerify(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe(
      "Passkey challenge expired or missing. Please try again.",
    );
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
    expect(prisma.passkeyCredential.update).not.toHaveBeenCalled();
  });

  it("rejects challenge scoped to a different userId", async () => {
    (prisma.passkeyCredential.findUnique as jest.Mock).mockResolvedValue(
      mockPasskey,
    );
    (prisma.passkeyChallenge.delete as jest.Mock).mockResolvedValue({
      id: "chal-mismatched",
      challenge: "mismatched-challenge",
      userId: "user-DIFFERENT",
      expiresAt: new Date(Date.now() + 60000),
    });

    const req = createAuthRequest("mismatched-challenge");
    const res = await authVerify(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe(
      "Passkey challenge expired or missing. Please try again.",
    );
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it("rejects request when challenge deletion fails (missing or previously consumed)", async () => {
    (prisma.passkeyCredential.findUnique as jest.Mock).mockResolvedValue(
      mockPasskey,
    );
    const notFoundError: any = new Error("Record not found");
    notFoundError.code = "P2025";
    (prisma.passkeyChallenge.delete as jest.Mock).mockRejectedValue(
      notFoundError,
    );
    (prisma.passkeyChallenge.findUnique as jest.Mock).mockResolvedValue(null);

    const req = createAuthRequest("already-consumed-challenge");
    const res = await authVerify(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe(
      "Passkey challenge expired or missing. Please try again.",
    );
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it("rejects request when authentication response verification fails", async () => {
    (prisma.passkeyCredential.findUnique as jest.Mock).mockResolvedValue(
      mockPasskey,
    );
    (prisma.passkeyChallenge.delete as jest.Mock).mockResolvedValue({
      id: "chal-sigfail",
      challenge: "sigfail-challenge",
      userId: "user-456",
      expiresAt: new Date(Date.now() + 60000),
    });
    (verifyAuthenticationResponse as jest.Mock).mockRejectedValue(
      new Error("Signature verification failed"),
    );

    const req = createAuthRequest("sigfail-challenge");
    const res = await authVerify(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Passkey assertion verification failed");
    expect(prisma.passkeyCredential.update).not.toHaveBeenCalled();
  });
});
