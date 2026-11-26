import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { normalizeRequiredText } from "@/lib/amenityVoteInput";
import { AmenityConsensusEvaluation } from "@/lib/amenityVotes/consensusEngine";
import { trackAccurateContributions } from "@/lib/amenityVotes/settlementService";

const MIN_VOTES_TO_HIDE = 5;
const HIDE_THRESHOLD = 60;

function buildResponse(
  amenity: string,
  upvotes: number,
  downvotes: number,
  consensus?: AmenityConsensusEvaluation,
) {
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
    ...(consensus
      ? {
          consensusState: consensus.state,
          statisticalConfidence: consensus.statisticalConfidence,
          effectiveSampleSize: consensus.effectiveSampleSize,
          settlementEligible: consensus.settlementEligible,
          disputeEscalated: consensus.disputeEscalated ?? false,
          settlementDeadline: consensus.settlementDeadline ?? null,
        }
      : {}),
  };
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

    const body = await request.json();
    const venueId = normalizeRequiredText(body?.venueId);
    const amenity = normalizeRequiredText(body?.amenity);
    const isUpvote = body?.isUpvote;

    if (!venueId || !amenity || typeof isUpvote !== "boolean") {
      return NextResponse.json(
        { success: false, error: "Missing required parameters" },
        { status: 400 },
      );
    }

    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
    });
    if (!venue) {
      return NextResponse.json(
        { success: false, error: "Venue not found" },
        { status: 404 },
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
        const consensus = await trackAccurateContributions(validation.id);
        return NextResponse.json(
          buildResponse(
            amenity,
            validation.upvotes,
            validation.downvotes,
            consensus,
          ),
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

      const consensus = await trackAccurateContributions(validation.id);

      return NextResponse.json(
        buildResponse(amenity, updated.upvotes, updated.downvotes, consensus),
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

    const consensus = await trackAccurateContributions(validation.id);

    return NextResponse.json(
      buildResponse(amenity, updated.upvotes, updated.downvotes, consensus),
    );
  } catch (error: any) {
    console.error("POST /api/venues/amenity-vote error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}
