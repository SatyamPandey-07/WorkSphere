import { NextRequest } from "next/server";
import { POST } from "@/app/api/favorites/tags/sync/route";
import { auth } from "@clerk/nextjs/server";
import { ensureUserExists } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resetRateLimit } from "@/lib/rateLimit";
import { syncFavoriteTagsBulk } from "@/lib/favoriteTagSync";
import { MAX_BULK_FAVORITE_OPERATIONS } from "@/lib/validations";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: jest.fn().mockResolvedValue({ id: "user_sync_1" }),
}));

jest.mock("@/lib/agents/MemoryAgent", () => ({
  updateUserPreferencesSummary: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/lib/favoriteTagSync", () => ({
  syncFavoriteTagsBulk: jest.fn(),
}));

jest.mock("@/lib/prisma", () => {
  const txClient = {
    venue: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    favorite: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  return {
    prisma: {
      ...txClient,
      favoriteTag: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn(
        async (cb: (tx: typeof txClient) => Promise<unknown>) => cb(txClient),
      ),
    },
  };
});

const mockAuth = auth as unknown as jest.Mock;
const mockEnsureUserExists = ensureUserExists as unknown as jest.Mock;

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/favorites/tags/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/favorites/tags/sync - Bulk Favorite-Sync Validation (#10194)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimit();
    mockAuth.mockResolvedValue({ userId: "user_sync_1" });
    mockEnsureUserExists.mockResolvedValue({ id: "user_sync_1" });
    (prisma.venue.findMany as jest.Mock).mockResolvedValue([
      { id: "venue_db_1", placeId: "place_1" },
      { id: "venue_db_2", placeId: "place_2" },
    ]);
    (prisma.favorite.createMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.favorite.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
  });

  it("executes valid add and remove operations transactionally", async () => {
    const res = await POST(
      makeReq({
        operations: [
          { venueId: "place_1", action: "add", timestamp: 1790000000001 },
          { venueId: "venue_db_2", action: "remove", timestamp: 1790000000002 },
        ],
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ success: true, processed: 2 });
    expect(prisma.venue.create).not.toHaveBeenCalled();
    expect(prisma.favorite.createMany).toHaveBeenCalledWith({
      data: [{ userId: "user_sync_1", venueId: "venue_db_1" }],
      skipDuplicates: true,
    });
    expect(prisma.favorite.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user_sync_1",
        venueId: { in: ["venue_db_2"] },
      },
    });
  });

  it("resolves duplicate operations for the same venue using latest timestamp", async () => {
    const res = await POST(
      makeReq({
        operations: [
          { venueId: "venue_db_1", action: "remove", timestamp: 200 },
          { venueId: "venue_db_1", action: "add", timestamp: 100 },
          { venueId: "place_2", action: "remove", timestamp: 100 },
          { venueId: "venue_db_2", action: "add", timestamp: 300 },
        ],
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.processed).toBe(2);
    expect(prisma.favorite.createMany).toHaveBeenCalledWith({
      data: [{ userId: "user_sync_1", venueId: "venue_db_2" }],
      skipDuplicates: true,
    });
    expect(prisma.favorite.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user_sync_1", venueId: { in: ["venue_db_1"] } },
    });
  });

  it("rejects empty batches, non-arrays, missing venueId, invalid action, and invalid timestamp with 400 and no DB writes", async () => {
    const invalidPayloads = [
      { operations: [] },
      { operations: null },
      { operations: "invalid" },
      { operations: [null] },
      { operations: [{ venueId: "", action: "add", timestamp: 100 }] },
      { operations: [{ action: "add", timestamp: 100 }] },
      {
        operations: [
          { venueId: "venue_db_1", action: "upsert", timestamp: 100 },
        ],
      },
      { operations: [{ venueId: "venue_db_1", action: "add", timestamp: -5 }] },
      {
        operations: [
          { venueId: "venue_db_1", action: "add", timestamp: "100" },
        ],
      },
      {
        operations: [{ venueId: "venue_db_1", action: "add", timestamp: null }],
      },
    ];

    for (const payload of invalidPayloads) {
      const res = await POST(makeReq(payload));
      expect(res.status).toBe(400);
    }

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.venue.create).not.toHaveBeenCalled();
    expect(prisma.favorite.createMany).not.toHaveBeenCalled();
    expect(prisma.favorite.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects oversized batches exceeding MAX_BULK_FAVORITE_OPERATIONS before DB writes", async () => {
    const operations = Array.from(
      { length: MAX_BULK_FAVORITE_OPERATIONS + 1 },
      (_, idx) => ({
        venueId: `venue_${idx}`,
        action: "add" as const,
        timestamp: 1790000000000 + idx,
      }),
    );

    const res = await POST(makeReq({ operations }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/Maximum 100 operations/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.venue.create).not.toHaveBeenCalled();
  });

  it("never creates Unknown Venue (0,0) placeholders for unknown venueIds on add, preventing partial writes", async () => {
    const res = await POST(
      makeReq({
        operations: [
          { venueId: "venue_db_1", action: "add", timestamp: 100 },
          { venueId: "unknown-test-venue-001", action: "add", timestamp: 101 },
        ],
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.unknownVenueIds).toEqual(["unknown-test-venue-001"]);
    expect(prisma.venue.create).not.toHaveBeenCalled();
    expect(prisma.favorite.createMany).not.toHaveBeenCalled();
    expect(prisma.favorite.deleteMany).not.toHaveBeenCalled();
  });

  it("handles remove operations for unknown venueIds idempotently without errors or placeholder writes", async () => {
    (prisma.venue.findMany as jest.Mock).mockResolvedValue([]);

    const res = await POST(
      makeReq({
        operations: [
          {
            venueId: "already-deleted-venue",
            action: "remove",
            timestamp: 100,
          },
        ],
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ success: true, processed: 1 });
    expect(prisma.venue.create).not.toHaveBeenCalled();
    expect(prisma.favorite.createMany).not.toHaveBeenCalled();
  });

  it("enforces per-user rate limiting with HTTP 429", async () => {
    let lastRes;
    for (let i = 0; i < 31; i++) {
      lastRes = await POST(
        makeReq({
          operations: [
            { venueId: "venue_db_1", action: "add", timestamp: 1790000000000 },
          ],
        }),
      );
    }

    expect(lastRes!.status).toBe(429);
    expect(lastRes!.headers.get("Retry-After")).toBeTruthy();
  });

  it("preserves existing favorite tag sync behavior", async () => {
    const updates = [{ id: "tag_1", name: "quiet", color: "#22c55e" }];
    (prisma.favoriteTag.findMany as jest.Mock).mockResolvedValue([
      { id: "tag_1" },
    ]);
    (syncFavoriteTagsBulk as jest.Mock).mockResolvedValue(updates);

    const res = await POST(makeReq({ updates }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.tags).toEqual(updates);
  });
});
