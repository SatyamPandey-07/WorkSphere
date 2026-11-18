/**
 * Integration tests for GET and POST /api/venues/[venueId]/reviews with SWR Redis caching.
 *
 * Verifies:
 * - Cache Miss queries Prisma and stores reviews in Redis
 * - Cache Hit serves reviews immediately from Redis without Prisma query
 * - Unauthenticated requests mask user names while authenticated requests show them
 * - Review submission purges venue reviews cache entry
 *
 * Issue #7266
 */

import { GET, POST } from "@/app/api/venues/[venueId]/reviews/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { rateLimit } from "@/lib/rateLimit";
import { ensureUserExists } from "@/lib/auth";
import { NextRequest } from "next/server";
import { getRedis } from "@/lib/redis";
import {
  clearMemorySWRCache,
  getVenueReviewsCacheKey,
  getCacheVersionKey,
  LUA_ATOMIC_INVALIDATE,
  LUA_ATOMIC_SET_IF_VERSION_MATCH,
} from "@/lib/cache/swrCache";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: jest.fn(),
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
}));

jest.mock("@/lib/prisma", () => {
  const mockPrisma: any = {
    $transaction: jest.fn(async (callback: any) => {
      if (typeof callback === "function") {
        return callback(mockPrisma);
      }
      return Promise.all(callback);
    }),
    venue: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    venueRating: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };
  return { prisma: mockPrisma };
});

jest.mock("@/lib/telemetryQueue", () => ({
  enqueueTelemetry: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/agents/MemoryAgent", () => ({
  updateUserPreferencesSummary: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/webhooks/deliver", () => ({
  emitWebhookEvent: jest.fn(),
}));

// Mock Upstash Redis client
const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  eval: jest.fn(),
};

jest.mock("@/lib/redis", () => ({
  getRedis: jest.fn(),
}));

describe("API: /api/venues/[venueId]/reviews SWR Caching & Invalidation (Issue #7266)", () => {
  const mockVenueId = "venue-test-uuid";
  const mockPlaceId = "place-test-abc";
  const mockUserId = "user-test-789";

  beforeEach(() => {
    jest.clearAllMocks();
    clearMemorySWRCache();

    (getRedis as jest.Mock).mockReturnValue(mockRedis);
    mockRedis.get.mockImplementation(async (k: string) => {
      if (k.endsWith(":version")) return "uuid-test-token-1";
      return null;
    });
    mockRedis.set.mockResolvedValue("OK");
    mockRedis.del.mockResolvedValue(1);
    mockRedis.eval.mockImplementation(async (script: string) => {
      if (script.includes("NX")) return "uuid-test-token-1";
      if (script.includes("DEL")) return "uuid-test-token-2";
      return 1;
    });

    (rateLimit as jest.Mock).mockResolvedValue(true);
    (ensureUserExists as jest.Mock).mockResolvedValue(undefined);
  });

  describe("GET /api/venues/[venueId]/reviews", () => {
    const mockDbVenue = {
      id: mockVenueId,
      placeId: mockPlaceId,
      name: "Test Workspace",
    };
    const mockDbReviews = [
      {
        id: "rating-1",
        venueId: mockVenueId,
        wifiQuality: 5,
        hasOutlets: true,
        noiseLevel: "quiet",
        comment: "Great spot for deep work!",
        createdAt: new Date().toISOString(),
        user: { firstName: "Alice", lastName: "Smith" },
      },
    ];

    it("serves from database and populates Redis on cache miss", async () => {
      (auth as jest.Mock).mockResolvedValue({ userId: mockUserId });
      (prisma.venue.findFirst as jest.Mock).mockResolvedValue(mockDbVenue);
      (prisma.venueRating.findMany as jest.Mock).mockResolvedValue(
        mockDbReviews,
      );
      mockRedis.get.mockResolvedValue(null);

      const req = new NextRequest(
        `http://localhost:3000/api/venues/${mockVenueId}/reviews`,
      );
      const res = await GET(req, {
        params: Promise.resolve({ venueId: mockVenueId }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.reviews).toHaveLength(1);
      expect(json.reviews[0].comment).toBe("Great spot for deep work!");
      expect(json.reviews[0].user).toEqual({
        firstName: "Alice",
        lastName: "Smith",
      });

      // Verifies DB was queried
      expect(prisma.venueRating.findMany).toHaveBeenCalledTimes(1);

      // Verifies Redis was populated with envelope atomically via Lua
      const expectedKey = getVenueReviewsCacheKey(mockVenueId);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        LUA_ATOMIC_SET_IF_VERSION_MATCH,
        [expectedKey, getCacheVersionKey(expectedKey)],
        ["uuid-test-token-1", expect.any(String), "3600"],
      );
    });

    it("serves immediately from Redis cache without querying database", async () => {
      (auth as jest.Mock).mockResolvedValue({ userId: mockUserId });
      (prisma.venue.findFirst as jest.Mock).mockResolvedValue(mockDbVenue);

      // Cached envelope with timestamp from 1 minute ago (< 5m fresh TTL)
      const cachedEnvelope = {
        data: mockDbReviews,
        cachedAt: Date.now() - 60 * 1000,
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedEnvelope));

      const req = new NextRequest(
        `http://localhost:3000/api/venues/${mockVenueId}/reviews`,
      );
      const res = await GET(req, {
        params: Promise.resolve({ venueId: mockVenueId }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.reviews).toHaveLength(1);
      expect(json.reviews[0].user).toEqual({
        firstName: "Alice",
        lastName: "Smith",
      });

      // Database should NOT have been queried
      expect(prisma.venueRating.findMany).not.toHaveBeenCalled();
    });

    it("masks user details when requester is unauthenticated", async () => {
      (auth as jest.Mock).mockResolvedValue({ userId: null });
      (prisma.venue.findFirst as jest.Mock).mockResolvedValue(mockDbVenue);

      const cachedEnvelope = {
        data: mockDbReviews,
        cachedAt: Date.now() - 60 * 1000,
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedEnvelope));

      const req = new NextRequest(
        `http://localhost:3000/api/venues/${mockVenueId}/reviews`,
      );
      const res = await GET(req, {
        params: Promise.resolve({ venueId: mockVenueId }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.reviews).toHaveLength(1);
      // Privacy check: unauthenticated user should see null
      expect(json.reviews[0].user).toBeNull();
    });

    it("returns empty array if venue is not found", async () => {
      (auth as jest.Mock).mockResolvedValue({ userId: null });
      (prisma.venue.findFirst as jest.Mock).mockResolvedValue(null);

      const req = new NextRequest(
        `http://localhost:3000/api/venues/nonexistent/reviews`,
      );
      const res = await GET(req, {
        params: Promise.resolve({ venueId: "nonexistent" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.reviews).toEqual([]);
    });
  });

  describe("POST /api/venues/[venueId]/reviews Cache Invalidation", () => {
    it("invalidates Redis cache key upon successful review submission", async () => {
      (auth as jest.Mock).mockResolvedValue({ userId: mockUserId });
      (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
        id: mockVenueId,
        name: "Test Venue",
      });
      (prisma.venueRating.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.venueRating.upsert as jest.Mock).mockResolvedValue({
        id: "rating-new-123",
        userId: mockUserId,
        venueId: mockVenueId,
        wifiQuality: 5,
        hasOutlets: true,
        noiseLevel: "quiet",
      });
      (prisma.venueRating.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.venue.update as jest.Mock).mockResolvedValue({});

      const req = new NextRequest(
        `http://localhost:3000/api/venues/${mockVenueId}/reviews`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            wifiQuality: 5,
            hasOutlets: true,
            noiseLevel: "quiet",
            comment: "Super quiet workspace!",
          }),
        },
      );

      const res = await POST(req, {
        params: Promise.resolve({ venueId: mockVenueId }),
      });

      expect(res.status).toBe(201);

      // Verifies cache invalidation was triggered for this venue atomically via Lua
      const expectedKey = getVenueReviewsCacheKey(mockVenueId);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        LUA_ATOMIC_INVALIDATE,
        [expectedKey, getCacheVersionKey(expectedKey)],
        [expect.any(String)],
      );
    });
  });
});
