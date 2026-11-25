/** @jest-environment node */

import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  GET,
  POST as listingPost,
} from "@/app/api/social/skill-exchange/route";
import { POST as matchPost } from "@/app/api/social/skill-exchange/match/route";
import { prisma } from "@/lib/prisma";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    skillListing: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    skillMatch: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

const mockAuth = auth as jest.Mock;
const mockFindMany = prisma.skillListing.findMany as jest.Mock;
const mockFindUnique = prisma.skillListing.findUnique as jest.Mock;
const mockCreateListing = prisma.skillListing.create as jest.Mock;
const mockTransaction = prisma.$transaction as jest.Mock;

function createGetRequest(query = ""): NextRequest {
  const url = query
    ? `http://localhost/api/social/skill-exchange?${query}`
    : "http://localhost/api/social/skill-exchange";
  return new NextRequest(url, { method: "GET" });
}

function createPostRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Issue #9584 - Persistent Skill Exchange Listings & Transactional Matching", () => {
  const currentUserId = "user_nomad_proposer";

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: currentUserId });
    mockFindMany.mockResolvedValue([]);
    mockFindUnique.mockResolvedValue(null);
  });

  describe("GET /api/social/skill-exchange", () => {
    it("retrieves open listings from database scoped to venueId", async () => {
      const now = new Date();
      mockFindMany.mockResolvedValue([
        {
          id: "listing-db-1",
          venueId: "venue-berlin-01",
          venueName: "Betahaus Mitte",
          userId: "user-anna",
          userName: "Anna",
          userTitle: "Frontend Dev",
          offeringSkill: "React 19",
          offeringCategory: "CODE_DEV",
          seekingSkill: "Figma UX",
          seekingCategory: "DESIGN_UI",
          durationMinutes: 30,
          meetupSpot: "Cafe Booth 1",
          status: "OPEN",
          reputationScore: 98,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const res = await GET(createGetRequest("venueId=venue-berlin-01"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.venueId).toBe("venue-berlin-01");
      expect(json.totalListings).toBe(1);
      expect(json.listings[0].offeringSkill).toBe("React 19");
      expect(mockFindMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          venueId: "venue-berlin-01",
          status: "OPEN",
        }),
        orderBy: { createdAt: "desc" },
      });
    });

    it("applies category filter when provided", async () => {
      await GET(createGetRequest("venueId=venue-sf-01&category=CODE_DEV"));
      expect(mockFindMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          venueId: "venue-sf-01",
          status: "OPEN",
          OR: [
            { offeringCategory: "CODE_DEV" },
            { seekingCategory: "CODE_DEV" },
          ],
        }),
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("POST /api/social/skill-exchange", () => {
    it("rejects unauthenticated requests with 401 Unauthorized", async () => {
      mockAuth.mockResolvedValue({ userId: null });

      const res = await listingPost(
        createPostRequest("http://localhost/api/social/skill-exchange", {
          offeringSkill: "Next.js",
          seekingSkill: "SEO",
        }),
      );
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("rejects requests missing offeringSkill or seekingSkill with 400 Bad Request", async () => {
      const res = await listingPost(
        createPostRequest("http://localhost/api/social/skill-exchange", {
          offeringSkill: "Next.js",
        }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(
        /both offeringskill and seekingskill are required/i,
      );
    });

    it("persists skill listing in database bound to session userId", async () => {
      const now = new Date();
      mockCreateListing.mockResolvedValue({
        id: "listing-new-123",
        venueId: "venue-sf-01",
        venueName: "SoMa Hub",
        userId: currentUserId,
        userName: "Alex Nomad",
        userTitle: "Fullstack Eng",
        offeringSkill: "Rust",
        offeringCategory: "CODE_DEV",
        seekingSkill: "Go",
        seekingCategory: "CODE_DEV",
        durationMinutes: 30,
        meetupSpot: "Terrace Table",
        status: "OPEN",
        reputationScore: 100,
        createdAt: now,
        updatedAt: now,
      });

      const res = await listingPost(
        createPostRequest("http://localhost/api/social/skill-exchange", {
          venueId: "venue-sf-01",
          offeringSkill: "Rust",
          offeringCategory: "CODE_DEV",
          seekingSkill: "Go",
          seekingCategory: "CODE_DEV",
          durationMinutes: 30,
          userName: "Alex Nomad",
          userTitle: "Fullstack Eng",
          meetupSpot: "Terrace Table",
        }),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.listing.userId).toBe(currentUserId);
      expect(json.listing.status).toBe("OPEN");
      expect(mockCreateListing).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: currentUserId,
          offeringSkill: "Rust",
          seekingSkill: "Go",
          status: "OPEN",
        }),
      });
    });
  });

  describe("POST /api/social/skill-exchange/match", () => {
    it("rejects unauthenticated requests with 401 Unauthorized", async () => {
      mockAuth.mockResolvedValue({ userId: null });

      const res = await matchPost(
        createPostRequest("http://localhost/api/social/skill-exchange/match", {
          listingId: "listing-123",
        }),
      );
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("rejects missing listingId with 400 Bad Request", async () => {
      const res = await matchPost(
        createPostRequest(
          "http://localhost/api/social/skill-exchange/match",
          {},
        ),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/missing or invalid listingId/i);
    });

    it("returns 404 when listing does not exist in DB", async () => {
      mockFindUnique.mockResolvedValue(null);

      const res = await matchPost(
        createPostRequest("http://localhost/api/social/skill-exchange/match", {
          listingId: "listing-not-found",
        }),
      );
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.code).toBe("LISTING_NOT_FOUND");
    });

    it("rejects self-match attempt when user attempts to match their own listing", async () => {
      mockFindUnique.mockResolvedValue({
        id: "listing-own",
        userId: currentUserId, // matches session
        status: "OPEN",
      });

      const res = await matchPost(
        createPostRequest("http://localhost/api/social/skill-exchange/match", {
          listingId: "listing-own",
        }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe("SELF_MATCH_DISALLOWED");
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("rejects match with 409 Conflict when listing is already MATCHED", async () => {
      mockFindUnique.mockResolvedValue({
        id: "listing-matched",
        userId: "user-creator",
        status: "MATCHED",
      });

      const res = await matchPost(
        createPostRequest("http://localhost/api/social/skill-exchange/match", {
          listingId: "listing-matched",
        }),
      );
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.code).toBe("LISTING_ALREADY_MATCHED");
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("transactionally marks listing as MATCHED and creates confirmed SkillMatch record", async () => {
      mockFindUnique.mockResolvedValue({
        id: "listing-valid",
        userId: "user-other-creator",
        status: "OPEN",
        meetupSpot: "Coffee Counter Island",
      });

      mockTransaction.mockResolvedValue([
        { id: "listing-valid", status: "MATCHED" },
        {
          id: "match-generated-789",
          listingId: "listing-valid",
          proposerId: currentUserId,
          proposerName: "Visiting Nomad",
          meetupSpot: "Coffee Counter Island",
          meetupTime: "In 15 Minutes",
          status: "CONFIRMED",
        },
      ]);

      const res = await matchPost(
        createPostRequest("http://localhost/api/social/skill-exchange/match", {
          listingId: "listing-valid",
          proposerName: "Visiting Nomad",
        }),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.match.status).toBe("CONFIRMED");
      expect(json.match.matchId).toBe("match-generated-789");
      expect(mockTransaction).toHaveBeenCalled();
    });
  });
});
