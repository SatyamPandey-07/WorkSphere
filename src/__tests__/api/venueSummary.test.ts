import { GET } from "@/app/api/venues/[venueId]/summary/route";
import { prisma } from "@/lib/prisma";
import { generateGeminiText } from "@/lib/ai/gemini";
import { NextRequest } from "next/server";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("@/lib/ai/gemini", () => ({
  generateGeminiText: jest.fn(),
}));

describe("GET /api/venues/[venueId]/summary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns a generated summary for an existing venue", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "venue-123",
      category: "cafe",
      wifiQuality: 4,
      hasOutlets: true,
      noiseLevel: "moderate",
      hasErgonomic: false,
      hasPhoneBooths: true,
      hasQuietZone: false,
      outletDensity: "some",
    });

    (generateGeminiText as jest.Mock).mockResolvedValue(
      "This cafe offers reliable Wi-Fi and a moderate noise level. Power outlets and phone booths make it suitable for focused remote work."
    );

    const req = new NextRequest(
      "http://localhost/api/venues/venue-123/summary"
    );

    const response = await GET(req, {
      params: Promise.resolve({ venueId: "venue-123" }),
    });

    expect(response.status).toBe(200);

    const data = await response.json();

    expect(data.summary).toBe(
      "This cafe offers reliable Wi-Fi and a moderate noise level. Power outlets and phone booths make it suitable for focused remote work."
    );

    expect(prisma.venue.findUnique).toHaveBeenCalledWith({
      where: { id: "venue-123" },
    });

    expect(generateGeminiText).toHaveBeenCalledTimes(1);

    expect(generateGeminiText).toHaveBeenCalledWith(
      expect.stringContaining('"category": "cafe"')
    );
  });

  it("returns 400 when the venue ID is missing", async () => {
    const req = new NextRequest(
      "http://localhost/api/venues//summary"
    );

    const response = await GET(req, {
      params: Promise.resolve({ venueId: "" }),
    });

    expect(response.status).toBe(400);

    const data = await response.json();

    expect(data.error).toBe("Venue ID is required");

    expect(prisma.venue.findUnique).not.toHaveBeenCalled();
    expect(generateGeminiText).not.toHaveBeenCalled();
  });

  it("returns 404 when the venue does not exist", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest(
      "http://localhost/api/venues/nonexistent/summary"
    );

    const response = await GET(req, {
      params: Promise.resolve({ venueId: "nonexistent" }),
    });

    expect(response.status).toBe(404);

    const data = await response.json();

    expect(data.error).toBe("Venue not found");

    expect(generateGeminiText).not.toHaveBeenCalled();
  });

  it("returns 500 when Gemini fails", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "venue-123",
      category: "cafe",
      wifiQuality: 4,
      hasOutlets: true,
      noiseLevel: "moderate",
      hasErgonomic: false,
      hasPhoneBooths: true,
      hasQuietZone: false,
      outletDensity: "some",
    });

    (generateGeminiText as jest.Mock).mockRejectedValue(
      new Error("Gemini service unavailable")
    );

    const req = new NextRequest(
      "http://localhost/api/venues/venue-123/summary"
    );

    const response = await GET(req, {
      params: Promise.resolve({ venueId: "venue-123" }),
    });

    expect(response.status).toBe(500);

    const data = await response.json();

    expect(data.error).toBe("Failed to generate venue summary");
  });
});