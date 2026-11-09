import { POST as registerVerify } from "@/app/api/auth/passkey/register/verify/route";
import { POST as authVerify } from "@/app/api/auth/passkey/authenticate/verify/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { verifyPasskeyRegistration } from "@/lib/passkey/registration";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { inferDeviceNickname } from "@/lib/auth/passkeys/deviceDetection";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
  createClerkClient: jest.fn(() => ({
    signInTokens: {
      createSignInToken: jest.fn().mockResolvedValue({ url: "https://clerk.example/ticket" }),
    },
  })),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    passkeyChallenge: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
    },
    passkeyCredential: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("@/lib/passkey/registration", () => ({
  verifyPasskeyRegistration: jest.fn(),
}));

jest.mock("@simplewebauthn/server", () => ({
  verifyAuthenticationResponse: jest.fn(),
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
}));

describe("WebAuthn Passkey Registration Nickname & Last-Used Metadata (#3474)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Device Nickname Inference (User-Agent)", () => {
    it("infers 'MacBook Pro Touch ID' for macOS Pro user agents", () => {
      const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Pro AppleWebKit/537.36";
      expect(inferDeviceNickname(ua)).toBe("MacBook Pro Touch ID");
    });

    it("infers 'MacBook Touch ID' for standard macOS user agents", () => {
      const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
      expect(inferDeviceNickname(ua)).toBe("MacBook Touch ID");
    });

    it("infers 'iPhone Passkey' for iOS iPhone devices", () => {
      const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) Mobile/15E148";
      expect(inferDeviceNickname(ua)).toBe("iPhone Passkey");
    });

    it("infers 'Windows Hello Passkey' for Windows systems", () => {
      const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0";
      expect(inferDeviceNickname(ua)).toBe("Windows Hello Passkey");
    });

    it("infers 'Android Biometric Passkey' for Android devices", () => {
      const ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Chrome/120.0.0.0";
      expect(inferDeviceNickname(ua)).toBe("Android Biometric Passkey");
    });

    it("infers 'YubiKey / Security Key' when hardware transports are present", () => {
      expect(inferDeviceNickname("", ["usb"])).toBe("YubiKey / Security Key");
      expect(inferDeviceNickname("", ["nfc"])).toBe("YubiKey / Security Key");
    });
  });

  describe("POST /api/auth/passkey/register/verify", () => {
    const mockRegistration = {
      challengeId: "chal-123",
      credential: {
        credentialId: "cred-id-abc",
        publicKey: Buffer.from("publickeybytes"),
        counter: BigInt(0),
        deviceType: "multiDevice",
        backedUp: true,
        transports: ["internal"],
        aaguid: null,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    };

    it("stores custom nickname provided in the registration body", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user-123" });
      (verifyPasskeyRegistration as jest.Mock).mockResolvedValue({
        ok: true,
        registration: mockRegistration,
      });

      const fakePasskey = {
        id: "pk-1",
        userId: "user-123",
        credentialId: "cred-id-abc",
        name: "My Personal MacBook Pro",
        deviceType: "multiDevice",
        backedUp: true,
        createdAt: new Date("2026-10-08T12:00:00Z"),
        lastUsedAt: new Date("2026-10-08T12:00:00Z"),
      };
      (prisma.passkeyCredential.create as jest.Mock).mockResolvedValue(fakePasskey);

      const req = new Request("http://localhost/api/auth/passkey/register/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        },
        body: JSON.stringify({
          registrationResponse: { id: "cred-id-abc", rawId: "abc", type: "public-key" },
          nickname: "My Personal MacBook Pro",
        }),
      });

      const res = await registerVerify(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.verified).toBe(true);
      expect(json.credential.name).toBe("My Personal MacBook Pro");
      expect(json.credential.nickname).toBe("My Personal MacBook Pro");
      expect(json.credential.lastUsedAt).toBeDefined();

      expect(prisma.passkeyCredential.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-123",
            name: "My Personal MacBook Pro",
            lastUsedAt: expect.any(Date),
          }),
        }),
      );
    });

    it("infers device nickname from user-agent when nickname is omitted", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user-456" });
      (verifyPasskeyRegistration as jest.Mock).mockResolvedValue({
        ok: true,
        registration: mockRegistration,
      });

      const fakePasskey = {
        id: "pk-2",
        userId: "user-456",
        credentialId: "cred-id-abc",
        name: "iPhone Passkey",
        deviceType: "multiDevice",
        backedUp: true,
        createdAt: new Date("2026-10-08T12:00:00Z"),
        lastUsedAt: new Date("2026-10-08T12:00:00Z"),
      };
      (prisma.passkeyCredential.create as jest.Mock).mockResolvedValue(fakePasskey);

      const req = new Request("http://localhost/api/auth/passkey/register/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        },
        body: JSON.stringify({
          registrationResponse: { id: "cred-id-abc", rawId: "abc", type: "public-key" },
        }),
      });

      const res = await registerVerify(req);
      expect(res.status).toBe(200);

      expect(prisma.passkeyCredential.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "iPhone Passkey",
          }),
        }),
      );
    });
  });

  describe("POST /api/auth/passkey/authenticate/verify", () => {
    const existingPasskey = {
      id: "pk-existing",
      userId: "user-789",
      credentialId: "cred-existing-id",
      publicKey: Buffer.from("publickeybytes"),
      counter: BigInt(5),
      transports: ["internal"],
      deviceType: "multiDevice",
      backedUp: true,
      name: "MacBook Pro Touch ID",
      user: {
        id: "user-789",
        email: "user@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
      },
    };

    it("updates lastUsedAt timestamp on successful authentication", async () => {
      (prisma.passkeyCredential.findUnique as jest.Mock).mockResolvedValue(existingPasskey);
      (prisma.passkeyChallenge.findUnique as jest.Mock).mockResolvedValue({
        id: "chal-auth",
        challenge: "test-auth-challenge",
        userId: "user-789",
        expiresAt: new Date(Date.now() + 60000),
      });

      (verifyAuthenticationResponse as jest.Mock).mockResolvedValue({
        verified: true,
        authenticationInfo: {
          newCounter: 6,
          credentialDeviceType: "multiDevice",
          credentialBackedUp: true,
        },
      });

      const updatedDate = new Date("2026-10-08T14:30:00Z");
      (prisma.passkeyCredential.update as jest.Mock).mockResolvedValue({
        ...existingPasskey,
        counter: BigInt(6),
        lastUsedAt: updatedDate,
      });

      const clientDataJSON = Buffer.from(
        JSON.stringify({
          type: "webauthn.get",
          challenge: "test-auth-challenge",
          origin: "http://localhost",
        }),
      ).toString("base64url");

      const req = new Request("http://localhost/api/auth/passkey/authenticate/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authenticationResponse: {
            id: "cred-existing-id",
            rawId: "cred-existing-id",
            response: {
              clientDataJSON,
              authenticatorData: "authdata",
              signature: "signature",
            },
          },
        }),
      });

      const res = await authVerify(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.verified).toBe(true);
      expect(json.credential).toBeDefined();
      expect(json.credential.name).toBe("MacBook Pro Touch ID");
      expect(json.credential.lastUsedAt).toBeDefined();

      expect(prisma.passkeyCredential.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "pk-existing" },
          data: expect.objectContaining({
            lastUsedAt: expect.any(Date),
            counter: BigInt(6),
          }),
        }),
      );
    });
  });
});
