import { POST } from "@/app/api/venues/amenity-vote/route";
import { GET as getMetrics } from "@/app/api/venues/[venueId]/amenity-votes/route";
import { GET as getLeaderboard } from "@/app/api/venues/[venueId]/amenity-votes/leaderboard/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    amenityValidation: {
      upsert: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    amenityVote: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    venue: { update: jest.fn() },
    userBadge: { findMany: jest.fn(), create: jest.fn(), upsert: jest.fn() },
    user: { update: jest.fn(), findMany: jest.fn() },
  },
}));

const venueContext = (venueId = "venue-1") => ({
  params: Promise.resolve({ venueId }),
});

function voteRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/venues/amenity-vote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/venues/amenity-vote", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user-1" });
    (prisma.userBadge.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("rejects anonymous voters with 401", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

    const res = await POST(
      voteRequest({ venueId: "venue-1", amenity: "wifi", isUpvote: true }),
    );

    expect(res.status).toBe(401);
    expect(prisma.amenityValidation.upsert).not.toHaveBeenCalled();
  });

  it("rejects a body missing isUpvote with 400", async () => {
    const res = await POST(
      voteRequest({ venueId: "venue-1", amenity: "wifi" }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing required parameters");
  });

  it("increments the count when a new upvote is created", async () => {
    (prisma.amenityValidation.upsert as jest.Mock).mockResolvedValue({
      id: "val-1",
      amenity: "wifi",
      upvotes: 0,
      downvotes: 0,
    });
    (prisma.amenityVote.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.amenityValidation.update as jest.Mock).mockResolvedValue({
      id: "val-1",
      amenity: "wifi",
      upvotes: 1,
      downvotes: 0,
    });

    const res = await POST(
      voteRequest({ venueId: "venue-1", amenity: "wifi", isUpvote: true }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      amenity: "wifi",
      upvotes: 1,
      downvotes: 0,
      confidenceScore: 100,
      hidden: false,
    });
    expect(prisma.amenityVote.create).toHaveBeenCalledWith({
      data: { validationId: "val-1", userId: "user-1", isUpvote: true },
    });
  });

  it("leaves counts untouched when the same vote is resubmitted", async () => {
    (prisma.amenityValidation.upsert as jest.Mock).mockResolvedValue({
      id: "val-1",
      amenity: "wifi",
      upvotes: 3,
      downvotes: 1,
    });
    (prisma.amenityVote.findUnique as jest.Mock).mockResolvedValue({
      id: "vote-1",
      isUpvote: true,
    });

    const res = await POST(
      voteRequest({ venueId: "venue-1", amenity: "wifi", isUpvote: true }),
    );

    const body = await res.json();
    expect(body.upvotes).toBe(3);
    expect(body.downvotes).toBe(1);
    expect(body.confidenceScore).toBe(75);
    expect(prisma.amenityVote.create).not.toHaveBeenCalled();
    expect(prisma.amenityVote.update).not.toHaveBeenCalled();
    expect(prisma.amenityValidation.update).not.toHaveBeenCalled();
  });

  it("toggles the counts when a voter flips their vote", async () => {
    (prisma.amenityValidation.upsert as jest.Mock).mockResolvedValue({
      id: "val-1",
      amenity: "wifi",
      upvotes: 3,
      downvotes: 1,
    });
    (prisma.amenityVote.findUnique as jest.Mock).mockResolvedValue({
      id: "vote-1",
      isUpvote: false,
    });
    (prisma.amenityValidation.update as jest.Mock).mockResolvedValue({
      id: "val-1",
      amenity: "wifi",
      upvotes: 4,
      downvotes: 0,
    });

    const res = await POST(
      voteRequest({ venueId: "venue-1", amenity: "wifi", isUpvote: true }),
    );

    expect(prisma.amenityVote.update).toHaveBeenCalledWith({
      where: { id: "vote-1" },
      data: { isUpvote: true },
    });
    expect(prisma.amenityValidation.update).toHaveBeenCalledWith({
      where: { id: "val-1" },
      data: { upvotes: { increment: 1 }, downvotes: { decrement: 1 } },
    });

    const body = await res.json();
    expect(body.upvotes).toBe(4);
    expect(body.downvotes).toBe(0);
  });

  it("flips the venue pet flag once an amenity reaches five upvotes", async () => {
    (prisma.amenityValidation.upsert as jest.Mock).mockResolvedValue({
      id: "val-1",
      amenity: "dogFriendly",
      upvotes: 4,
      downvotes: 0,
    });
    (prisma.amenityVote.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.amenityValidation.update as jest.Mock).mockResolvedValue({
      id: "val-1",
      amenity: "dogFriendly",
      upvotes: 5,
      downvotes: 0,
    });

    await POST(
      voteRequest({
        venueId: "venue-1",
        amenity: "dogFriendly",
        isUpvote: true,
      }),
    );

    expect(prisma.venue.update).toHaveBeenCalledWith({
      where: { id: "venue-1" },
      data: { dogFriendly: true },
    });
  });
});

describe("GET /api/venues/[venueId]/amenity-votes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user-1" });
  });

  it("computes confidence, hidden flag and the caller's own vote", async () => {
    (prisma.amenityValidation.findMany as jest.Mock).mockResolvedValue([
      {
        amenity: "wifi",
        upvotes: 8,
        downvotes: 2,
        votes: [{ userId: "user-1", isUpvote: true }],
      },
      {
        amenity: "outlets",
        upvotes: 1,
        downvotes: 9,
        votes: [{ userId: "other-user", isUpvote: true }],
      },
    ]);

    const res = await getMetrics(
      new NextRequest("http://localhost/api/venues/venue-1/amenity-votes"),
      venueContext(),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics.wifi).toMatchObject({
      confidenceScore: 80,
      upvotes: 8,
      downvotes: 2,
      hidden: false,
      userVote: true,
    });
    expect(body.metrics.outlets).toMatchObject({
      confidenceScore: 10,
      hidden: true,
      userVote: null,
    });
  });

  it("returns an empty metrics map for a venue with no validations", async () => {
    (prisma.amenityValidation.findMany as jest.Mock).mockResolvedValue([]);

    const res = await getMetrics(
      new NextRequest("http://localhost/api/venues/unknown/amenity-votes"),
      venueContext("unknown"),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics).toEqual({});
  });
});

describe("GET /api/venues/[venueId]/amenity-votes/leaderboard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("orders voters by total votes and fills in names and accurate votes", async () => {
    (prisma.amenityValidation.findMany as jest.Mock).mockResolvedValue([
      {
        amenity: "wifi",
        votes: [
          { userId: "user-a", isUpvote: true },
          { userId: "user-b", isUpvote: false },
          { userId: "user-a", isUpvote: true },
        ],
      },
      {
        amenity: "outlets",
        votes: [{ userId: "user-b", isUpvote: true }],
      },
    ]);
    (prisma.user.findMany as jest.Mock)
      .mockResolvedValueOnce([
        { id: "user-a", firstName: "Ada", lastName: "Lovelace" },
        { id: "user-b", firstName: null, lastName: null },
      ])
      .mockResolvedValueOnce([
        { id: "user-a", accurateVotes: 7 },
        { id: "user-b", accurateVotes: 2 },
      ]);

    const res = await getLeaderboard(
      new NextRequest(
        "http://localhost/api/venues/venue-1/amenity-votes/leaderboard",
      ),
      venueContext(),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leaderboard.map((entry: { userId: string }) => entry.userId))
      .toEqual(["user-a", "user-b"]);
    expect(body.leaderboard[0]).toMatchObject({
      name: "Ada Lovelace",
      upvotes: 2,
      downvotes: 0,
      totalVotes: 2,
      accurateVotes: 7,
    });
    expect(body.leaderboard[1]).toMatchObject({
      name: "Anonymous",
      upvotes: 1,
      downvotes: 1,
      totalVotes: 2,
      accurateVotes: 2,
    });
  });

  it("caps the leaderboard at twenty voters", async () => {
    const votes = Array.from({ length: 25 }, (_, i) => ({
      userId: `user-${i}`,
      isUpvote: true,
    }));
    (prisma.amenityValidation.findMany as jest.Mock).mockResolvedValue([
      { amenity: "wifi", votes },
    ]);
    (prisma.user.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await getLeaderboard(
      new NextRequest(
        "http://localhost/api/venues/venue-1/amenity-votes/leaderboard",
      ),
      venueContext(),
    );

    const body = await res.json();
    expect(body.leaderboard).toHaveLength(20);
  });

  it("returns an empty leaderboard when nobody has voted", async () => {
    (prisma.amenityValidation.findMany as jest.Mock).mockResolvedValue([]);

    const res = await getLeaderboard(
      new NextRequest(
        "http://localhost/api/venues/venue-1/amenity-votes/leaderboard",
      ),
      venueContext(),
    );

    const body = await res.json();
    expect(body.leaderboard).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
