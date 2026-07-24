import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "@/app/api/favorites/route";
import {
  GET as GET_TAGS,
  POST as POST_TAGS,
} from "@/app/api/favorites/[favoriteId]/tags/route";
import {
  PATCH as PATCH_INDIVIDUAL_TAG,
  DELETE as DELETE_INDIVIDUAL_TAG,
} from "@/app/api/favorites/[favoriteId]/tags/[tagId]/route";
import { POST as POST_SYNC_TAGS } from "@/app/api/favorites/tags/sync/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { syncFavoriteTagsBulk } from "@/lib/favoriteTagSync";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: jest.fn().mockResolvedValue({ id: "user_test_123" }),
}));

jest.mock("@/lib/agents/MemoryAgent", () => ({
  updateUserPreferencesSummary: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/lib/favoriteTagSync", () => ({
  syncFavoriteTagsBulk: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    favorite: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
    },
    venue: {
      upsert: jest.fn(),
      findFirst: jest.fn(),
    },
    favoriteTag: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

const mockAuth = auth as unknown as jest.Mock;

describe("GET /api/favorites", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user_test_123" });
  });

  it("returns 401 if unauthorized", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await GET();

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns an empty list when user has no favorites", async () => {
    (prisma.favorite.findMany as jest.Mock).mockResolvedValue([]);

    const res = await GET();

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.favorites).toEqual([]);
  });

  it("returns favorites with venue and tags ordered by createdAt desc", async () => {
    const mockFavorites = [
      {
        id: "fav_1",
        userId: "user_test_123",
        venueId: "venue_1",
        venue: { id: "venue_1", name: "Test Cafe" },
        tags: [{ id: "tag_1", name: "quiet", color: "#22c55e" }],
        createdAt: new Date("2026-07-23T12:00:00Z"),
      },
    ];
    (prisma.favorite.findMany as jest.Mock).mockResolvedValue(mockFavorites);

    const res = await GET();

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.favorites).toHaveLength(1);
    expect(data.favorites[0].id).toBe("fav_1");
    expect(data.favorites[0].venue.name).toBe("Test Cafe");
    expect(data.favorites[0].tags[0].name).toBe("quiet");

    expect(prisma.favorite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_test_123" },
        orderBy: { createdAt: "desc" },
      }),
    );
  });
});

describe("POST /api/favorites", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user_test_123" });
  });

  it("returns 401 if unauthorized", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const req = new NextRequest("http://localhost/api/favorites", {
      method: "POST",
      body: JSON.stringify({ venueId: "place_123" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 400 if venueId is missing", async () => {
    const req = new NextRequest("http://localhost/api/favorites", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("venueId is required");
  });

  it("creates a venue via upsert and adds a favorite", async () => {
    const mockDbVenue = {
      id: "venue_123",
      placeId: "place_123",
      name: "Test Cafe",
    };
    (prisma.venue.upsert as jest.Mock).mockResolvedValue(mockDbVenue);

    const mockFavorite = {
      id: "fav_123",
      userId: "user_test_123",
      venueId: "venue_123",
      venue: mockDbVenue,
      tags: [],
    };
    (prisma.favorite.upsert as jest.Mock).mockResolvedValue(mockFavorite);

    const req = new NextRequest("http://localhost/api/favorites", {
      method: "POST",
      body: JSON.stringify({
        venueId: "place_123",
        name: "Test Cafe",
        latitude: 37.7749,
        longitude: -122.4194,
        category: "cafe",
        address: "123 Main St",
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.favorite.id).toBe("fav_123");
    expect(data.favorite.venue.name).toBe("Test Cafe");

    expect(prisma.venue.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { placeId: "place_123" },
        create: expect.objectContaining({ name: "Test Cafe" }),
      }),
    );
    expect(prisma.favorite.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_venueId: { userId: "user_test_123", venueId: "venue_123" },
        },
      }),
    );
  });

  it("returns 409 when the same venue is favorited again", async () => {
    (prisma.venue.upsert as jest.Mock).mockResolvedValue({
      id: "venue_123",
      placeId: "place_123",
    });
    (prisma.favorite.upsert as jest.Mock).mockRejectedValue({ code: "P2002" });

    const req = new NextRequest("http://localhost/api/favorites", {
      method: "POST",
      body: JSON.stringify({ venueId: "place_123" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("Already in favorites");
  });
});

describe("DELETE /api/favorites", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user_test_123" });
  });

  it("returns 401 if unauthorized", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const req = new NextRequest(
      "http://localhost/api/favorites?venueId=place_123",
      {
        method: "DELETE",
      },
    );
    const res = await DELETE(req);

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 400 if venueId is missing", async () => {
    const req = new NextRequest("http://localhost/api/favorites", {
      method: "DELETE",
    });
    const res = await DELETE(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("venueId is required");
  });

  it("returns success if venue does not exist", async () => {
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest(
      "http://localhost/api/favorites?venueId=nonexistent",
      {
        method: "DELETE",
      },
    );
    const res = await DELETE(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it("removes a favorite and returns success", async () => {
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue({
      id: "venue_123",
    });
    (prisma.favorite.delete as jest.Mock).mockResolvedValue({ id: "fav_123" });

    const req = new NextRequest(
      "http://localhost/api/favorites?venueId=venue_123",
      {
        method: "DELETE",
      },
    );
    const res = await DELETE(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    expect(prisma.favorite.delete).toHaveBeenCalledWith({
      where: {
        userId_venueId: { userId: "user_test_123", venueId: "venue_123" },
      },
    });
  });

  it("treats already-deleted favorite as success (P2025)", async () => {
    (prisma.venue.findFirst as jest.Mock).mockResolvedValue({
      id: "venue_123",
    });
    (prisma.favorite.delete as jest.Mock).mockRejectedValue({ code: "P2025" });

    const req = new NextRequest(
      "http://localhost/api/favorites?venueId=venue_123",
      {
        method: "DELETE",
      },
    );
    const res = await DELETE(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });
});

describe("GET /api/favorites/[favoriteId]/tags", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user_test_123" });
  });

  it("returns 401 if unauthorized", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await GET_TAGS(
      new NextRequest("http://localhost/api/favorites/fav_123/tags"),
      { params: Promise.resolve({ favoriteId: "fav_123" }) },
    );

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 404 if favorite is not found", async () => {
    (prisma.favorite.findFirst as jest.Mock).mockResolvedValue(null);

    const res = await GET_TAGS(
      new NextRequest("http://localhost/api/favorites/fav_123/tags"),
      { params: Promise.resolve({ favoriteId: "fav_123" }) },
    );

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Favorite not found");
  });

  it("returns tags ordered by createdAt asc", async () => {
    (prisma.favorite.findFirst as jest.Mock).mockResolvedValue({
      id: "fav_123",
      userId: "user_test_123",
    });
    const mockTags = [
      { id: "tag_1", favoriteId: "fav_123", name: "quiet", color: "#22c55e" },
      { id: "tag_2", favoriteId: "fav_123", name: "wifi", color: "#3b82f6" },
    ];
    (prisma.favoriteTag.findMany as jest.Mock).mockResolvedValue(mockTags);

    const res = await GET_TAGS(
      new NextRequest("http://localhost/api/favorites/fav_123/tags"),
      { params: Promise.resolve({ favoriteId: "fav_123" }) },
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tags).toHaveLength(2);
    expect(data.tags[0].name).toBe("quiet");
    expect(prisma.favoriteTag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { favoriteId: "fav_123" },
        orderBy: { createdAt: "asc" },
      }),
    );
  });
});

describe("POST /api/favorites/[favoriteId]/tags", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user_test_123" });
  });

  it("returns 401 if unauthorized", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const req = new NextRequest("http://localhost/api/favorites/fav_123/tags", {
      method: "POST",
      body: JSON.stringify({ name: "quiet", color: "#22c55e" }),
    });
    const res = await POST_TAGS(req, {
      params: Promise.resolve({ favoriteId: "fav_123" }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 400 for invalid body (missing name)", async () => {
    (prisma.favorite.findFirst as jest.Mock).mockResolvedValue({
      id: "fav_123",
      userId: "user_test_123",
    });

    const req = new NextRequest("http://localhost/api/favorites/fav_123/tags", {
      method: "POST",
      body: JSON.stringify({ color: "#22c55e" }),
    });
    const res = await POST_TAGS(req, {
      params: Promise.resolve({ favoriteId: "fav_123" }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("name");
  });

  it("returns 404 if favorite is not found", async () => {
    (prisma.favorite.findFirst as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/favorites/fav_123/tags", {
      method: "POST",
      body: JSON.stringify({ name: "quiet", color: "#22c55e" }),
    });
    const res = await POST_TAGS(req, {
      params: Promise.resolve({ favoriteId: "fav_123" }),
    });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Favorite not found");
  });

  it("creates a tag and returns it with status 201", async () => {
    (prisma.favorite.findFirst as jest.Mock).mockResolvedValue({
      id: "fav_123",
      userId: "user_test_123",
    });
    const mockTag = {
      id: "tag_new",
      favoriteId: "fav_123",
      name: "quiet",
      color: "#22c55e",
    };
    (prisma.favoriteTag.create as jest.Mock).mockResolvedValue(mockTag);

    const req = new NextRequest("http://localhost/api/favorites/fav_123/tags", {
      method: "POST",
      body: JSON.stringify({ name: "quiet", color: "#22c55e" }),
    });
    const res = await POST_TAGS(req, {
      params: Promise.resolve({ favoriteId: "fav_123" }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.tag.name).toBe("quiet");
    expect(data.tag.color).toBe("#22c55e");
  });

  it("returns 409 when a tag with the same name already exists", async () => {
    (prisma.favorite.findFirst as jest.Mock).mockResolvedValue({
      id: "fav_123",
      userId: "user_test_123",
    });
    (prisma.favoriteTag.create as jest.Mock).mockRejectedValue({
      code: "P2002",
    });

    const req = new NextRequest("http://localhost/api/favorites/fav_123/tags", {
      method: "POST",
      body: JSON.stringify({ name: "quiet", color: "#22c55e" }),
    });
    const res = await POST_TAGS(req, {
      params: Promise.resolve({ favoriteId: "fav_123" }),
    });

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("Tag with this name already exists");
  });
});

describe("PATCH /api/favorites/[favoriteId]/tags/[tagId]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user_test_123" });
  });

  it("returns 401 if unauthorized", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const req = new NextRequest(
      "http://localhost/api/favorites/fav_123/tags/tag_123",
      {
        method: "PATCH",
        body: JSON.stringify({ name: "noisy" }),
      },
    );
    const res = await PATCH_INDIVIDUAL_TAG(req, {
      params: Promise.resolve({ favoriteId: "fav_123", tagId: "tag_123" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 if favorite not found", async () => {
    (prisma.favorite.findFirst as jest.Mock).mockResolvedValue(null);
    const req = new NextRequest(
      "http://localhost/api/favorites/fav_123/tags/tag_123",
      {
        method: "PATCH",
        body: JSON.stringify({ name: "noisy" }),
      },
    );
    const res = await PATCH_INDIVIDUAL_TAG(req, {
      params: Promise.resolve({ favoriteId: "fav_123", tagId: "tag_123" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 if tag not found", async () => {
    (prisma.favorite.findFirst as jest.Mock).mockResolvedValue({
      id: "fav_123",
    });
    (prisma.favoriteTag.findFirst as jest.Mock).mockResolvedValue(null);
    const req = new NextRequest(
      "http://localhost/api/favorites/fav_123/tags/tag_123",
      {
        method: "PATCH",
        body: JSON.stringify({ name: "noisy" }),
      },
    );
    const res = await PATCH_INDIVIDUAL_TAG(req, {
      params: Promise.resolve({ favoriteId: "fav_123", tagId: "tag_123" }),
    });
    expect(res.status).toBe(404);
  });

  it("updates tag successfully", async () => {
    (prisma.favorite.findFirst as jest.Mock).mockResolvedValue({
      id: "fav_123",
    });
    (prisma.favoriteTag.findFirst as jest.Mock).mockResolvedValue({
      id: "tag_123",
    });
    (prisma.favoriteTag.update as jest.Mock).mockResolvedValue({
      id: "tag_123",
      name: "noisy",
    });

    const req = new NextRequest(
      "http://localhost/api/favorites/fav_123/tags/tag_123",
      {
        method: "PATCH",
        body: JSON.stringify({ name: "noisy" }),
      },
    );
    const res = await PATCH_INDIVIDUAL_TAG(req, {
      params: Promise.resolve({ favoriteId: "fav_123", tagId: "tag_123" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tag.name).toBe("noisy");
  });
});

describe("DELETE /api/favorites/[favoriteId]/tags/[tagId]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user_test_123" });
  });

  it("deletes tag successfully", async () => {
    (prisma.favorite.findFirst as jest.Mock).mockResolvedValue({
      id: "fav_123",
    });
    (prisma.favoriteTag.findFirst as jest.Mock).mockResolvedValue({
      id: "tag_123",
    });
    (prisma.favoriteTag.delete as jest.Mock).mockResolvedValue({
      id: "tag_123",
    });

    const req = new NextRequest(
      "http://localhost/api/favorites/fav_123/tags/tag_123",
      {
        method: "DELETE",
      },
    );
    const res = await DELETE_INDIVIDUAL_TAG(req, {
      params: Promise.resolve({ favoriteId: "fav_123", tagId: "tag_123" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });
});

describe("POST /api/favorites/tags/sync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user_test_123" });
  });

  it("syncs tags successfully", async () => {
    const mockUpdates = [{ id: "tag_1", name: "quiet", color: "#22c55e" }];
    (prisma.favoriteTag.findMany as jest.Mock).mockResolvedValue([
      { id: "tag_1" },
    ]);
    (syncFavoriteTagsBulk as jest.Mock).mockResolvedValue(mockUpdates);

    const req = new NextRequest("http://localhost/api/favorites/tags/sync", {
      method: "POST",
      body: JSON.stringify({ updates: mockUpdates }),
    });
    const res = await POST_SYNC_TAGS(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tags).toHaveLength(1);
    expect(data.tags[0].name).toBe("quiet");
  });
});
