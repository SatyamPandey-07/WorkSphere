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
          },
        },
        rsvps: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
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

// POST /api/social/sessions - Create a new coworking session
export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureUserExists(userId);

    const body = await request.json();
    const { title, description, venueId, startsAt, endsAt, maxGuests } = body;

    if (!title || !venueId || !startsAt || !endsAt) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Generate unique slug
    const baseSlug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const slug = `${baseSlug}-${Date.now().toString().slice(-6)}`;

    const session = await prisma.coworkingSession.create({
      data: {
        title,
        description,
        venueId,
        slug,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        maxGuests: maxGuests ? parseInt(maxGuests, 10) : null,
        hostId: userId,
      },
    });

    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    console.error("POST /api/social/sessions error:", error);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
