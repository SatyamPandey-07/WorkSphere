import { NextRequest } from "next/server";
import { POST } from "@/app/api/venues/[venueId]/flag/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { invalidateVenueReviewsCache } from "@/lib/cache/swrCache";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findUnique: jest.fn(),
    },
    flaggedItem: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(),
}));

jest.mock("@/lib/cache/swrCache", () => ({
  invalidateVenueReviewsCache: jest.fn(),
}));

const mockedAuth = auth as jest.Mock;
const mockedRateLimit = rateLimit as jest.Mock;
const mockedPrisma = prisma as jest.Mocked<typeof prisma>;
const mockedInvalidateCache = invalidateVenueReviewsCache as jest.Mock;

describe("POST /api/venues/[venueId]/flag reason validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedAuth.mockResolvedValue({ userId: "user-1" });
    mockedRateLimit.mockResolvedValue(true);

    mockedPrisma.venue.findUnique.mockResolvedValue({
      id: "venue-1",
    } as any);

    mockedPrisma.flaggedItem.findFirst.mockResolvedValue(null);
    mockedPrisma.flaggedItem.create.mockResolvedValue({} as any);
    mockedInvalidateCache.mockResolvedValue(undefined);
  });

  it("trims whitespace before checking the maximum reason length", async () => {
    const reason = `${" ".repeat(50)}other${" ".repeat(50)}`;

    const req = new NextRequest(
      "https://app.test/api/venues/venue-1/flag",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      },
    );

    const res = await POST(req, {
      params: Promise.resolve({ venueId: "venue-1" }),
    });

    expect(res.status).toBe(200);
    expect(mockedPrisma.flaggedItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reason: "other",
          itemId: "venue-1",
          reportedById: "user-1",
        }),
      }),
    );
  });

  it("rejects whitespace-only reasons", async () => {
    const req = new NextRequest(
      "https://app.test/api/venues/venue-1/flag",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "     " }),
      },
    );

    const res = await POST(req, {
      params: Promise.resolve({ venueId: "venue-1" }),
    });

    expect(res.status).toBe(400);
    expect(mockedPrisma.flaggedItem.create).not.toHaveBeenCalled();
  });
});
