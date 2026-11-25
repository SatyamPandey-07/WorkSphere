import { NextRequest } from "next/server";
import { POST } from "@/app/api/collections/public/upvote/route";
import { auth } from "@clerk/nextjs/server";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";
import { prisma } from "@/lib/prisma";

interface MockFolderRow {
  id: string;
  isPublic: boolean;
  upvotes: number;
}

const folders = new Map<string, MockFolderRow>();
const upvoteKeys = new Map<string, string>(); // `${folderId}:${userId}` -> id
let nextUpvoteId = 1;

function makeTx() {
  return {
    folder: {
      findUnique: jest.fn(async ({ where }: any) => {
        const row = folders.get(where.id);
        return row ? { ...row } : null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = folders.get(where.id);
        if (!row) throw Object.assign(new Error("Missing"), { code: "P2025" });
        const increment = data.upvotes?.increment ?? 0;
        const decrement = data.upvotes?.decrement ?? 0;
        row.upvotes = row.upvotes + increment - decrement;
        return { ...row };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = folders.get(where.id);
        if (!row) return { count: 0 };
        if (
          where.upvotes?.lt !== undefined &&
          !(row.upvotes < where.upvotes.lt)
        ) {
          return { count: 0 };
        }
        if (typeof data.upvotes === "number") {
          row.upvotes = data.upvotes;
        }
        return { count: 1 };
      }),
    },
    folderUpvote: {
      findUnique: jest.fn(async ({ where }: any) => {
        const key = `${where.folderId_userId.folderId}:${where.folderId_userId.userId}`;
        const id = upvoteKeys.get(key);
        return id ? { id } : null;
      }),
      createMany: jest.fn(async ({ data, skipDuplicates }: any) => {
        let count = 0;
        for (const entry of data) {
          const key = `${entry.folderId}:${entry.userId}`;
          if (upvoteKeys.has(key)) {
            if (skipDuplicates) continue;
            throw Object.assign(new Error("Unique constraint failed"), {
              code: "P2002",
            });
          }
          upvoteKeys.set(key, `upv_${nextUpvoteId++}`);
          count += 1;
        }
        return { count };
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const key = `${where.folderId}:${where.userId}`;
        if (!upvoteKeys.has(key)) {
          return { count: 0 };
        }
        upvoteKeys.delete(key);
        return { count: 1 };
      }),
    },
  };
}

const txMock = makeTx();

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(),
  getRateLimitInfo: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    ...makeTx(),
    $transaction: jest.fn(async (cb: (tx: typeof txMock) => Promise<any>) =>
      cb(txMock),
    ),
  },
}));

const mockedAuth = auth as unknown as jest.Mock;
const mockedRateLimit = rateLimit as jest.Mock;
const mockedRateLimitInfo = getRateLimitInfo as jest.Mock;
const mockedPrisma = prisma as unknown as {
  folder: typeof txMock.folder;
  folderUpvote: typeof txMock.folderUpvote;
  $transaction: jest.Mock;
};

describe("POST /api/collections/public/upvote", () => {
  beforeEach(() => {
    folders.clear();
    upvoteKeys.clear();
    nextUpvoteId = 1;
    jest.clearAllMocks();

    mockedAuth.mockResolvedValue({ userId: "user_1" });
    mockedRateLimit.mockResolvedValue(true);
    mockedRateLimitInfo.mockResolvedValue({
      count: 6,
      remaining: 0,
      resetTime: Date.now() + 30_000,
      isLimited: true,
    });

    // Share live backing store across prisma root & txMock
    mockedPrisma.folder.findUnique.mockImplementation(txMock.folder.findUnique);
    mockedPrisma.folder.update.mockImplementation(txMock.folder.update);
    mockedPrisma.folder.updateMany.mockImplementation(txMock.folder.updateMany);
    mockedPrisma.folderUpvote.findUnique.mockImplementation(
      txMock.folderUpvote.findUnique,
    );
    mockedPrisma.folderUpvote.createMany.mockImplementation(
      txMock.folderUpvote.createMany,
    );
    mockedPrisma.folderUpvote.deleteMany.mockImplementation(
      txMock.folderUpvote.deleteMany,
    );
  });

  function makeReq(body: unknown) {
    return new NextRequest("https://app.test/api/collections/public/upvote", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  it("enforces authentication and rate limits", async () => {
    mockedAuth.mockResolvedValueOnce({ userId: null });
    const unauth = await POST(makeReq({ folderId: "pub_1" }));
    expect(unauth.status).toBe(401);

    mockedRateLimit.mockResolvedValueOnce(false);
    const limited = await POST(makeReq({ folderId: "pub_1" }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
  });

  it("returns 400 on malformed JSON or empty folderId, 404 when missing, and 400 when private", async () => {
    const badJson = await POST(
      new NextRequest("https://app.test/api/collections/public/upvote", {
        method: "POST",
        body: "{not-json",
      }),
    );
    expect(badJson.status).toBe(400);

    const emptyId = await POST(makeReq({ folderId: "   " }));
    expect(emptyId.status).toBe(400);

    const missing = await POST(makeReq({ folderId: "missing" }));
    expect(missing.status).toBe(404);

    folders.set("priv_1", { id: "priv_1", isPublic: false, upvotes: 0 });
    const priv = await POST(makeReq({ folderId: "priv_1" }));
    expect(priv.status).toBe(400);
  });

  it("handles concurrent upvote toggles from the same user without P2002 errors or counter drift", async () => {
    folders.set("pub_race", { id: "pub_race", isPublic: true, upvotes: 0 });

    // Force BOTH racing transactions to initially observe existingUpvote === null
    let raceLookups = 0;
    txMock.folderUpvote.findUnique.mockImplementationOnce(async () => {
      raceLookups += 1;
      await Promise.resolve();
      return null;
    });
    txMock.folderUpvote.findUnique.mockImplementationOnce(async () => {
      raceLookups += 1;
      await Promise.resolve();
      return null;
    });

    const [resA, resB] = await Promise.all([
      POST(makeReq({ folderId: "pub_race" })),
      POST(makeReq({ folderId: "pub_race" })),
    ]);

    expect(raceLookups).toBe(2);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const bodyA = await resA.json();
    const bodyB = await resB.json();

    expect(bodyA).toMatchObject({
      success: true,
      hasUpvoted: true,
      upvotes: 1,
    });
    expect(bodyB).toMatchObject({
      success: true,
      hasUpvoted: true,
      upvotes: 1,
    });
    expect(folders.get("pub_race")?.upvotes).toBe(1);
    expect(upvoteKeys.size).toBe(1);
  });

  it("handles concurrent un-upvotes from the same user without P2025 errors or negative counts", async () => {
    folders.set("pub_unvote", { id: "pub_unvote", isPublic: true, upvotes: 1 });
    upvoteKeys.set("pub_unvote:user_1", "upv_seed");

    // Force BOTH racing transactions to initially observe existingUpvote !== null
    txMock.folderUpvote.findUnique
      .mockResolvedValueOnce({ id: "upv_seed" })
      .mockResolvedValueOnce({ id: "upv_seed" });

    const [resA, resB] = await Promise.all([
      POST(makeReq({ folderId: "pub_unvote" })),
      POST(makeReq({ folderId: "pub_unvote" })),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const bodyA = await resA.json();
    const bodyB = await resB.json();

    expect(bodyA).toMatchObject({
      success: true,
      hasUpvoted: false,
      upvotes: 0,
    });
    expect(bodyB).toMatchObject({
      success: true,
      hasUpvoted: false,
      upvotes: 0,
    });
    expect(folders.get("pub_unvote")?.upvotes).toBe(0);
    expect(upvoteKeys.size).toBe(0);
  });

  it("accurately increments upvotes across concurrent distinct users", async () => {
    folders.set("pub_multi", { id: "pub_multi", isPublic: true, upvotes: 0 });

    mockedAuth
      .mockResolvedValueOnce({ userId: "user_a" })
      .mockResolvedValueOnce({ userId: "user_b" });

    const [resA, resB] = await Promise.all([
      POST(makeReq({ folderId: "pub_multi" })),
      POST(makeReq({ folderId: "pub_multi" })),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(folders.get("pub_multi")?.upvotes).toBe(2);
    expect(upvoteKeys.has("pub_multi:user_a")).toBe(true);
    expect(upvoteKeys.has("pub_multi:user_b")).toBe(true);
  });

  it("resolves gracefully if an underlying transaction throws P2002", async () => {
    folders.set("pub_p2002", { id: "pub_p2002", isPublic: true, upvotes: 1 });
    upvoteKeys.set("pub_p2002:user_1", "upv_committed");

    mockedPrisma.$transaction.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint violation"), {
        code: "P2002",
      }),
    );

    const res = await POST(makeReq({ folderId: "pub_p2002" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: true, hasUpvoted: true, upvotes: 1 });
  });

  it("supports idempotent desired upvote state without double-toggling", async () => {
    folders.set("pub_desired", {
      id: "pub_desired",
      isPublic: true,
      upvotes: 0,
    });

    const first = await POST(
      makeReq({ folderId: "pub_desired", upvote: true }),
    );
    expect(await first.json()).toMatchObject({
      success: true,
      hasUpvoted: true,
      upvotes: 1,
    });

    const duplicateDesired = await POST(
      makeReq({ folderId: "pub_desired", upvote: true }),
    );
    expect(await duplicateDesired.json()).toMatchObject({
      success: true,
      hasUpvoted: true,
      upvotes: 1,
    });

    const clear = await POST(
      makeReq({ folderId: "pub_desired", upvote: false }),
    );
    expect(await clear.json()).toMatchObject({
      success: true,
      hasUpvoted: false,
      upvotes: 0,
    });
  });
});
