import { NextRequest } from "next/server";
import {
  GET,
  DEFAULT_PUBLIC_COLLECTIONS_LIMIT,
  MAX_PUBLIC_COLLECTIONS_LIMIT,
  encodePublicCollectionsCursor,
  decodePublicCollectionsCursor,
} from "@/app/api/collections/public/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

interface MockPublicFolder {
  id: string;
  name: string;
  description: string | null;
  color: string;
  ownerId: string;
  isPublic: boolean;
  upvotes: number;
  createdAt: Date;
  updatedAt: Date;
  owner: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    imageUrl: string | null;
  };
  _count: { venues: number; members: number };
  upvotedBy: string[];
}

const dataset: MockPublicFolder[] = [];

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    folder: {
      findMany: jest.fn(),
    },
  },
}));

const mockedAuth = auth as unknown as jest.Mock;
const mockedFindMany = prisma.folder.findMany as jest.Mock;

function matchesCursorOrClause(
  folder: MockPublicFolder,
  orClauses: any[],
): boolean {
  return orClauses.some((clause) => {
    if (clause.upvotes?.lt !== undefined) {
      return folder.upvotes < clause.upvotes.lt;
    }
    if (clause.upvotes !== undefined && clause.createdAt?.lt instanceof Date) {
      return (
        folder.upvotes === clause.upvotes &&
        folder.createdAt.getTime() < clause.createdAt.lt.getTime()
      );
    }
    if (
      clause.upvotes !== undefined &&
      clause.createdAt instanceof Date &&
      clause.id?.lt !== undefined
    ) {
      return (
        folder.upvotes === clause.upvotes &&
        folder.createdAt.getTime() === clause.createdAt.getTime() &&
        folder.id < clause.id.lt
      );
    }
    return false;
  });
}

function wireLiveDatasetFindMany() {
  mockedFindMany.mockImplementation(async ({ where, take, include }: any) => {
    const upvoteWhereUserId =
      include?.upvoteRefs && typeof include.upvoteRefs === "object"
        ? include.upvoteRefs.where?.userId
        : null;

    let filtered = dataset.filter(
      (f) => Boolean(f.isPublic) === Boolean(where?.isPublic),
    );
    if (Array.isArray(where?.OR)) {
      filtered = filtered.filter((f) => matchesCursorOrClause(f, where.OR));
    }

    filtered = [...filtered].sort((a, b) => {
      if (b.upvotes !== a.upvotes) return b.upvotes - a.upvotes;
      const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.id.localeCompare(a.id);
    });

    const sliced =
      typeof take === "number" ? filtered.slice(0, take) : filtered;
    return sliced.map((f) => {
      const { upvotedBy, ...rest } = f;
      if (!upvoteWhereUserId) {
        return rest;
      }
      return {
        ...rest,
        upvoteRefs: upvotedBy.includes(upvoteWhereUserId)
          ? [{ folderId: f.id, userId: upvoteWhereUserId }]
          : [],
      };
    });
  });
}

function makeFolder(
  id: string,
  upvotes: number,
  isoDate: string,
  opts: Partial<MockPublicFolder> = {},
): MockPublicFolder {
  const createdAt = new Date(isoDate);
  return {
    id,
    name: `Collection ${id}`,
    description: "Curated focus spots",
    color: "#3b82f6",
    ownerId: "owner_1",
    isPublic: true,
    upvotes,
    createdAt,
    updatedAt: createdAt,
    owner: {
      id: "owner_1",
      firstName: "Alice",
      lastName: "Lee",
      imageUrl: null,
    },
    _count: { venues: 3, members: 2 },
    upvotedBy: [],
    ...opts,
  };
}

describe("GET /api/collections/public cursor pagination", () => {
  beforeEach(() => {
    dataset.length = 0;
    jest.clearAllMocks();
    mockedAuth.mockResolvedValue({ userId: "user_1" });
    wireLiveDatasetFindMany();
  });

  it("rejects invalid limit or corrupted cursor with 400", async () => {
    const badLimitZero = await GET(
      new NextRequest("https://app.test/api/collections/public?limit=0"),
    );
    expect(badLimitZero.status).toBe(400);

    const badLimitText = await GET(
      new NextRequest("https://app.test/api/collections/public?limit=abc"),
    );
    expect(badLimitText.status).toBe(400);

    const badCursor = await GET(
      new NextRequest(
        "https://app.test/api/collections/public?cursor=invalid!!",
      ),
    );
    expect(badCursor.status).toBe(400);
    expect(mockedFindMany).not.toHaveBeenCalled();
  });

  it("returns empty folders and null cursor on empty discovery feed", async () => {
    const res = await GET(
      new NextRequest("https://app.test/api/collections/public"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      folders: [],
      pagination: { hasMore: false, nextCursor: null },
    });
    expect(mockedFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: DEFAULT_PUBLIC_COLLECTIONS_LIMIT + 1,
        orderBy: [{ upvotes: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      }),
    );
  });

  it("clamps oversized limit to MAX_PUBLIC_COLLECTIONS_LIMIT and computes hasUpvoted", async () => {
    dataset.push(
      makeFolder("col_a", 10, "2026-11-01T10:00:00.000Z", {
        upvotedBy: ["user_1"],
      }),
      makeFolder("col_b", 5, "2026-11-01T09:00:00.000Z"),
    );

    const res = await GET(
      new NextRequest("https://app.test/api/collections/public?limit=999"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockedFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: MAX_PUBLIC_COLLECTIONS_LIMIT + 1 }),
    );
    expect(json.folders).toHaveLength(2);
    expect(json.folders[0].hasUpvoted).toBe(true);
    expect(json.folders[1].hasUpvoted).toBe(false);
    expect(json.pagination).toEqual({ hasMore: false, nextCursor: null });
  });

  it("paginates stably across tied upvotes and identical timestamps using id tie-breaker", async () => {
    dataset.push(
      makeFolder("col_1", 10, "2026-11-01T12:00:00.000Z"),
      makeFolder("col_2", 5, "2026-11-01T12:00:00.000Z"),
      makeFolder("col_3", 5, "2026-11-01T12:00:00.000Z"),
      makeFolder("col_4", 5, "2026-11-01T12:00:00.000Z"),
      makeFolder("col_5", 2, "2026-11-01T10:00:00.000Z"),
    );

    const page1Res = await GET(
      new NextRequest("https://app.test/api/collections/public?limit=2"),
    );
    const page1 = await page1Res.json();

    expect(page1Res.status).toBe(200);
    expect(page1.folders.map((f: any) => f.id)).toEqual(["col_1", "col_4"]);
    expect(page1.pagination.hasMore).toBe(true);
    expect(typeof page1.pagination.nextCursor).toBe("string");

    const decoded = decodePublicCollectionsCursor(page1.pagination.nextCursor);
    expect(decoded).toMatchObject({ upvotes: 5, id: "col_4" });

    const page2Res = await GET(
      new NextRequest(
        `https://app.test/api/collections/public?limit=2&cursor=${encodeURIComponent(page1.pagination.nextCursor)}`,
      ),
    );
    const page2 = await page2Res.json();
    expect(page2.folders.map((f: any) => f.id)).toEqual(["col_3", "col_2"]);
    expect(page2.pagination.hasMore).toBe(true);

    const page3Res = await GET(
      new NextRequest(
        `https://app.test/api/collections/public?limit=2&cursor=${encodeURIComponent(page2.pagination.nextCursor)}`,
      ),
    );
    const page3 = await page3Res.json();
    expect(page3.folders.map((f: any) => f.id)).toEqual(["col_5"]);
    expect(page3.pagination).toEqual({ hasMore: false, nextCursor: null });
  });

  it("handles unauthenticated users with hasUpvoted=false and continues paginating if cursor anchor becomes private mid-scroll", async () => {
    mockedAuth.mockResolvedValue({ userId: null });

    dataset.push(
      makeFolder("col_high", 20, "2026-11-01T12:00:00.000Z"),
      makeFolder("col_anchor", 10, "2026-11-01T11:00:00.000Z"),
      makeFolder("col_next", 4, "2026-11-01T10:00:00.000Z"),
    );

    const page1Res = await GET(
      new NextRequest("https://app.test/api/collections/public?limit=2"),
    );
    const page1 = await page1Res.json();
    expect(page1.folders.map((f: any) => f.id)).toEqual([
      "col_high",
      "col_anchor",
    ]);
    expect(page1.folders.every((f: any) => f.hasUpvoted === false)).toBe(true);

    // Mutate dataset concurrently before page 2: anchor made private and a new higher-voted item appears on page 1
    dataset[1].isPublic = false;
    dataset.push(makeFolder("col_new_top", 25, "2026-11-01T13:00:00.000Z"));

    const page2Res = await GET(
      new NextRequest(
        `https://app.test/api/collections/public?limit=2&cursor=${encodeURIComponent(page1.pagination.nextCursor)}`,
      ),
    );
    const page2 = await page2Res.json();

    expect(page2Res.status).toBe(200);
    expect(page2.folders.map((f: any) => f.id)).toEqual(["col_next"]);
    expect(page2.pagination).toEqual({ hasMore: false, nextCursor: null });

    const manualCursor = encodePublicCollectionsCursor({
      id: "col_anchor",
      upvotes: 10,
      createdAt: new Date("2026-11-01T11:00:00.000Z"),
    });
    expect(manualCursor).toBe(page1.pagination.nextCursor);
  });
});
