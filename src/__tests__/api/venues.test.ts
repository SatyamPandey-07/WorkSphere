import { NextRequest } from "next/server";
import { GET } from "@/app/api/venues/route";
import { prisma } from "@/lib/prisma";
import { resetRateLimit } from "@/lib/rateLimit";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
  },
}));

jest.mock("svix", () => ({
  Webhook: jest.fn(),
}));

describe("GET /api/venues - Search and Pagination", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimit();
  });

  it("should return paginated venues with default values in fallback mode", async () => {
    const mockVenues = [
      { id: "1", name: "Venue 1" },
      { id: "2", name: "Venue 2" },
    ];
    (prisma.venue.count as jest.Mock).mockResolvedValue(120);
    (prisma.venue.findMany as jest.Mock).mockResolvedValue(mockVenues);

    const req = new NextRequest("http://localhost/api/venues");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.venues).toEqual(mockVenues);
    expect(data.pagination).toEqual({
      page: 1,
      limit: 50,
      total: 120,
      totalPages: 3,
      hasNextPage: true,
    });

    expect(prisma.venue.findMany).toHaveBeenCalledWith({
      skip: 0,
      take: 50,
      include: {
        _count: {
          select: { favorites: true, ratings: true },
        },
        foodValidations: true,
      },
    });
  });

  it("should support custom page and limit parameters in fallback mode", async () => {
    const mockVenues = [{ id: "3", name: "Venue 3" }];
    (prisma.venue.count as jest.Mock).mockResolvedValue(120);
    (prisma.venue.findMany as jest.Mock).mockResolvedValue(mockVenues);

    const req = new NextRequest("http://localhost/api/venues?page=3&limit=20");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.venues).toEqual(mockVenues);
    expect(data.pagination).toEqual({
      page: 3,
      limit: 20,
      total: 120,
      totalPages: 6,
      hasNextPage: true,
    });

    expect(prisma.venue.findMany).toHaveBeenCalledWith({
      skip: 40,
      take: 20,
      include: {
        _count: {
          select: { favorites: true, ratings: true },
        },
        foodValidations: true,
      },
    });
  });

  it("should enforce maximum limit of 100", async () => {
    const mockVenues = [{ id: "1", name: "Venue 1" }];
    (prisma.venue.count as jest.Mock).mockResolvedValue(150);
    (prisma.venue.findMany as jest.Mock).mockResolvedValue(mockVenues);

    const req = new NextRequest("http://localhost/api/venues?limit=250");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pagination.limit).toBe(100);

    expect(prisma.venue.findMany).toHaveBeenCalledWith({
      skip: 0,
      take: 100,
      include: {
        _count: {
          select: { favorites: true, ratings: true },
        },
        foodValidations: true,
      },
    });
  });

  it("should filter by text query in fallback mode across valid venue fields (name, address)", async () => {
    const mockVenues = [
      { id: "1", name: "Blue Bottle Coffee", address: "123 Main St" },
    ];
    (prisma.venue.count as jest.Mock).mockResolvedValue(1);
    (prisma.venue.findMany as jest.Mock).mockResolvedValue(mockVenues);
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ id: "1", score: 0.03 }]);

    const req = new NextRequest("http://localhost/api/venues?q=coffee");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.venues).toEqual(mockVenues);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const queryTemplate = (prisma.$queryRaw as jest.Mock).mock.calls[0][0];
    const sql = queryTemplate.strings.join(" ");
    expect(sql).toContain("WITH search_input");
    expect(sql).toContain("rank_bm25");
    expect(sql).toContain("rank_vector");
    expect(sql).toContain("1.0 / (60 + rank_bm25)");
    expect(sql).toContain("1.0 / (60 + rank_vector)");
    expect(prisma.venue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["1"] } } }),
    );
  });

  it("should filter by text query in coordinate mode across valid venue fields (name, address)", async () => {
    const mockVenues = [
      { id: "2", name: "Philz Coffee", address: "456 Market St" },
    ];
    (prisma.venue.count as jest.Mock).mockResolvedValue(1);
    (prisma.venue.findMany as jest.Mock).mockResolvedValue(mockVenues);
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ id: "2", score: 0.03 }]);

    const req = new NextRequest(
      "http://localhost/api/venues?lat=37.7749&lng=-122.4194&radius=1000&query=coffee",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.venues).toEqual(mockVenues);

    expect(prisma.venue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            expect.objectContaining({
              latitude: expect.any(Object),
              longitude: expect.any(Object),
            }),
            { id: { in: ["2"] } },
          ],
        },
      }),
    );
  });

  it("should paginate coordinate-based search results", async () => {
    const mockVenues = [{ id: "10", name: "Venue 10" }];
    (prisma.venue.count as jest.Mock).mockResolvedValue(5);
    (prisma.venue.findMany as jest.Mock).mockResolvedValue(mockVenues);

    const req = new NextRequest(
      "http://localhost/api/venues?lat=37.7749&lng=-122.4194&radius=1000&page=2&limit=2",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.venues).toEqual(mockVenues);
    expect(data.pagination).toEqual({
      page: 2,
      limit: 2,
      total: 5,
      totalPages: 3,
      hasNextPage: true,
    });

    expect(prisma.venue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 2,
        take: 2,
        where: expect.objectContaining({
          latitude: expect.any(Object),
          longitude: expect.any(Object),
        }),
      }),
    );
  });
});

describe("GET /api/venues - Rate limiting (#717)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimit();
    (prisma.venue.count as jest.Mock).mockResolvedValue(0);
    (prisma.venue.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("allows a burst of fast requests (e.g. rapid autocomplete typing) through", async () => {
    // Simulate someone typing a long query quickly - many requests in a row from
    // the same caller should not trip the limiter, since it's tuned well above
    // realistic keystroke-driven request volume.
    for (let i = 0; i < 30; i++) {
      const req = new NextRequest(`http://localhost/api/venues?limit=5`);
      const res = await GET(req);
      expect(res.status).toBe(200);
    }
  });

  it("returns 429 with a retryAfter once the caller exceeds the limit", async () => {
    let lastRes;
    for (let i = 0; i < 61; i++) {
      const req = new NextRequest(`http://localhost/api/venues?limit=5`);
      lastRes = await GET(req);
    }

    expect(lastRes!.status).toBe(429);
    const data = await lastRes!.json();
    expect(data.error).toMatch(/too many/i);
    expect(typeof data.retryAfter).toBe("number");
    expect(lastRes!.headers.get("Retry-After")).toBeTruthy();
  });

  it("does not touch the database once a request is rate limited", async () => {
    for (let i = 0; i < 61; i++) {
      const req = new NextRequest(`http://localhost/api/venues?limit=5`);
      await GET(req);
    }

    const callsBefore = (prisma.venue.findMany as jest.Mock).mock.calls.length;

    const req = new NextRequest(`http://localhost/api/venues?limit=5`);
    const res = await GET(req);

    expect(res.status).toBe(429);
    expect((prisma.venue.findMany as jest.Mock).mock.calls.length).toBe(
      callsBefore,
    );
  });
});
