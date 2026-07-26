import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { venueId } = body;

    if (!venueId) {
      return NextResponse.json({ error: "Venue ID is required" }, { status: 400 });
    }

    // Check if venue is already claimed
    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
    });

    if (!venue) {
      return NextResponse.json({ error: "Venue not found" }, { status: 404 });
    }

    if (venue.isClaimed) {
      return NextResponse.json({ error: "Venue is already claimed" }, { status: 400 });
    }

    // Claim the venue
    const updatedVenue = await prisma.venue.update({
      where: { id: venueId },
      data: {
        isClaimed: true,
        ownerId: userId,
      },
    });

    return NextResponse.json({ success: true, venue: updatedVenue });
  } catch (error: any) {
    console.error("[CLAIM_POST]", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
