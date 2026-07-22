import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateRequest, xrAnchorUpdateSchema } from "@/lib/validations";
import { rateLimit } from "@/lib/rateLimit";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allowed = await rateLimit(`ar-anchor:${userId}`, 60);
  if (!allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const { id } = await params;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Invalid anchor ID" }, { status: 400 });
  }

  const body = await request.json();
  const parsed = validateRequest(xrAnchorUpdateSchema, body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const existing = await prisma.xRAnchor.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Anchor not found" }, { status: 404 });
  }
  if (existing.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const anchor = await prisma.xRAnchor.update({
    where: { id },
    data: {
      ...(parsed.data.matrix && { matrix: parsed.data.matrix }),
      ...(parsed.data.label !== undefined && { label: parsed.data.label }),
      lastTrackedAt: new Date(),
    },
    include: {
      seat: { select: { id: true, seatNumber: true, type: true } },
    },
  });

  return NextResponse.json({ data: anchor });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Invalid anchor ID" }, { status: 400 });
  }

  const existing = await prisma.xRAnchor.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Anchor not found" }, { status: 404 });
  }
  if (existing.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.xRAnchor.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
