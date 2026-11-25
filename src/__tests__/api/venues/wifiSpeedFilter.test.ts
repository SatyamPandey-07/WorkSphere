jest.mock("svix", () => ({
  Webhook: jest.fn(),
}));

import { NextRequest } from "next/server";
import { GET as getVenues } from "@/app/api/venues/route";
import { GET as searchVenues } from "@/app/api/venues/search/route";
import { prisma } from "@/lib/prisma";
import { searchVenuesPhonetic } from "@/lib/search/phoneticVenueSearch";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn().mockResolvedValue({ userId: null }),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
  },
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
  getRateLimitInfo: jest
    .fn()
    .mockResolvedValue({ resetTime: Date.now() + 60000 }),
  resetRateLimit: jest.fn(),
}));

jest.mock("@/lib/cache/venueCache", () => ({
  getLatestVenueTimestamp: jest.fn().mockResolvedValue(1700000000000),
  generateETag: jest.fn().mockReturnValue('"1700000000000"'),
}));

jest.mock("@/lib/search/phoneticVenueSearch", () => ({
  searchVenuesPhonetic: jest.fn(),
}));

jest.mock("@/lib/search/spatialVenueSearch", () => ({
  DEFAULT_SEARCH_RADIUS_METERS: 5000,
  MAX_SEARCH_RADIUS_METERS: 100000,
  MAX_SPATIAL_RESULT_LIMIT: 50,
  searchVenuesNearby: jest.fn().mockResolvedValue([]),
}));

describe("minWifiSpeed API Filtering (#9893)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/venues", () => {
    it("applies wifiSpeed >= 100 filter when minWifiSpeed=100 is provided", async () => {
      (prisma.venue.findMany as jest.Mock).mockResolvedValue([
        {
          id: "v-fast",
          name: "Fast Space",
          wifiSpeed: 120,
        },
      ]);
      (prisma.venue.count as jest.Mock).mockResolvedValue(1);

      const request = new NextRequest(
        "http://localhost:3000/api/venues?minWifiSpeed=100",
      );
      const response = await getVenues(request);

      expect(response.status).toBe(200);
      expect(prisma.venue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            wifiSpeed: { gte: 100 },
          }),
        }),
      );
    });

    it("applies wifiSpeed >= 100 filter when spatial search with lat/lng is used", async () => {
      (prisma.venue.findMany as jest.Mock).mockResolvedValue([
        {
          id: "v-spatial",
          name: "Spatial Fiber Hub",
          wifiSpeed: 200,
        },
      ]);
      (prisma.venue.count as jest.Mock).mockResolvedValue(1);

      const request = new NextRequest(
        "http://localhost:3000/api/venues?lat=12.9716&lng=77.5946&radius=5000&minWifiSpeed=100",
      );
      const response = await getVenues(request);

      expect(response.status).toBe(200);
      expect(prisma.venue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            wifiSpeed: { gte: 100 },
          }),
        }),
      );
    });
  });

  describe("GET /api/venues/search", () => {
    it("filters out venues with wifiSpeed < 100 when minWifiSpeed=100 is present", async () => {
      (searchVenuesPhonetic as jest.Mock).mockResolvedValue([
        {
          id: "v-1",
          name: "High Speed CoWork",
          wifiSpeed: 150,
        },
        {
          id: "v-2",
          name: "Slow CoWork",
          wifiSpeed: 30,
        },
        {
          id: "v-3",
          name: "Gigabit Cafe",
          amenities: { wifiSpeed: 100 },
        },
      ]);

      const request = new NextRequest(
        "http://localhost:3000/api/venues/search?q=cowork&minWifiSpeed=100",
      );
      const response = await searchVenues(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.venues.length).toBe(2);
      expect(data.venues[0].id).toBe("v-1");
      expect(data.venues[1].id).toBe("v-3");
    });
  });
});
