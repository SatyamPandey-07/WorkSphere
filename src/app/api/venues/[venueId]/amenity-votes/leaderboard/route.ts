import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await context.params;

    const validations = await prisma.amenityValidation.findMany({
      where: { venueId },
      include: { votes: true },
    });

    const voterStats: Record<
      string,
      { upvotes: number; downvotes: number; total: number; name: string }
    > = {};

    for (const v of validations) {
      for (const vote of v.votes) {
        if (!voterStats[vote.userId]) {
          voterStats[vote.userId] = {
            upvotes: 0,
            downvotes: 0,
            total: 0,
            name: "Unknown",
          };
        }
        if (vote.isUpvote) voterStats[vote.userId].upvotes++;
        else voterStats[vote.userId].downvotes++;
        voterStats[vote.userId].total++;
      }
    }

    const userIds = Object.keys(voterStats);
    if (userIds.length > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          accurateVotes: true,
        },
      });
      const userMap = new Map(users.map((u) => [u.id, u]));
      for (const uid of userIds) {
        const u = userMap.get(uid);
        voterStats[uid].name = u
          ? `${u.firstName || "Anonymous"} ${u.lastName || ""}`.trim() ||
            "Anonymous"
          : "Unknown";
      }
    }

    const accurateMap = new Map<string, number>();
    if (userIds.length > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, accurateVotes: true },
      });
      for (const u of users) accurateMap.set(u.id, u.accurateVotes);
    }

    const leaderboard = Object.entries(voterStats)
      .map(([userId, stats]) => ({
        userId,
        name: stats.name,
        upvotes: stats.upvotes,
        downvotes: stats.downvotes,
        totalVotes: stats.total,
        accurateVotes: accurateMap.get(userId) ?? 0,
      }))
      .sort((a, b) => b.totalVotes - a.totalVotes)
      .slice(0, 20);

    return NextResponse.json({ success: true, leaderboard });
  } catch (error: any) {
    console.error(
      "GET /api/venues/[venueId]/amenity-votes/leaderboard error:",
      error,
    );
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}
