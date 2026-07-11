import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/venues/[venueId]/reviews - Get all reviews/ratings for a venue
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ venueId: string }> }
) {
  try {
    const { venueId } = await context.params;

    // Find internal venue record first
    const venue = await prisma.venue.findFirst({
      where: {
        OR: [
          { id: venueId },
          { placeId: venueId }
        ]
      },
      select: { id: true }
    });

    if (!venue) {
      return NextResponse.json({ reviews: [] });
    }

    const reviews = await prisma.venueRating.findMany({
      where: { venueId: venue.id },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    return NextResponse.json({ reviews });
  } catch (error) {
    console.error("GET /api/venues/[venueId]/reviews error:", error);
    return NextResponse.json(
      { error: "Failed to fetch reviews" },
      { status: 500 }
    );
  }
}
