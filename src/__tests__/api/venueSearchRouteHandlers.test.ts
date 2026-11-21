import { NextRequest } from "next/server";
import * as route from "@/app/api/venues/search/route";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

jest.mock("@/lib/cache/venueCache", () => ({
  getLatestVenueTimestamp: jest.fn().mockResolvedValue(1700000000000),
  generateETag: jest.fn().mockReturnValue('"1700000000000"'),
}));

jest.mock("@/lib/search/phoneticVenueSearch", () => ({
  searchVenuesPhonetic: jest.fn().mockResolvedValue([]),
}));

const baseUrl = "https://work-sphere.vercel.app/api/venues/search";

describe("/api/venues/search serves both the GET search and the POST semantic search", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("exports GET, POST and the shouldBypassCache helper", () => {
    expect(typeof route.GET).toBe("function");
    expect(typeof route.POST).toBe("function");
    expect(typeof route.shouldBypassCache).toBe("function");
  });

  it("GET returns the venues found near the given coordinates", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([
      {
        id: "v_near_1",
        name: "Bean Around the World",
        category: "cafe",
        address: "12 Cordova St",
        rating: 4.6,
        imageUrl: null,
        latitude: 49.2827,
        longitude: -123.1207,
        distanceMeters: 421.5,
      },
    ]);

    const response = await route.GET(
      new NextRequest(new URL(`${baseUrl}?lat=49.2827&lng=-123.1207`), {
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(JSON.stringify(body)).toContain("Bean Around the World");
  });

  it("POST still validates the semantic search body", async () => {
    const invalid = await route.POST(
      new NextRequest(new URL(baseUrl), {
        method: "POST",
        body: JSON.stringify({ query: "" }),
      }),
    );
    expect(invalid.status).toBe(400);

    const valid = await route.POST(
      new NextRequest(new URL(baseUrl), {
        method: "POST",
        body: JSON.stringify({ query: "quiet cafe with wifi" }),
      }),
    );
    expect(valid.status).toBe(200);
    expect((await valid.json()).query).toBe("quiet cafe with wifi");
  });
});
