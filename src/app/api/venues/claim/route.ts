/**
 * @fileoverview Venue Ownership Claim API Route (`POST /api/venues/claim`).
 *
 * Claims a venue using an atomic conditional database update.
 *
 * Concurrency handling:
 * - Only authenticated users can claim a venue.
 * - The venue must exist and must not already have an owner.
 * - The database update requires isClaimed=false and ownerId=null.
 * - A zero-row update means another request won the claim race (409).
 * - Prisma P2034 write conflicts are also returned as 409.
 * - Unexpected database errors remain 500 responses.
 *
 * HTTP response contract:
 * - 200: Claim successful; returns { success: true, venue }.
 * - 400: Invalid JSON or missing/invalid venueId.
 * - 401: Authentication required.
 * - 404: Venue does not exist.
 * - 409: Venue already claimed or concurrent claim conflict.
 * - 500: Unexpected internal error.
 */

import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

interface ClaimVenueRequestBody {
  venueId?: unknown;
  proofReference?: unknown;
}

function isPrismaWriteConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  );
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let parsedBody: unknown;

    try {
      parsedBody = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (
      typeof parsedBody !== "object" ||
      parsedBody === null ||
      Array.isArray(parsedBody)
    ) {
      return NextResponse.json(
        { error: "Venue ID is required" },
        { status: 400 },
      );
    }

    const body = parsedBody as ClaimVenueRequestBody;
    const venueId = typeof body.venueId === "string" ? body.venueId.trim() : "";

    if (!venueId) {
      return NextResponse.json(
        { error: "Venue ID is required" },
        { status: 400 },
      );
    }

    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
      select: {
        id: true,
        isClaimed: true,
        ownerId: true,
      },
    });

    if (!venue) {
      return NextResponse.json({ error: "Venue not found" }, { status: 404 });
    }

    if (venue.isClaimed || venue.ownerId !== null) {
      return NextResponse.json(
        { error: "Venue has already been claimed" },
        { status: 409 },
      );
    }

    const claimResult = await prisma.venue.updateMany({
      where: {
        id: venueId,
        isClaimed: false,
        ownerId: null,
      },
      data: {
        isClaimed: true,
        ownerId: userId,
      },
    });

    if (claimResult.count !== 1) {
      return NextResponse.json(
        { error: "Venue has already been claimed" },
        { status: 409 },
      );
    }

    const claimedVenue = await prisma.venue.findUnique({
      where: { id: venueId },
    });

    if (!claimedVenue) {
      return NextResponse.json({ error: "Venue not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      venue: claimedVenue,
    });
  } catch (error: unknown) {
    console.error("[VENUE_CLAIM]", error);

    if (isPrismaWriteConflict(error)) {
      return NextResponse.json(
        { error: "Venue claim conflict. Please refresh and try again." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
