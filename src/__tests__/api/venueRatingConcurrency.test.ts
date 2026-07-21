import { POST } from "@/app/api/venues/[venueId]/rate/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: jest.fn().mockResolvedValue({ id: "user_test_123" }),
}));

jest.mock("@/lib/agents/MemoryAgent", () => ({
  updateUserPreferencesSummary: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      upsert: jest.fn(),
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      update: jest.fn(),
    },
    venueRating: {
      upsert: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    wifiTelemetry: {
      create: jest.fn(),
    },
  },
}));

describe("POST /api/venues/[venueId]/rate — Concurrent Updates & Key Collision Resilience (#280)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth as jest.Mock).mockResolvedValue({ userId: "user_test_123" });

    (prisma.venue.upsert as jest.Mock).mockResolvedValue({
      id: "venue_123",
      placeId: "place_123",
      name: "Test Cafe",
    });

    (prisma.venueRating.findMany as jest.Mock).mockResolvedValue([
      { wifiQuality: 4, hasOutlets: true },
    ]);
  });

  it("handles concurrent rating upserts gracefully when Prisma throws unique constraint P2002 error", async () => {
    const p2002Error = new Error("Unique constraint failed");
    (p2002Error as any).code = "P2002";

    (prisma.venueRating.upsert as jest.Mock).mockRejectedValueOnce(p2002Error);
    (prisma.venueRating.update as jest.Mock).mockResolvedValueOnce({
      id: "rating_123",
      userId: "user_test_123",
      venueId: "venue_123",
      wifiQuality: 5,
    });

    const body = {
      wifiQuality: 5,
      hasOutlets: true,
      noiseLevel: "quiet",
      comment: "Great wifi!",
    };

    const req = new NextRequest(
      "http://localhost:3000/api/venues/venue_123/rate",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );

    const response = await POST(req, {
      params: Promise.resolve({ venueId: "venue_123" }),
    });
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.rating).toBeDefined();
    expect(prisma.venueRating.update).toHaveBeenCalled();
  });

  it("successfully processes concurrent requests without throwing 500 server errors", async () => {
    (prisma.venueRating.upsert as jest.Mock).mockResolvedValue({
      id: "rating_123",
      userId: "user_test_123",
      venueId: "venue_123",
      wifiQuality: 4,
    });

    const body = {
      wifiQuality: 4,
      hasOutlets: true,
      noiseLevel: "moderate",
    };

    const req1 = new NextRequest(
      "http://localhost:3000/api/venues/venue_123/rate",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );

    const req2 = new NextRequest(
      "http://localhost:3000/api/venues/venue_123/rate",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );

    const [res1, res2] = await Promise.all([
      POST(req1, { params: Promise.resolve({ venueId: "venue_123" }) }),
      POST(req2, { params: Promise.resolve({ venueId: "venue_123" }) }),
    ]);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
  });
});
