import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";

// GET /api/favorites - Get user's favorites
export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Ensure Identity 💎
    await ensureUserExists(userId);

    const favorites = await prisma.favorite.findMany({
      where: { userId },
      include: {
        venue: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json({ favorites });
  } catch (error) {
    console.error("GET /api/favorites error:", error);
    return NextResponse.json(
      { error: "Failed to fetch favorites" },
      { status: 500 }
    );
  }
}

// POST /api/favorites - Add favorite
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Ensure Identity 💎
    await ensureUserExists(userId);

    const { venueId, placeId, name, latitude, longitude, category, address } = await req.json();

    if (!venueId) {
      return NextResponse.json(
        { error: "venueId is required" },
        { status: 400 }
      );
    }

    const targetPlaceId = placeId || venueId;

    // Upsert venue first (identify by placeId)
    const dbVenue = await prisma.venue.upsert({
      where: { placeId: targetPlaceId },
      update: {
        name: name || "Unknown Venue",
        address: address || null,
        category: category || "other",
      },
      create: {
        placeId: targetPlaceId,
        name: name || "Unknown Venue",
        latitude: latitude || 0,
        longitude: longitude || 0,
        category: category || "other",
        address: address || null,
      },
    });

    const favorite = await prisma.favorite.create({
      data: {
        userId,
        venueId: dbVenue.id,
      },
      include: {
        venue: true,
      },
    });

    return NextResponse.json({ favorite }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/favorites error:", error);

    // Handle unique constraint violation (already favorited)
    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "Already in favorites" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Failed to add favorite" },
      { status: 500 }
    );
  }
}

// DELETE /api/favorites - Remove favorite
export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Ensure Identity 💎
    await ensureUserExists(userId);

    // Get venueId from query params
    const { searchParams } = new URL(req.url);
    const rawVenueId = searchParams.get("venueId");

    if (!rawVenueId) {
      return NextResponse.json(
        { error: "venueId is required" },
        { status: 400 }
      );
    }

    // Identify the venue in our DB (it might be passed as a placeId)
    const venue = await prisma.venue.findFirst({
      where: {
        OR: [
          { id: rawVenueId },
          { placeId: rawVenueId }
        ]
      },
      select: { id: true }
    });

    if (!venue) {
      return NextResponse.json({ success: true }); // Already gone or never existed
    }

    await prisma.favorite.delete({
      where: {
        userId_venueId: {
          userId,
          venueId: venue.id,
        },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/favorites error:", error);
    return NextResponse.json(
      { error: "Failed to remove favorite" },
      { status: 500 }
    );
  }
}
