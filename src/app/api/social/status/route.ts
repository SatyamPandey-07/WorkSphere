import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const statuses = await prisma.workBuddyStatus.findMany({
    where: {
      isPublic: true,
      until: { gt: new Date() },
    },
    orderBy: { updatedAt: "desc" },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      venue: {
        select: {
          id: true,
          name: true,
          address: true,
          latitude: true,
          longitude: true,
          category: true,
        },
      },
    },
    take: 50,
  });

  return NextResponse.json(statuses);
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json();
  const venueId = typeof body.venueId === "string" ? body.venueId : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 160) : null;
  const until = new Date(body.until);

  if (!venueId || Number.isNaN(until.getTime()) || until <= new Date()) {
    return NextResponse.json(
      { error: "A valid venue and future end time are required" },
      { status: 400 },
    );
  }

  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
    select: { id: true },
  });

  if (!venue) {
    return NextResponse.json({ error: "Venue not found" }, { status: 404 });
  }

  const status = await prisma.workBuddyStatus.upsert({
    where: { userId },
    update: {
      venueId,
      note,
      until,
      isPublic: body.isPublic !== false,
    },
    create: {
      userId,
      venueId,
      note,
      until,
      isPublic: body.isPublic !== false,
    },
    include: {
      venue: true,
      user: {
        select: { firstName: true, lastName: true },
      },
    },
  });

  return NextResponse.json(status);
}

export async function DELETE() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  await prisma.workBuddyStatus.deleteMany({ where: { userId } });

  return NextResponse.json({ ok: true });
}
