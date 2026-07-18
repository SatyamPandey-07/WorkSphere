import { NextRequest } from "next/server";
import { GET } from "@/app/api/venues/route";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

describe("GET /api/venues - Search and Pagination", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      },
    });
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
