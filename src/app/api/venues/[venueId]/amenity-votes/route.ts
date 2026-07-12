import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

const MIN_VOTES_TO_HIDE = 5;
const HIDE_THRESHOLD = 60;

// GET /api/venues/[venueId]/amenity-votes
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ venueId: string }> }
) {
  try {
    const { venueId } = await context.params;
    const { userId } = await auth();

    const validations = await prisma.amenityValidation.findMany({
      where: { venueId },
      include: {
        votes: true,
      },
    });

    const metrics: Record<string,
      {
        confidenceScore: number;
        upvotes: number;
        downvotes: number;
        hidden: boolean;
        userVote: boolean | null;
      }
    > = {};

    for (const v of validations) {
      const total = v.upvotes + v.downvotes;
      const confidenceScore = total > 0 ? Math.round((v.upvotes / total) * 100) : 100;
      const hidden = total >= MIN_VOTES_TO_HIDE && confidenceScore < HIDE_THRESHOLD;

      const myVote = userId
  ? v.votes.find((vote: { userId: string; isUpvote: boolean }) => vote.userId === userId)
  : undefined;

      metrics[v.amenity] = {
        confidenceScore,
        upvotes: v.upvotes,
        downvotes: v.downvotes,
        hidden,
        userVote: myVote ? myVote.isUpvote : null,
      };
    }

    return NextResponse.json({ success: true, metrics });
  } catch (error: any) {
    console.error("GET /api/venues/[venueId]/amenity-votes error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}