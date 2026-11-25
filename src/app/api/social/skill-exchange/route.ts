/**
 * route.ts
 * /api/social/skill-exchange
 * Retrieves and posts persistent on-site nomad skill barter listings.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import {
  findComplementaryBarters,
  type SkillListing,
  type SkillCategory,
} from "@/lib/social/skillBarterEngine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const venueId = searchParams.get("venueId") || "venue-sf-01";
    const category = searchParams.get("category");

    const dbListings = await prisma.skillListing.findMany({
      where: {
        venueId,
        status: "OPEN",
        ...(category && category !== "ALL"
          ? {
              OR: [
                { offeringCategory: category },
                { seekingCategory: category },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    const listings: SkillListing[] = dbListings.map((l) => ({
      id: l.id,
      venueId: l.venueId,
      venueName: l.venueName,
      userId: l.userId,
      userName: l.userName,
      userTitle: l.userTitle,
      offeringSkill: l.offeringSkill,
      offeringCategory: l.offeringCategory as SkillCategory,
      seekingSkill: l.seekingSkill,
      seekingCategory: l.seekingCategory as SkillCategory,
      durationMinutes: l.durationMinutes as 15 | 30 | 45,
      meetupSpot: l.meetupSpot,
      status: l.status as "OPEN" | "MATCHED" | "COMPLETED",
      reputationScore: l.reputationScore,
      createdAt: l.createdAt.toISOString(),
    }));

    const matches = findComplementaryBarters(listings);

    return NextResponse.json({
      success: true,
      venueId,
      totalListings: listings.length,
      matches,
      listings,
    });
  } catch (error: any) {
    console.error("[GET /api/social/skill-exchange] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch skill barter listings",
        details: error.message,
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      venueId = "venue-sf-01",
      venueName = "Mission Focus Coworking & Cafe",
      userName = "You",
      userTitle = "Digital Nomad Specialist",
      offeringSkill,
      offeringCategory = "CODE_DEV",
      seekingSkill,
      seekingCategory = "DESIGN_UI",
      durationMinutes = 30,
      meetupSpot = "Lounge Coffee Table",
    } = body;

    if (!offeringSkill || !seekingSkill) {
      return NextResponse.json(
        { error: "Both offeringSkill and seekingSkill are required" },
        { status: 400 },
      );
    }

    const created = await prisma.skillListing.create({
      data: {
        venueId,
        venueName,
        userId,
        userName,
        userTitle,
        offeringSkill,
        offeringCategory,
        seekingSkill,
        seekingCategory,
        durationMinutes: Number(durationMinutes),
        meetupSpot,
        status: "OPEN",
        reputationScore: 100,
      },
    });

    const newListing: SkillListing = {
      id: created.id,
      venueId: created.venueId,
      venueName: created.venueName,
      userId: created.userId,
      userName: created.userName,
      userTitle: created.userTitle,
      offeringSkill: created.offeringSkill,
      offeringCategory: created.offeringCategory as SkillCategory,
      seekingSkill: created.seekingSkill,
      seekingCategory: created.seekingCategory as SkillCategory,
      durationMinutes: created.durationMinutes as 15 | 30 | 45,
      meetupSpot: created.meetupSpot,
      status: "OPEN",
      reputationScore: created.reputationScore,
      createdAt: created.createdAt.toISOString(),
    };

    return NextResponse.json({
      success: true,
      message: "Skill Barter listing posted to venue notice board!",
      listing: newListing,
    });
  } catch (error: any) {
    console.error("[POST /api/social/skill-exchange] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to create skill barter listing",
        details: error.message,
      },
      { status: 500 },
    );
  }
}
