import { POST } from "@/app/api/venues/[venueId]/reviews/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { ensureUserExists } from "@/lib/auth";
import { NextRequest } from "next/server";
import { enqueueTelemetry } from "@/lib/telemetryQueue";
import { emitWebhookEvent } from "@/lib/webhooks/deliver";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    venueRating: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("@/lib/telemetryQueue", () => ({
  enqueueTelemetry: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/agents/MemoryAgent", () => ({
  updateUserPreferencesSummary: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/webhooks/deliver", () => ({
  emitWebhookEvent: jest.fn(),
}));

describe("POST /api/venues/[venueId]/reviews", () => {
  const mockUserId = "user-test-123";
  const mockVenueId = "venue-test-456";

  beforeEach(() => {
    jest.clearAllMocks();
    (auth as jest.Mock).mockResolvedValue({ userId: mockUserId });
    (ensureUserExists as jest.Mock).mockResolvedValue(undefined);
  });

  function createRequest(body: any, headers: Record<string, string> = {}) {
    return new NextRequest(
      `http://localhost:3000/api/venues/${mockVenueId}/reviews`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
      },
    );
  }

  it("returns 401 Unauthorized when user is not authenticated", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: null });
    const req = createRequest({ wifiQuality: 5, hasOutlets: true, noiseLevel: "quiet" });
    const res = await POST(req, { params: Promise.resolve({ venueId: mockVenueId }) });
    expect(res.status).toBe(401);
  });

  it("returns 400 when validation fails", async () => {
    const req = createRequest({ wifiQuality: 10, hasOutlets: "not-a-bool" });
    const res = await POST(req, { params: Promise.resolve({ venueId: mockVenueId }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("returns 404 when venue is not found", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue(null);
    const req = createRequest({
      wifiQuality: 4,
      hasOutlets: true,
      noiseLevel: "quiet",
    });
    const res = await POST(req, { params: Promise.resolve({ venueId: "nonexistent" }) });
    expect(res.status).toBe(404);
  });

  it("successfully creates a review and returns 201", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: mockVenueId,
      name: "Cozy Cafe",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    (prisma.venueRating.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.venueRating.upsert as jest.Mock).mockResolvedValue({
      id: "rating-new-1",
      userId: mockUserId,
      venueId: mockVenueId,
      wifiQuality: 5,
      hasOutlets: true,
      noiseLevel: "quiet",
      createdAt: new Date(),
    });
    (prisma.venueRating.findMany as jest.Mock).mockResolvedValue([
      {
        wifiQuality: 5,
        hasOutlets: true,
        noiseLevel: "quiet",
        powerTypes: [],
        outletLocations: [],
      },
    ]);

    const req = createRequest({
      wifiQuality: 5,
      hasOutlets: true,
      noiseLevel: "quiet",
      comment: "Super quiet workspace!",
    });
    const res = await POST(req, { params: Promise.resolve({ venueId: mockVenueId }) });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.rating).toBeDefined();
    expect(json.rating.id).toBe("rating-new-1");
  });

  it("returns 409 Conflict when server review was modified after baseReviewUpdatedAt", async () => {
    const serverReviewTime = new Date("2026-05-01T12:00:00Z");
    const clientBaseTime = new Date("2026-05-01T10:00:00Z").toISOString();

    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: mockVenueId,
      name: "Cozy Cafe",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    (prisma.venueRating.findUnique as jest.Mock).mockResolvedValue({
      id: "existing-review",
      userId: mockUserId,
      venueId: mockVenueId,
      createdAt: serverReviewTime,
      wifiQuality: 3,
    });

    const req = createRequest({
      wifiQuality: 5,
      hasOutlets: true,
      noiseLevel: "quiet",
      baseReviewUpdatedAt: clientBaseTime,
    });
    const res = await POST(req, { params: Promise.resolve({ venueId: mockVenueId }) });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("Conflict");
    expect(json.conflictType).toBe("REVIEW_MODIFIED");
    expect(json.serverReview).toBeDefined();
  });

  it("bypasses conflict check when forceOverwrite: true is specified", async () => {
    const serverReviewTime = new Date("2026-05-01T12:00:00Z");
    const clientBaseTime = new Date("2026-05-01T10:00:00Z").toISOString();

    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: mockVenueId,
      name: "Cozy Cafe",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    (prisma.venueRating.findUnique as jest.Mock).mockResolvedValue({
      id: "existing-review",
      userId: mockUserId,
      venueId: mockVenueId,
      createdAt: serverReviewTime,
      wifiQuality: 3,
    });
    (prisma.venueRating.upsert as jest.Mock).mockResolvedValue({
      id: "existing-review",
      userId: mockUserId,
      venueId: mockVenueId,
      createdAt: new Date(),
      wifiQuality: 5,
      hasOutlets: true,
      noiseLevel: "quiet",
    });
    (prisma.venueRating.findMany as jest.Mock).mockResolvedValue([]);

    const req = createRequest({
      wifiQuality: 5,
      hasOutlets: true,
      noiseLevel: "quiet",
      baseReviewUpdatedAt: clientBaseTime,
      forceOverwrite: true,
    });
    const res = await POST(req, { params: Promise.resolve({ venueId: mockVenueId }) });
    expect(res.status).toBe(201);
  });

  it("handles idempotency replay: returns cached rating with 200 and idempotent flag", async () => {
    const idempotencyKey = "idemp-uuid-123";
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: mockVenueId,
      name: "Cozy Cafe",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    (prisma.venueRating.findUnique as jest.Mock).mockImplementation(({ where }: any) => {
      if (where.id === "rating-first") {
        return Promise.resolve({
          id: "rating-first",
          userId: mockUserId,
          venueId: mockVenueId,
          wifiQuality: 5,
          hasOutlets: true,
          noiseLevel: "quiet",
        });
      }
      return Promise.resolve(null);
    });
    (prisma.venueRating.upsert as jest.Mock).mockResolvedValue({
      id: "rating-first",
      userId: mockUserId,
      venueId: mockVenueId,
      wifiQuality: 5,
      hasOutlets: true,
      noiseLevel: "quiet",
    });
    (prisma.venueRating.findMany as jest.Mock).mockResolvedValue([]);

    // First submission
    const req1 = createRequest(
      { wifiQuality: 5, hasOutlets: true, noiseLevel: "quiet", idempotencyKey },
      { "X-Idempotency-Key": idempotencyKey },
    );
    const res1 = await POST(req1, { params: Promise.resolve({ venueId: mockVenueId }) });
    expect(res1.status).toBe(201);

    // Replay of same idempotency key
    const req2 = createRequest(
      { wifiQuality: 5, hasOutlets: true, noiseLevel: "quiet", idempotencyKey },
      { "X-Idempotency-Key": idempotencyKey },
    );
    const res2 = await POST(req2, { params: Promise.resolve({ venueId: mockVenueId }) });
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.idempotent).toBe(true);
    expect(json2.rating.id).toBe("rating-first");
  });

  it("detects 409 conflict when baseReview field snapshot differs from server", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: mockVenueId,
      name: "Cozy Cafe",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    (prisma.venueRating.findUnique as jest.Mock).mockResolvedValue({
      id: "existing-review",
      userId: mockUserId,
      venueId: mockVenueId,
      wifiQuality: 4, // Modified on server to 4
      hasOutlets: true,
      noiseLevel: "quiet",
      comment: "Updated from laptop",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    // Client started with baseReview of wifiQuality: 2
    const req = createRequest({
      wifiQuality: 5,
      hasOutlets: true,
      noiseLevel: "quiet",
      baseReview: {
        wifiQuality: 2,
        hasOutlets: true,
        noiseLevel: "quiet",
        comment: "Old comment",
      },
    });

    const res = await POST(req, {
      params: Promise.resolve({ venueId: mockVenueId }),
    });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("Conflict");
    expect(json.conflictType).toBe("REVIEW_MODIFIED");
  });

  it("duplicate replay does not duplicate telemetry or webhook calls", async () => {
    const idempotencyKey = "idemp-telemetry-dedup";
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: mockVenueId,
      name: "Cozy Cafe",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    (prisma.venueRating.findUnique as jest.Mock).mockImplementation(
      ({ where }: any) => {
        if (where.id === "rating-dedup") {
          return Promise.resolve({
            id: "rating-dedup",
            userId: mockUserId,
            venueId: mockVenueId,
            wifiQuality: 5,
            hasOutlets: true,
            noiseLevel: "quiet",
          });
        }
        return Promise.resolve(null);
      },
    );
    (prisma.venueRating.upsert as jest.Mock).mockResolvedValue({
      id: "rating-dedup",
      userId: mockUserId,
      venueId: mockVenueId,
      wifiQuality: 5,
      hasOutlets: true,
      noiseLevel: "quiet",
    });
    (prisma.venueRating.findMany as jest.Mock).mockResolvedValue([]);

    const payload = {
      wifiQuality: 5,
      hasOutlets: true,
      noiseLevel: "quiet",
      downloadSpeed: 100,
      uploadSpeed: 50,
      latency: 15,
      crowdLevel: "moderate",
      idempotencyKey,
    };

    // First request
    const req1 = createRequest(payload, {
      "X-Idempotency-Key": idempotencyKey,
    });
    const res1 = await POST(req1, {
      params: Promise.resolve({ venueId: mockVenueId }),
    });
    expect(res1.status).toBe(201);
    expect(enqueueTelemetry).toHaveBeenCalledTimes(1);
    expect(emitWebhookEvent).toHaveBeenCalledTimes(1);

    // Replay request
    const req2 = createRequest(payload, {
      "X-Idempotency-Key": idempotencyKey,
    });
    const res2 = await POST(req2, {
      params: Promise.resolve({ venueId: mockVenueId }),
    });
    expect(res2.status).toBe(200);
    // Crucial: Side effects must NOT be called a second time
    expect(enqueueTelemetry).toHaveBeenCalledTimes(1);
    expect(emitWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it("handles concurrent same-idempotency-key requests safely", async () => {
    const idempotencyKey = "idemp-concurrent-safe";
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: mockVenueId,
      name: "Cozy Cafe",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    (prisma.venueRating.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.venueRating.upsert as jest.Mock).mockResolvedValue({
      id: "rating-concurrent",
      userId: mockUserId,
      venueId: mockVenueId,
      wifiQuality: 5,
      hasOutlets: true,
      noiseLevel: "quiet",
    });
    (prisma.venueRating.findMany as jest.Mock).mockResolvedValue([]);

    const payload = {
      wifiQuality: 5,
      hasOutlets: true,
      noiseLevel: "quiet",
      idempotencyKey,
    };

    const reqA = createRequest(payload, {
      "X-Idempotency-Key": idempotencyKey,
    });
    const reqB = createRequest(payload, {
      "X-Idempotency-Key": idempotencyKey,
    });

    const [resA, resB] = await Promise.all([
      POST(reqA, { params: Promise.resolve({ venueId: mockVenueId }) }),
      POST(reqB, { params: Promise.resolve({ venueId: mockVenueId }) }),
    ]);

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    // Verified that webhook was emitted only once during concurrent execution
    expect(emitWebhookEvent).toHaveBeenCalledTimes(1);
  });
});
