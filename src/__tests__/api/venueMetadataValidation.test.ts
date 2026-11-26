/** @jest-environment node */

import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { POST } from "@/app/api/venues/route";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { analyzeVenueImage } from "@/lib/agents/VisionAgent";
import {
  venueSupplementalMetadataSchema,
  venueCreateSchema,
} from "@/lib/validations";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn().mockResolvedValue(true),
  getRateLimitInfo: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/lib/agents/VisionAgent", () => ({
  analyzeVenueImage: jest.fn().mockResolvedValue({
    isWorkspace: true,
    visibleOutlets: true,
    confidenceScore: 90,
  }),
}));

jest.mock("@/lib/webhooks/deliver", () => ({
  emitWebhookEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/search/hybridVenueSearch", () => ({
  scheduleTrendingVenueSearchPrefetch: jest.fn(),
  searchVenuesWithRrf: jest.fn().mockResolvedValue([]),
  labelFuzzySuggestions: jest.fn().mockResolvedValue([]),
  indexVenueSearchEmbedding: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

const mockAuth = auth as jest.Mock;
const mockEnsureUserExists = ensureUserExists as jest.Mock;
const mockAnalyzeVenueImage = analyzeVenueImage as jest.Mock;
const mockFindUnique = prisma.venue.findUnique as jest.Mock;
const mockUpsert = prisma.venue.upsert as jest.Mock;

describe("Issue #9839 - Validate Supplemental Metadata Before Database Upsert", () => {
  const testUserId = "user_venue_curator_123";

  const validBasePayload = {
    name: "Cyber Cafe Nomad",
    latitude: 37.7749,
    longitude: -122.4194,
    category: "cafe",
    address: "123 Tech Boulevard, SF",
    wifiQuality: 4,
    hasOutlets: true,
    noiseLevel: "moderate",
    placeId: "place_google_sf_001",
    rating: 4.5,
    imageUrl: "https://images.example.com/venues/cyber-cafe.jpg",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: testUserId });
    mockEnsureUserExists.mockResolvedValue(undefined);
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockResolvedValue({
      id: "venue_123",
      ...validBasePayload,
      creatorId: testUserId,
    });
  });

  describe("venueSupplementalMetadataSchema Schema Validation", () => {
    it("validates valid supplemental metadata", () => {
      const parsed = venueSupplementalMetadataSchema.parse({
        placeId: "place_test_abc",
        rating: 4.8,
        imageUrl: "https://cdn.example.com/photo.png",
      });

      expect(parsed.placeId).toBe("place_test_abc");
      expect(parsed.rating).toBe(4.8);
      expect(parsed.imageUrl).toBe("https://cdn.example.com/photo.png");
    });

    it("rejects empty placeId", () => {
      expect(() =>
        venueSupplementalMetadataSchema.parse({
          placeId: "   ",
        }),
      ).toThrow();
    });

    it("rejects placeId exceeding 255 characters", () => {
      expect(() =>
        venueSupplementalMetadataSchema.parse({
          placeId: "a".repeat(256),
        }),
      ).toThrow();
    });

    it("rejects rating below 0 or above 5", () => {
      expect(() =>
        venueSupplementalMetadataSchema.parse({
          placeId: "valid_id",
          rating: -0.5,
        }),
      ).toThrow();

      expect(() =>
        venueSupplementalMetadataSchema.parse({
          placeId: "valid_id",
          rating: 5.5,
        }),
      ).toThrow();
    });

    it("rejects unsafe or non-http/https imageUrl schemes", () => {
      expect(() =>
        venueSupplementalMetadataSchema.parse({
          placeId: "valid_id",
          imageUrl: "javascript:alert(1)",
        }),
      ).toThrow();

      expect(() =>
        venueSupplementalMetadataSchema.parse({
          placeId: "valid_id",
          imageUrl: "file:///etc/passwd",
        }),
      ).toThrow();

      expect(() =>
        venueSupplementalMetadataSchema.parse({
          placeId: "valid_id",
          imageUrl: "not-a-valid-url",
        }),
      ).toThrow();
    });

    it("accepts null, empty string, or undefined for optional rating and imageUrl", () => {
      const parsed = venueSupplementalMetadataSchema.parse({
        placeId: "valid_id",
        rating: null,
        imageUrl: "",
      });

      expect(parsed.rating).toBeNull();
      expect(parsed.imageUrl).toBe("");
    });
  });

  describe("venueCreateSchema Integration", () => {
    it("validates placeId, rating, and imageUrl within venueCreateSchema", () => {
      const parsed = venueCreateSchema.parse(validBasePayload);
      expect(parsed.placeId).toBe("place_google_sf_001");
      expect(parsed.rating).toBe(4.5);
      expect(parsed.imageUrl).toBe(
        "https://images.example.com/venues/cyber-cafe.jpg",
      );
    });

    it("fails venueCreateSchema if rating is invalid", () => {
      expect(() =>
        venueCreateSchema.parse({
          ...validBasePayload,
          rating: 10,
        }),
      ).toThrow();
    });

    it("fails venueCreateSchema if imageUrl is invalid", () => {
      expect(() =>
        venueCreateSchema.parse({
          ...validBasePayload,
          imageUrl: "ftp://files.example.com/pic.png",
        }),
      ).toThrow();
    });
  });

  describe("POST /api/venues Route Enforcement", () => {
    it("returns 400 Bad Request when placeId is missing or empty", async () => {
      const req = new NextRequest("http://localhost/api/venues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validBasePayload,
          placeId: "",
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toBeDefined();
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it("returns 400 Bad Request when rating is out of range", async () => {
      const req = new NextRequest("http://localhost/api/venues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validBasePayload,
          rating: 8.5,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toContain("Rating must be between 0 and 5");
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it("returns 400 Bad Request when imageUrl is malicious or invalid", async () => {
      const req = new NextRequest("http://localhost/api/venues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validBasePayload,
          imageUrl: "javascript:/*malicious*/alert(1)",
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toBeDefined();
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it("sanitizes and safely passes valid supplemental metadata to prisma.venue.upsert", async () => {
      const req = new NextRequest("http://localhost/api/venues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBasePayload),
      });

      const res = await POST(req);
      expect(res.status).toBe(201);

      expect(mockAnalyzeVenueImage).toHaveBeenCalledWith(
        "https://images.example.com/venues/cyber-cafe.jpg",
        expect.any(Object),
      );

      expect(mockUpsert).toHaveBeenCalledWith({
        where: { placeId: "place_google_sf_001" },
        update: expect.objectContaining({
          imageUrl: "https://images.example.com/venues/cyber-cafe.jpg",
        }),
        create: expect.objectContaining({
          placeId: "place_google_sf_001",
          rating: 4.5,
          imageUrl: "https://images.example.com/venues/cyber-cafe.jpg",
          creatorId: testUserId,
        }),
      });
    });
  });
});
