import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";
import { normalizeRequiredText } from "@/lib/amenityVoteInput";

const MIN_VOTES_TO_HIDE = 5;
const HIDE_THRESHOLD = 60;

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

// GET /api/venues/[venueId]/amenity-votes
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await context.params;
    const { userId } = await auth();

    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
    });
    if (!venue) {
      return apiError("Venue not found", 404, "VENUE_NOT_FOUND");
    }

    const validations = await prisma.amenityValidation.findMany({
      where: { venueId },
      include: {
        votes: true,
      },
    });

    const metrics: Record<
      string,
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
      const confidenceScore =
        total > 0 ? Math.round((v.upvotes / total) * 100) : 100;
      const hidden =
        total >= MIN_VOTES_TO_HIDE && confidenceScore < HIDE_THRESHOLD;

      const myVote = userId
        ? v.votes.find(
            (vote: { userId: string; isUpvote: boolean }) =>
              vote.userId === userId,
          )
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
    return apiError(
      error instanceof Error ? error.message : "Internal server error",
      500,
      "INTERNAL_ERROR",
    );
  }
}

// POST /api/venues/[venueId]/amenity-votes
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await context.params;
    const { userId } = await auth();
    if (!userId) {
      return apiError("Unauthorized", 401, "UNAUTHORIZED");
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return apiError("Invalid JSON body", 400, "VALIDATION_FAILED");
    }

    const amenity = normalizeRequiredText(body?.amenity);
    const isUpvote = body?.isUpvote;
    if (!amenity || typeof isUpvote !== "boolean") {
      return apiError("Missing required parameters", 400, "VALIDATION_FAILED");
    }

    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
    });
    if (!venue) {
      return apiError("Venue not found", 404, "VENUE_NOT_FOUND");
    }

    const updatedValidation = await prisma.$transaction(async (tx) => {
      const validation = await tx.amenityValidation.upsert({
        where: { venueId_amenity: { venueId, amenity } },
        update: {},
        create: { venueId, amenity, upvotes: 0, downvotes: 0 },
      });

      const existingVote = await tx.amenityVote.findUnique({
        where: { userId_validationId: { userId, validationId: validation.id } },
      });

      if (existingVote) {
        if (existingVote.isUpvote === isUpvote) {
          return validation;
        }

        await tx.amenityVote.update({
          where: { id: existingVote.id },
          data: { isUpvote },
        });

        return await tx.amenityValidation.update({
          where: { id: validation.id },
          data: isUpvote
            ? { upvotes: { increment: 1 }, downvotes: { decrement: 1 } }
            : { upvotes: { decrement: 1 }, downvotes: { increment: 1 } },
        });
      }

      try {
        await tx.amenityVote.create({
          data: { validationId: validation.id, userId, isUpvote },
        });

        return await tx.amenityValidation.update({
          where: { id: validation.id },
          data: isUpvote
            ? { upvotes: { increment: 1 } }
            : { downvotes: { increment: 1 } },
        });
      } catch (err: any) {
        // Handle concurrent insert unique constraint gracefully
        if (err?.code === "P2002") {
          const concurrentVote = await tx.amenityVote.findUnique({
            where: {
              userId_validationId: { userId, validationId: validation.id },
            },
          });
          if (concurrentVote && concurrentVote.isUpvote !== isUpvote) {
            await tx.amenityVote.update({
              where: { id: concurrentVote.id },
              data: { isUpvote },
            });
            return await tx.amenityValidation.update({
              where: { id: validation.id },
              data: isUpvote
                ? { upvotes: { increment: 1 }, downvotes: { decrement: 1 } }
                : { upvotes: { decrement: 1 }, downvotes: { increment: 1 } },
            });
          }
          return await tx.amenityValidation.findUniqueOrThrow({
            where: { id: validation.id },
          });
        }
        throw err;
      }
    });

    return NextResponse.json(
      buildResponse(
        amenity,
        updatedValidation.upvotes,
        updatedValidation.downvotes,
      ),
    );
  } catch (error: any) {
    console.error("POST /api/venues/[venueId]/amenity-votes error:", error);
    return apiError(
      error instanceof Error ? error.message : "Internal server error",
      500,
      "INTERNAL_ERROR",
    );
  }
}
