import crypto from "crypto";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/compute/burst/route";
import { auth } from "@clerk/nextjs/server";
import { ensureUserExists } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resetRateLimit } from "@/lib/rateLimit";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: { findFirst: jest.fn() },
    checkIn: { findFirst: jest.fn() },
    booking: { findFirst: jest.fn() },
    meshSession: { findFirst: jest.fn() },
  },
}));

const mockAuth = auth as unknown as jest.Mock;
const mockEnsureUserExists = ensureUserExists as unknown as jest.Mock;

const VALID_TEST_SECRET = "super-secure-mesh-jwt-signing-secret-32chars-min";

function decodeAndVerifyJwt(token: string, secret: string) {
  const parts = token.split(".");
  expect(parts).toHaveLength(3);
  const [headerB64, payloadB64, sigB64] = parts;
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  expect(sigB64).toBe(expectedSig);
  return JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8"));
}

function makePostReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/compute/burst", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST & GET /api/compute/burst - Authentication & JWT Signing Security (#10192)", () => {
  const originalSecret = process.env.MESH_JWT_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimit();
    process.env.MESH_JWT_SECRET = VALID_TEST_SECRET;
    mockAuth.mockResolvedValue({ userId: "user_clerk_alice" });
    mockEnsureUserExists.mockResolvedValue({ id: "user_clerk_alice" });
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue({
      id: "venue_1",
      creatorId: "user_owner",
      ownerId: null,
    });
    (prisma.checkIn.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.booking.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.meshSession.findFirst as jest.Mock).mockResolvedValue(null);
  });

  afterAll(() => {
    process.env.MESH_JWT_SECRET = originalSecret;
    Object.defineProperty(process.env, "NODE_ENV", {
      value: originalNodeEnv,
      configurable: true,
    });
  });

  it("rejects unauthenticated POST requests with 401", async () => {
    mockAuth.mockResolvedValueOnce({ userId: null });

    const res = await POST(
      makePostReq({
        userId: "123e4567-e89b-12d3-a456-426614174000",
        requestedCores: 4,
        estimatedDurationMs: 60000,
      }),
    );

    expect(res.status).toBe(401);
    expect(mockEnsureUserExists).not.toHaveBeenCalled();
  });

  it("rejects requests when server-side user record cannot be established", async () => {
    mockEnsureUserExists.mockResolvedValueOnce(null);

    const res = await POST(
      makePostReq({
        requestedCores: 4,
        estimatedDurationMs: 60000,
      }),
    );

    expect(res.status).toBe(401);
  });

  it("rejects caller attempting to spoof another userId with 403", async () => {
    const res = await POST(
      makePostReq({
        userId: "user_victim_bob",
        requestedCores: 8,
        estimatedDurationMs: 60000,
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toMatch(/another user/i);
  });

  it("issues a valid HS256 JWT bound to the server-authenticated userId even when body omits userId", async () => {
    const res = await POST(
      makePostReq({
        requestedCores: 8,
        estimatedDurationMs: 120000,
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.roomId).toBe("mesh-global");
    expect(typeof data.meshToken).toBe("string");

    const claims = decodeAndVerifyJwt(data.meshToken, VALID_TEST_SECRET);
    expect(claims.uid).toBe("user_clerk_alice");
    expect(claims.cores).toBe(8);
    expect(claims.exp - claims.iat).toBe(180);
  });

  it("accepts matching userId in request body and resolves Clerk -> DB user ID cleanly", async () => {
    mockEnsureUserExists.mockResolvedValueOnce({ id: "db_internal_alice" });

    const res = await POST(
      makePostReq({
        userId: "user_clerk_alice",
        requestedCores: 4,
        estimatedDurationMs: 30000,
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    const claims = decodeAndVerifyJwt(data.meshToken, VALID_TEST_SECRET);
    expect(claims.uid).toBe("db_internal_alice");
  });

  it("fails closed when MESH_JWT_SECRET is missing (never uses hardcoded fallback)", async () => {
    delete process.env.MESH_JWT_SECRET;

    const res = await POST(
      makePostReq({
        requestedCores: 4,
        estimatedDurationMs: 30000,
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.meshToken).toBeUndefined();
    expect(data.error).toMatch(/not configured/i);
  });

  it("fails closed when MESH_JWT_SECRET is fallback-dev-secret or too short", async () => {
    process.env.MESH_JWT_SECRET = "fallback-dev-secret";
    let res = await POST(
      makePostReq({
        requestedCores: 2,
        estimatedDurationMs: 5000,
      }),
    );
    expect(res.status).toBe(500);

    process.env.MESH_JWT_SECRET = "short-secret";
    res = await POST(
      makePostReq({
        requestedCores: 2,
        estimatedDurationMs: 5000,
      }),
    );
    expect(res.status).toBe(500);
  });

  it("enforces venue authorization when venueId is provided", async () => {
    // 1. Missing venue -> 404
    (prisma.venue.findFirst as jest.Mock).mockResolvedValueOnce(null);
    let res = await POST(
      makePostReq({
        requestedCores: 4,
        estimatedDurationMs: 10000,
        venueId: "missing-venue",
      }),
    );
    expect(res.status).toBe(404);

    // 2. Existing venue without check-in, booking, or active mesh session -> 403
    res = await POST(
      makePostReq({
        requestedCores: 4,
        estimatedDurationMs: 10000,
        venueId: "venue_1",
      }),
    );
    expect(res.status).toBe(403);

    // 3. Checked-in user at the venue -> 200 and venue bound in JWT claim & roomId
    (prisma.checkIn.findFirst as jest.Mock).mockResolvedValueOnce({
      id: "chk_1",
    });
    res = await POST(
      makePostReq({
        requestedCores: 4,
        estimatedDurationMs: 10000,
        venueId: "venue_1",
      }),
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.roomId).toBe("mesh-venue_1");
    const claims = decodeAndVerifyJwt(data.meshToken, VALID_TEST_SECRET);
    expect(claims.venue).toBe("venue_1");
  });

  it("preserves validation of requestedCores and estimatedDurationMs", async () => {
    const res = await POST(
      makePostReq({
        requestedCores: 32, // > max 16
        estimatedDurationMs: 500, // < min 1000
      }),
    );
    expect(res.status).toBe(400);
  });

  it("enforces per-user rate limit on token issuance", async () => {
    let lastStatus = 200;
    for (let i = 0; i < 21; i++) {
      const res = await POST(
        makePostReq({
          requestedCores: 2,
          estimatedDurationMs: 5000,
        }),
      );
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("secures GET endpoint against unauthenticated and cross-user statistics queries", async () => {
    mockAuth.mockResolvedValueOnce({ userId: null });
    let res = await GET(
      new NextRequest("http://localhost:3000/api/compute/burst"),
    );
    expect(res.status).toBe(401);

    res = await GET(
      new NextRequest(
        "http://localhost:3000/api/compute/burst?userId=other_user",
      ),
    );
    expect(res.status).toBe(403);

    res = await GET(
      new NextRequest(
        "http://localhost:3000/api/compute/burst?userId=user_clerk_alice",
      ),
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.userId).toBe("user_clerk_alice");
  });
});
