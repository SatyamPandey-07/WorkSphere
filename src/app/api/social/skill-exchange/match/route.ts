/**
 * route.ts
 * POST /api/social/skill-exchange/match
 * Accepts a skill barter match, enforces authentication and self-match prevention,
 * and transactionally confirms an on-site meetup slot.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      listingId,
      proposerName = "Visiting Nomad",
      meetupTime = "In 15 Minutes",
      meetupSpot,
    } = body;

    if (!listingId || typeof listingId !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid listingId in request payload" },
        { status: 400 },
      );
    }

    // Look up persistent listing from database
    const listing = await prisma.skillListing.findUnique({
      where: { id: listingId },
    });

    if (!listing) {
      return NextResponse.json(
        { error: "Skill barter listing not found", code: "LISTING_NOT_FOUND" },
        { status: 404 },
      );
    }

    // Disallow self-matching: user cannot match their own barter listing
    if (listing.userId === userId) {
      return NextResponse.json(
        {
          error: "You cannot accept or match your own skill barter listing.",
          code: "SELF_MATCH_DISALLOWED",
        },
        { status: 400 },
      );
    }

    // Verify listing is still OPEN for matching
    if (listing.status !== "OPEN") {
      return NextResponse.json(
        {
          error:
            "This skill barter listing is already matched or no longer available.",
          code: "LISTING_ALREADY_MATCHED",
        },
        { status: 409 },
      );
    }

    const resolvedMeetupSpot = meetupSpot || listing.meetupSpot;

    // Transactionally update listing status to MATCHED and record match
    const [_updatedListing, match] = await prisma.$transaction([
      prisma.skillListing.update({
        where: { id: listingId },
        data: { status: "MATCHED" },
      }),
      prisma.skillMatch.create({
        data: {
          listingId,
          proposerId: userId,
          proposerName,
          meetupSpot: resolvedMeetupSpot,
          meetupTime,
          status: "CONFIRMED",
        },
      }),
    ]);

    const matchConfirmation = {
      matchId: match.id,
      listingId,
      proposerName: match.proposerName,
      meetupSpot: match.meetupSpot,
      meetupTime: match.meetupTime,
      status: "CONFIRMED",
      calendarPassUrl: `/social/skill-exchange?match=confirmed`,
    };

    return NextResponse.json({
      success: true,
      message: `Skill Barter confirmed with ${match.proposerName}! Meet at ${match.meetupSpot}.`,
      match: matchConfirmation,
    });
  } catch (error: any) {
    console.error("[POST /api/social/skill-exchange/match] Error:", error);
    return NextResponse.json(
      { error: "Failed to confirm barter match", details: error.message },
      { status: 500 },
    );
  }
}
