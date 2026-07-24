import { GET } from "@/app/api/venues/route";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn().mockResolvedValue({ userId: null }),
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
  getRateLimitInfo: jest.fn().mockResolvedValue({ count: 1, remaining: 59 }),
}));

describe("GET /api/venues with multi-city filter (#860)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("filters venues matching specified cities parameter", async () => {
    (prisma.venue.count as jest.Mock).mockResolvedValue(2);
    (prisma.venue.findMany as jest.Mock).mockResolvedValue([
      { id: "v1", name: "SF Cafe", address: "Market St, San Francisco" },
      { id: "v2", name: "Tokyo Cowork", address: "Shibuya, Tokyo" },
    ]);

    const req = new NextRequest(
      "http://localhost/api/venues?cities=San%20Francisco,Tokyo",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.venues).toHaveLength(2);
    expect(prisma.venue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { address: { contains: "San Francisco", mode: "insensitive" } },
            { address: { contains: "Tokyo", mode: "insensitive" } },
          ],
        }),
      }),
    );
  });

  it("filters venues matching specified cities parameter with mixed casing", async () => {
    (prisma.venue.count as jest.Mock).mockResolvedValue(1);
    (prisma.venue.findMany as jest.Mock).mockResolvedValue([
      { id: "v1", name: "SF Cafe", address: "Market St, San Francisco" },
    ]);

    const req = new NextRequest(
      "http://localhost/api/venues?cities=sAn%20FRANcisco,TOKYO",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.venues).toHaveLength(1);
    expect(prisma.venue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { address: { contains: "sAn FRANcisco", mode: "insensitive" } },
            { address: { contains: "TOKYO", mode: "insensitive" } },
          ],
        }),
      }),
    );
  });
});
