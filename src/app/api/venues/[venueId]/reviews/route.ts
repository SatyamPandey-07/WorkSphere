import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { rateLimit } from "@/lib/rateLimit";
import { prisma } from "@/lib/prisma";

// GET /api/venues/[venueId]/reviews - Get all reviews/ratings for a venue
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ venueId: string }> },
) {
  try {
    const { userId } = await auth();

    const forwarded = req.headers.get("x-forwarded-for") || "unknown";
    const ip = forwarded.split(",")[0].trim() || "unknown";
    const allowed = await rateLimit(`reviews:${ip}`, 60);
    if (!allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const { venueId } = await context.params;

    // Find internal venue record first
    const venue = await prisma.venue.findFirst({
      where: {
        OR: [{ id: venueId }, { placeId: venueId }],
      },
      select: { id: true },
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
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      reviews: reviews.map((r) => ({
        ...r,
        user: userId
          ? { firstName: r.user.firstName, lastName: r.user.lastName }
          : null,
      })),
    });
  } catch (error) {
    console.error("GET /api/venues/[venueId]/reviews error:", error);
    return NextResponse.json(
      { error: "Failed to fetch reviews" },
      { status: 500 },
    );
  }
}
