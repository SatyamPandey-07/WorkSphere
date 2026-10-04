import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { apiError } from "@/lib/apiResponse";

// GET /api/venues/[venueId]/menu - Get all crowdsourced menu photos for a venue
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ venueId: string }> }
) {
  try {
    const { venueId } = await context.params;

    const venue = await prisma.venue.findFirst({
      where: {
        OR: [
          { id: venueId },
          { placeId: venueId }
        ]
      },
      select: { menuPhotos: true }
    });

    return NextResponse.json({ menuPhotos: venue?.menuPhotos || [] });
  } catch (error) {
    console.error("GET /api/venues/[venueId]/menu error:", error);
    return apiError("Failed to fetch menu photos", 500, "INTERNAL_ERROR");
  }
}

// POST /api/venues/[venueId]/menu - Add a menu photo to a venue
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ venueId: string }> }
) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return apiError("Unauthorized", 401, "UNAUTHORIZED");
    }

    // Ensure Identity exists in DB
    await ensureUserExists(userId);

    const { venueId } = await context.params;
    const { photoUrl, venue: venueData } = await req.json();

    if (!photoUrl) {
      return apiError("photoUrl is required", 400, "VALIDATION_FAILED");
    }

    const targetPlaceId = venueData?.placeId || venueId;

    // Check if venue exists, create/update if not
    const dbVenue = await prisma.venue.upsert({
      where: { placeId: targetPlaceId },
      update: {},
      create: {
        placeId: targetPlaceId,
        name: venueData?.name || "Unknown Venue",
        latitude: venueData?.lat || venueData?.latitude || 0,
        longitude: venueData?.lng || venueData?.longitude || 0,
        category: venueData?.category || "other",
        address: venueData?.address || null,
      },
    });

    // Add photoUrl to the menuPhotos array
    const updatedVenue = await prisma.venue.update({
      where: { id: dbVenue.id },
      data: {
        menuPhotos: {
          push: photoUrl
        }
      },
      select: { menuPhotos: true }
    });

    return NextResponse.json({ menuPhotos: updatedVenue.menuPhotos }, { status: 201 });
  } catch (error) {
    console.error("POST /api/venues/[venueId]/menu error:", error);
    return apiError("Failed to add menu photo", 500, "INTERNAL_ERROR");
  }
}
