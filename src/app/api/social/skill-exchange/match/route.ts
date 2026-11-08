/**
 * route.ts
 * POST /api/social/skill-exchange/match
 * Accepts a skill barter match and confirms an on-site 15-to-30 minute meetup slot.
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { listingId, proposerId, proposerName, meetupTime = "In 15 Minutes" } = body;

    if (!listingId) {
      return NextResponse.json({ error: "Missing listingId" }, { status: 400 });
    }

    const matchConfirmation = {
      matchId: `MATCH-${Date.now().toString().slice(-6)}`,
      listingId,
      proposerName: proposerName || "Visiting Nomad",
      meetupSpot: "Lounge Table #4 (Near Pour-Over Bar)",
      meetupTime,
      status: "CONFIRMED",
      calendarPassUrl: `/social/skill-exchange?match=confirmed`,
    };

    return NextResponse.json({
      success: true,
      message: `Skill Barter confirmed with ${proposerName}! Meet at Lounge Table #4.`,
      match: matchConfirmation,
    });
  } catch (error: any) {
    console.error("[POST /api/social/skill-exchange/match] Error:", error);
    return NextResponse.json(
      { error: "Failed to confirm barter match", details: error.message },
      { status: 500 }
    );
  }
}
