import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

const MIN_VOTES_TO_HIDE = 5;
const HIDE_THRESHOLD = 60;

function buildResponse(amenity: string, upvotes: number, downvotes: number) {
  const totalVotes = upvotes + downvotes;
  const confidenceScore =
    totalVotes > 0 ? Math.round((upvotes / totalVotes) * 100) : 100;
  const hidden = totalVotes >= MIN_VOTES_TO_HIDE && confidenceScore < HIDE_THRESHOLD;

  return { success: true, amenity, upvotes, downvotes, confidenceScore, hidden };
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { venueId, amenity, isUpvote } = await request.json();

    if (!venueId || !amenity || typeof isUpvote !== "boolean") {
      return NextResponse.json(
        { success: false, error: "Missing required parameters" },
        { status: 400 }
      );
    }

    const validation = await prisma.amenityValidation.upsert({
      where: { venueId_amenity: { venueId, amenity } },
      update: {},
      create: { venueId, amenity, upvotes: 0, downvotes: 0 },
    });

    const existingVote = await prisma.amenityVote.findUnique({
      where: { userId_validationId: { userId, validationId: validation.id } },
    });

    if (existingVote) {
      if (existingVote.isUpvote === isUpvote) {
        return NextResponse.json(
          buildResponse(amenity, validation.upvotes, validation.downvotes)
        );
      }

      await prisma.amenityVote.update({
        where: { id: existingVote.id },
        data: { isUpvote },
      });

      const updated = await prisma.amenityValidation.update({
        where: { id: validation.id },
        data: isUpvote
          ? { upvotes: { increment: 1 }, downvotes: { decrement: 1 } }
          : { upvotes: { decrement: 1 }, downvotes: { increment: 1 } },
      });

      return NextResponse.json(
        buildResponse(amenity, updated.upvotes, updated.downvotes)
      );
    }

    await prisma.amenityVote.create({
      data: { validationId: validation.id, userId, isUpvote },
    });

    const updated = await prisma.amenityValidation.update({
      where: { id: validation.id },
      data: isUpvote
        ? { upvotes: { increment: 1 } }
        : { downvotes: { increment: 1 } },
    });

    return NextResponse.json(
      buildResponse(amenity, updated.upvotes, updated.downvotes)
    );
  } catch (error: any) {
    console.error("POST /api/venues/amenity-vote error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}