import { NextRequest } from "next/server";
import {
  verifyIotWebhookSignature,
  signIotWebhookPayload,
} from "@/lib/security/hmac";
import { POST } from "@/app/api/venues/check-in/iot/route";
import { prisma } from "@/lib/prisma";
import { recordCheckIn } from "@/lib/checkIn";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findFirst: jest.fn(),
    },
    checkIn: {
      upsert: jest.fn(),
    },
  },
}));

jest.mock("@/lib/checkIn", () => ({
  recordCheckIn: jest.fn(),
}));

describe("IoT Smart Lock HMAC Signature Verification & Webhook Route", () => {
  const secret = "whsec_test_secret_key_1234567890abcdef";
  const rawBody = JSON.stringify({
    venueId: "venue-123",
    userId: "user-456",
    lockId: "lock-789",
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WORKSPHERE_IOT_WEBHOOK_SECRET = secret;
  });

  describe("HMAC Utility: verifyIotWebhookSignature", () => {
    it("verifies a valid signature correctly", () => {
      const now = Math.floor(Date.now() / 1000);
      const { header } = signIotWebhookPayload(rawBody, secret, now);
      const result = verifyIotWebhookSignature(rawBody, header, secret);

      expect(result.isValid).toBe(true);
      expect(result.timestamp).toBe(now);
      expect(result.reason).toBeUndefined();
    });

    it("verifies correctly when secret does not have whsec_ prefix", () => {
      const rawSecret = "plain_secret_string";
      const now = Math.floor(Date.now() / 1000);
      const { header } = signIotWebhookPayload(rawBody, rawSecret, now);
      const result = verifyIotWebhookSignature(rawBody, header, rawSecret);

      expect(result.isValid).toBe(true);
    });

    it("rejects when secret is missing or empty", () => {
      const now = Math.floor(Date.now() / 1000);
      const { header } = signIotWebhookPayload(rawBody, secret, now);

      expect(verifyIotWebhookSignature(rawBody, header, null).isValid).toBe(false);
      expect(verifyIotWebhookSignature(rawBody, header, "").isValid).toBe(false);
      expect(verifyIotWebhookSignature(rawBody, header, undefined).isValid).toBe(false);
      expect(verifyIotWebhookSignature(rawBody, header, "  ").isValid).toBe(false);
    });

    it("rejects when signature header is missing or empty", () => {
      expect(verifyIotWebhookSignature(rawBody, null, secret).isValid).toBe(false);
      expect(verifyIotWebhookSignature(rawBody, "", secret).isValid).toBe(false);
      expect(verifyIotWebhookSignature(rawBody, undefined, secret).isValid).toBe(false);
    });

    it("rejects malformed signature headers without throwing", () => {
      expect(verifyIotWebhookSignature(rawBody, "invalid_format", secret).isValid).toBe(false);
      expect(verifyIotWebhookSignature(rawBody, "t=12345", secret).isValid).toBe(false);
      expect(verifyIotWebhookSignature(rawBody, "v1=abcde", secret).isValid).toBe(false);
      expect(verifyIotWebhookSignature(rawBody, "t=abc,v1=123", secret).isValid).toBe(false);
      expect(verifyIotWebhookSignature(rawBody, "t=-50,v1=123", secret).isValid).toBe(false);
    });

    it("rejects forged or modified signatures", () => {
      const now = Math.floor(Date.now() / 1000);
      const { signature } = signIotWebhookPayload(rawBody, secret, now);
      const tamperedSignature = signature.slice(0, -2) + (signature.endsWith("0") ? "1" : "0");
      const header = `t=${now},v1=${tamperedSignature}`;

      const result = verifyIotWebhookSignature(rawBody, header, secret);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("SIGNATURE_MISMATCH");
    });

    it("rejects tampered raw payloads", () => {
      const now = Math.floor(Date.now() / 1000);
      const { header } = signIotWebhookPayload(rawBody, secret, now);
      const tamperedBody = rawBody + " ";

      const result = verifyIotWebhookSignature(tamperedBody, header, secret);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("SIGNATURE_MISMATCH");
    });

    it("safely handles unequal length signatures without throwing timingSafeEqual length error", () => {
      const now = Math.floor(Date.now() / 1000);
      const shortHeader = `t=${now},v1=short`;
      const emptyHeader = `t=${now},v1=`;

      expect(() => {
        const res = verifyIotWebhookSignature(rawBody, shortHeader, secret);
        expect(res.isValid).toBe(false);
      }).not.toThrow();

      expect(() => {
        const res = verifyIotWebhookSignature(rawBody, emptyHeader, secret);
        expect(res.isValid).toBe(false);
      }).not.toThrow();
    });

    it("rejects timestamps expired by more than 300 seconds", () => {
      const now = 1000000;
      const expiredTimestamp = now - 301;
      const { header } = signIotWebhookPayload(rawBody, secret, expiredTimestamp);

      const result = verifyIotWebhookSignature(rawBody, header, secret, {
        currentTimestamp: now,
        toleranceSeconds: 300,
      });

      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("TIMESTAMP_OUT_OF_TOLERANCE");
    });

    it("rejects timestamps in the future by more than 300 seconds", () => {
      const now = 1000000;
      const futureTimestamp = now + 301;
      const { header } = signIotWebhookPayload(rawBody, secret, futureTimestamp);

      const result = verifyIotWebhookSignature(rawBody, header, secret, {
        currentTimestamp: now,
        toleranceSeconds: 300,
      });

      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("TIMESTAMP_OUT_OF_TOLERANCE");
    });

    it("accepts timestamps exactly at the 300-second boundary", () => {
      const now = 1000000;
      const boundaryPast = now - 300;
      const { header: pastHeader } = signIotWebhookPayload(rawBody, secret, boundaryPast);

      const pastResult = verifyIotWebhookSignature(rawBody, pastHeader, secret, {
        currentTimestamp: now,
        toleranceSeconds: 300,
      });
      expect(pastResult.isValid).toBe(true);

      const boundaryFuture = now + 300;
      const { header: validFutureHeader } = signIotWebhookPayload(rawBody, secret, boundaryFuture);

      const futureResult = verifyIotWebhookSignature(rawBody, validFutureHeader, secret, {
        currentTimestamp: now,
        toleranceSeconds: 300,
      });
      expect(futureResult.isValid).toBe(true);
    });
  });

  describe("API Route: POST /api/venues/check-in/iot", () => {
    function createMockRequest(body: string, signatureHeader?: string | null): NextRequest {
      const headers = new Headers();
      if (signatureHeader) {
        headers.set("x-worksphere-signature", signatureHeader);
      }
      headers.set("content-type", "application/json");

      return new NextRequest("http://localhost:3000/api/venues/check-in/iot", {
        method: "POST",
        headers,
        body,
      });
    }

    it("returns 401 when signature header is missing and performs zero DB queries", async () => {
      const req = createMockRequest(rawBody, null);
      const res = await POST(req);

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
      expect(prisma.venue.findFirst).not.toHaveBeenCalled();
      expect(recordCheckIn).not.toHaveBeenCalled();
    });

    it("returns 401 when signature is invalid and performs zero DB queries", async () => {
      const req = createMockRequest(rawBody, "t=1234567,v1=bad_signature");
      const res = await POST(req);

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
      expect(prisma.venue.findFirst).not.toHaveBeenCalled();
      expect(recordCheckIn).not.toHaveBeenCalled();
    });

    it("returns 401 when timestamp is older than 300 seconds", async () => {
      const expiredTimestamp = Math.floor(Date.now() / 1000) - 350;
      const { header } = signIotWebhookPayload(rawBody, secret, expiredTimestamp);
      const req = createMockRequest(rawBody, header);

      const res = await POST(req);

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
      expect(prisma.venue.findFirst).not.toHaveBeenCalled();
      expect(recordCheckIn).not.toHaveBeenCalled();
    });

    it("returns 401 when configured secret is missing from environment", async () => {
      delete process.env.WORKSPHERE_IOT_WEBHOOK_SECRET;
      const now = Math.floor(Date.now() / 1000);
      const { header } = signIotWebhookPayload(rawBody, secret, now);
      const req = createMockRequest(rawBody, header);

      const res = await POST(req);

      expect(res.status).toBe(401);
      expect(prisma.venue.findFirst).not.toHaveBeenCalled();
      expect(recordCheckIn).not.toHaveBeenCalled();
    });

    it("returns 400 when body is not valid JSON after successful signature verification", async () => {
      const invalidJson = "{ invalid json";
      const now = Math.floor(Date.now() / 1000);
      const { header } = signIotWebhookPayload(invalidJson, secret, now);
      const req = createMockRequest(invalidJson, header);

      const res = await POST(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid JSON payload");
      expect(recordCheckIn).not.toHaveBeenCalled();
    });

    it("returns 400 when required payload fields are missing", async () => {
      const incompletePayload = JSON.stringify({ lockId: "lock-1" });
      const now = Math.floor(Date.now() / 1000);
      const { header } = signIotWebhookPayload(incompletePayload, secret, now);
      const req = createMockRequest(incompletePayload, header);

      const res = await POST(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Missing required fields");
      expect(recordCheckIn).not.toHaveBeenCalled();
    });

    it("returns 404 when venue does not exist", async () => {
      (prisma.venue.findFirst as jest.Mock).mockResolvedValue(null);

      const now = Math.floor(Date.now() / 1000);
      const { header } = signIotWebhookPayload(rawBody, secret, now);
      const req = createMockRequest(rawBody, header);

      const res = await POST(req);

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Venue not found");
      expect(prisma.venue.findFirst).toHaveBeenCalledWith({
        where: { OR: [{ id: "venue-123" }, { placeId: "venue-123" }] },
        select: { id: true, name: true, latitude: true, longitude: true },
      });
      expect(recordCheckIn).not.toHaveBeenCalled();
    });

    it("processes valid check-in event successfully and returns 200", async () => {
      const mockVenue = {
        id: "venue-123",
        name: "Campus Coworking",
        latitude: 37.7749,
        longitude: -122.4194,
      };
      (prisma.venue.findFirst as jest.Mock).mockResolvedValue(mockVenue);

      const mockResult = {
        checkIn: {
          venueId: "venue-123",
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 14400000),
        },
        streak: {
          currentStreak: 5,
          longestStreak: 10,
          incremented: true,
          newMilestones: [],
          unlockedMilestones: [],
        },
      };
      (recordCheckIn as jest.Mock).mockResolvedValue(mockResult);

      const now = Math.floor(Date.now() / 1000);
      const { header } = signIotWebhookPayload(rawBody, secret, now);
      const req = createMockRequest(rawBody, header);

      const res = await POST(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.lockId).toBe("lock-789");
      expect(recordCheckIn).toHaveBeenCalledWith("user-456", mockVenue);
    });
  });
});
