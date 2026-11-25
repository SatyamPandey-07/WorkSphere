import { POST, GET } from "@/app/api/auth/magic-link/route";
import {
  generateSecureToken,
  hashMagicToken,
  storeMagicToken,
  verifyMagicLinkToken,
  clearTokenStore,
  processMagicLinkRequest,
} from "@/lib/auth/emailService";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  },
}));

describe("Magic Link Authentication Flow (Issue #9792)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearTokenStore();
  });

  describe("Token security and hashing", () => {
    it("generates cryptographically secure 32-byte (64 hex chars) tokens", () => {
      const token1 = generateSecureToken();
      const token2 = generateSecureToken();
      expect(token1).toHaveLength(64);
      expect(token2).toHaveLength(64);
      expect(token1).not.toBe(token2);
    });

    it("hashes tokens with SHA-256 before storage", () => {
      const rawToken = "super-secret-token";
      const hash1 = hashMagicToken(rawToken);
      const hash2 = hashMagicToken(rawToken);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
      expect(hash1).not.toBe(rawToken);
    });
  });

  describe("Token storage, verification and lifecycle", () => {
    it("successfully verifies a valid unconsumed token", async () => {
      const rawToken = generateSecureToken();
      const email = "user@example.com";
      await storeMagicToken(rawToken, email, 15 * 60 * 1000);

      const verification = await verifyMagicLinkToken(rawToken);
      expect(verification.success).toBe(true);
      expect(verification.email).toBe(email);
    });

    it("enforces single-use verification and rejects reused tokens", async () => {
      const rawToken = generateSecureToken();
      const email = "user@example.com";
      await storeMagicToken(rawToken, email, 15 * 60 * 1000);

      const firstVerify = await verifyMagicLinkToken(rawToken);
      expect(firstVerify.success).toBe(true);

      const secondVerify = await verifyMagicLinkToken(rawToken);
      expect(secondVerify.success).toBe(false);
      expect(secondVerify.error).toContain("already been used");
    });

    it("rejects expired magic link tokens", async () => {
      const rawToken = generateSecureToken();
      const email = "user@example.com";
      // Store with -1 ms TTL so it expires immediately
      await storeMagicToken(rawToken, email, -1000);

      const verification = await verifyMagicLinkToken(rawToken);
      expect(verification.success).toBe(false);
      expect(verification.error).toContain("expired");
    });

    it("rejects unknown or invalid tokens", async () => {
      const verification = await verifyMagicLinkToken("non-existent-token");
      expect(verification.success).toBe(false);
      expect(verification.error).toContain("Invalid or expired magic link");
    });
  });

  describe("POST /api/auth/magic-link route behavior", () => {
    it("accepts unauthenticated requests and never leaks raw token in response", async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue({
        id: "user-123",
        email: "nomad@worksphere.io",
      });

      const req = new NextRequest("http://localhost:3000/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nomad@worksphere.io" }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.email).toBe("nomad@worksphere.io");
      expect(json.message).toBeDefined();
      // Raw token must never be returned in API response!
      expect(json.token).toBeUndefined();
    });

    it("rejects requests with invalid email formats", async () => {
      const req = new NextRequest("http://localhost:3000/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "invalid-email" }),
      });

      const res = await POST(req);
      expect(res.status).toBe(422);
    });

    it("rejects requests with missing email body", async () => {
      const req = new NextRequest("http://localhost:3000/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("applies rate limiting and abuse protection after excessive requests", async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue({
        id: "user-123",
        email: "spammer@domain.com",
      });

      // Submit 5 valid requests
      for (let i = 0; i < 5; i++) {
        const req = new NextRequest(
          "http://localhost:3000/api/auth/magic-link",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: "spammer@domain.com" }),
          },
        );
        const res = await POST(req);
        expect(res.status).toBe(200);
      }

      // 6th request must be rate limited
      const rateLimitedReq = new NextRequest(
        "http://localhost:3000/api/auth/magic-link",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "spammer@domain.com" }),
        },
      );
      const res = await POST(rateLimitedReq);
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toContain("Too many magic link requests");
    });
  });

  describe("GET /api/auth/magic-link verification route", () => {
    it("successfully verifies a valid token and returns 200", async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue({
        id: "user-123",
        email: "verified@worksphere.io",
      });

      const { token } = await processMagicLinkRequest("verified@worksphere.io");

      const req = new NextRequest(
        `http://localhost:3000/api/auth/magic-link?token=${token}`,
      );
      const res = await GET(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.message).toContain("Magic link verified successfully");
      expect(json.email).toBe("verified@worksphere.io");
    });

    it("returns 400 when token query param is missing", async () => {
      const req = new NextRequest("http://localhost:3000/api/auth/magic-link");
      const res = await GET(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("token is required");
    });

    it("returns 400 when verifying already-used token", async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue({
        id: "user-123",
        email: "verified@worksphere.io",
      });

      const { token } = await processMagicLinkRequest("verified@worksphere.io");

      const req1 = new NextRequest(
        `http://localhost:3000/api/auth/magic-link?token=${token}`,
      );
      const res1 = await GET(req1);
      expect(res1.status).toBe(200);

      // Second attempt
      const req2 = new NextRequest(
        `http://localhost:3000/api/auth/magic-link?token=${token}`,
      );
      const res2 = await GET(req2);
      expect(res2.status).toBe(400);
      const json = await res2.json();
      expect(json.error).toContain("already been used");
    });
  });
});
