import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

const MIN_VOTES_TO_HIDE = 5;
const HIDE_THRESHOLD = 60;
const CONSENSUS_MIN_VOTES = 5;
const CONSENSUS_THRESHOLD = 80;
const VERIFIED_EXPLORER_THRESHOLD = 10;

function buildResponse(amenity: string, upvotes: number, downvotes: number) {
  const totalVotes = upvotes + downvotes;
  const confidenceScore =
    totalVotes > 0 ? Math.round((upvotes / totalVotes) * 100) : 100;
  const hidden =
    totalVotes >= MIN_VOTES_TO_HIDE && confidenceScore < HIDE_THRESHOLD;

  return {
    success: true,
    amenity,
    upvotes,
    downvotes,
    confidenceScore,
    hidden,
  };
}

async function trackAccurateContributions(
  validationId: string,
  upvotes: number,
  downvotes: number,
) {
  const total = upvotes + downvotes;
  if (total < CONSENSUS_MIN_VOTES) return;

  const confidence = Math.round((upvotes / total) * 100);
  if (confidence < CONSENSUS_THRESHOLD) return;

  const consensusIsUpvote = confidence >= CONSENSUS_THRESHOLD;

  const allVotes = await prisma.amenityVote.findMany({
    where: { validationId },
  });

  const alreadyCredited = await prisma.userBadge.findMany({
    where: { badgeType: `accurate_${validationId}` },
    select: { userId: true },
  });
  const creditedUserIds = new Set(alreadyCredited.map((b) => b.userId));

  for (const vote of allVotes) {
    if (vote.isUpvote !== consensusIsUpvote) continue;
    if (creditedUserIds.has(vote.userId)) continue;

    await prisma.userBadge.create({
      data: {
        userId: vote.userId,
        badgeType: `accurate_${validationId}`,
      },
    });

    const user = await prisma.user.update({
      where: { id: vote.userId },
      data: { accurateVotes: { increment: 1 } },
    });

    if (user.accurateVotes >= VERIFIED_EXPLORER_THRESHOLD) {
      await prisma.userBadge.upsert({
        where: {
          userId_badgeType: { userId: vote.userId, badgeType: "verified_explorer" },
        },
        update: {},
        create: { userId: vote.userId, badgeType: "verified_explorer" },
      });
    }
  }
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { venueId, amenity, isUpvote } = await request.json();

    if (!venueId || !amenity || typeof isUpvote !== "boolean") {
      return NextResponse.json(
        { success: false, error: "Missing required parameters" },
        { status: 400 },
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
          buildResponse(amenity, validation.upvotes, validation.downvotes),
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

      const venueFields = ["dogFriendly", "catsAllowed", "petsAllowedIndoors"];
      if (venueFields.includes(amenity)) {
        await prisma.venue.update({
          where: { id: venueId },
          data: { [amenity]: updated.upvotes >= 5 },
        });
      }

      await trackAccurateContributions(
        validation.id,
        updated.upvotes,
        updated.downvotes,
      );

      return NextResponse.json(
        buildResponse(amenity, updated.upvotes, updated.downvotes),
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

    const venueFields = ["dogFriendly", "catsAllowed", "petsAllowedIndoors"];
    if (venueFields.includes(amenity)) {
      await prisma.venue.update({
        where: { id: venueId },
        data: { [amenity]: updated.upvotes >= 5 },
      });
    }

    await trackAccurateContributions(
      validation.id,
      updated.upvotes,
      updated.downvotes,
    );

    return NextResponse.json(
      buildResponse(amenity, updated.upvotes, updated.downvotes),
    );
  } catch (error: any) {
    console.error("POST /api/venues/amenity-vote error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}
