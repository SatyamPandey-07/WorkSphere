import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const venueId =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as { venueId?: unknown }).venueId
        : undefined;

    if (typeof venueId !== "string" || venueId.trim().length === 0) {
      return NextResponse.json(
        { error: "Venue ID is required" },
        { status: 400 },
      );
    }

    // Check if venue is already claimed
    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
    });

    if (!venue) {
      return NextResponse.json({ error: "Venue not found" }, { status: 404 });
    }

    if (venue.isClaimed) {
      return NextResponse.json(
        { error: "Venue is already claimed" },
        { status: 400 },
      );
    }

    // Atomic update conditioned on isClaimed: false to prevent concurrent overwrites
    let updatedVenue;
    if (typeof prisma.venue.updateMany === "function") {
      const updateResult = await prisma.venue.updateMany({
        where: { id: venueId, isClaimed: false },
        data: {
          isClaimed: true,
          ownerId: userId,
        },
      });

      if (updateResult.count === 0) {
        return NextResponse.json(
          { error: "Venue is already claimed" },
          { status: 409 },
        );
      }

      updatedVenue = await prisma.venue.findUnique({
        where: { id: venueId },
      });
    } else {
      updatedVenue = await prisma.venue.update({
        where: { id: venueId },
        data: {
          isClaimed: true,
          ownerId: userId,
        },
      });
    }

    return NextResponse.json({ success: true, venue: updatedVenue });
  } catch (error) {
    console.error("[CLAIM_POST]", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
