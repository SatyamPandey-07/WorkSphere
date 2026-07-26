import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const venues = await prisma.venue.findMany({
      where: { ownerId: userId },
    });

    return NextResponse.json(venues);
  } catch (error: any) {
    console.error("[MANAGED_GET]", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { venueId, hostMessage, name, address, openingHours } = body;

    if (!venueId) {
      return NextResponse.json({ error: "Venue ID is required" }, { status: 400 });
    }

    // Verify ownership
    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
    });

    if (!venue) {
      return NextResponse.json({ error: "Venue not found" }, { status: 404 });
    }

    if (venue.ownerId !== userId) {
      return NextResponse.json({ error: "Forbidden: You do not own this venue" }, { status: 403 });
    }

    const updatedVenue = await prisma.venue.update({
      where: { id: venueId },
      data: {
        hostMessage,
        name: name || venue.name,
        address: address !== undefined ? address : venue.address,
        openingHours: openingHours !== undefined ? openingHours : venue.openingHours,
      },
    });

    return NextResponse.json({ success: true, venue: updatedVenue });
  } catch (error: any) {
    console.error("[MANAGED_PUT]", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
