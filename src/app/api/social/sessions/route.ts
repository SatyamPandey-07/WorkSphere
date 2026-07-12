import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { ensureUserExists } from "@/lib/auth";

// GET /api/social/sessions - Get all coworking sessions
export async function GET() {
  try {
    const sessions = await prisma.coworkingSession.findMany({
      include: {
        venue: true,
        host: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            imageUrl: true,
          },
        },
        rsvps: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                imageUrl: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        _count: {
          select: { rsvps: true },
        },
      },
      orderBy: { startsAt: "asc" },
    });
    return NextResponse.json(sessions);
  } catch (error) {
    console.error("GET /api/social/sessions error:", error);
    return NextResponse.json({ error: "Failed to fetch sessions" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // Ensure user is synced in DB
    await ensureUserExists(userId);

    const body = await req.json();
    const { title, description, venueId, startsAt, endsAt, maxGuests } = body;

    if (!title || !venueId || !startsAt || !endsAt) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Verify venue exists
    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
    });
    if (!venue) {
      return NextResponse.json({ error: "Venue not found" }, { status: 404 });
    }

    // Create unique slug
    const baseSlug = title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const slug = `${baseSlug}-${randomSuffix}`;

    // Create session and automatically RSVP the host
    const session = await prisma.coworkingSession.create({
      data: {
        title,
        description,
        slug,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        maxGuests: maxGuests ? Number(maxGuests) : null,
        hostId: userId,
        venueId,
        rsvps: {
          create: {
            userId,
            status: "GOING",
          },
        },
      },
      include: {
        venue: true,
        host: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            imageUrl: true,
          },
        },
        rsvps: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                imageUrl: true,
              },
            },
          },
        },
        _count: {
          select: { rsvps: true },
        },
      },
    });

    return NextResponse.json(session);
  } catch (error) {
    console.error("Failed to create session:", error);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
