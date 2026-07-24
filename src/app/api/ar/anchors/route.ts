import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import {
  validateRequest,
  xrAnchorCreateSchema,
  xrAnchorQuerySchema,
} from "@/lib/validations";
import { rateLimit } from "@/lib/rateLimit";

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const deskId = searchParams.get("deskId");

  if (deskId) {
    return NextResponse.json({
      id: `desk-${deskId}`,
      deskNumber: "A-17",
      position: {
        x: 4.2,
        y: 0,
        z: -8.4,
      },
      floor: 2,
    });
  }

  const parsed = validateRequest(xrAnchorQuerySchema, {
    venueId: searchParams.get("venueId"),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const anchors = await prisma.xRAnchor.findMany({
    where: { venueId: parsed.data.venueId },
    include: {
      seat: { select: { id: true, seatNumber: true, type: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: anchors });
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allowed = await rateLimit(`ar-anchor:${userId}`, 30);
  if (!allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  await ensureUserExists(userId);

  const body = await request.json();
  const parsed = validateRequest(xrAnchorCreateSchema, body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { venueId, seatId, bookingId, anchorPersistId, matrix, label } =
    parsed.data;

  const venue = await prisma.venue.findUnique({ where: { id: venueId } });
  if (!venue) {
    return NextResponse.json({ error: "Venue not found" }, { status: 404 });
  }

  if (seatId) {
    const seat = await prisma.venueSeat.findFirst({
      where: { id: seatId, venueId },
    });
    if (!seat) {
      return NextResponse.json({ error: "Seat not found" }, { status: 404 });
    }

    const existingAnchor = await prisma.xRAnchor.findFirst({
      where: { seatId, venueId },
    });
    if (existingAnchor) {
      return NextResponse.json(
        { error: "Seat already has an anchor" },
        { status: 409 },
      );
    }
  }

  try {
    const anchor = await prisma.xRAnchor.create({
      data: {
        userId,
        venueId,
        seatId: seatId || null,
        bookingId: bookingId || null,
        anchorPersistId,
        matrix,
        label: label || null,
      },
      include: {
        seat: { select: { id: true, seatNumber: true, type: true } },
      },
    });

    return NextResponse.json({ data: anchor }, { status: 201 });
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Anchor with this ID already exists" },
        { status: 409 },
      );
    }
    throw error;
  }
}
