import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const allowed = new Set(["GOING", "MAYBE", "DECLINED"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { slug } = await params;
  const body = await request.json();
  const status = typeof body.status === "string" ? body.status.toUpperCase() : "";

  if (!allowed.has(status)) {
    return NextResponse.json({ error: "Invalid RSVP status" }, { status: 400 });
  }

  const session = await prisma.coworkingSession.findUnique({
    where: { slug },
    include: {
      _count: {
        select: {
          rsvps: {
            where: { status: "GOING" },
          },
        },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (
    status === "GOING" &&
    session.maxGuests &&
    session._count.rsvps >= session.maxGuests
  ) {
    const existing = await prisma.sessionRsvp.findUnique({
      where: {
        sessionId_userId: {
          sessionId: session.id,
          userId,
        },
      },
    });

    if (!existing || existing.status !== "GOING") {
      return NextResponse.json({ error: "Session is full" }, { status: 409 });
    }
  }

  const rsvp = await prisma.sessionRsvp.upsert({
    where: {
      sessionId_userId: {
        sessionId: session.id,
        userId,
      },
    },
    update: { status: status as "GOING" | "MAYBE" | "DECLINED" },
    create: {
      sessionId: session.id,
      userId,
      status: status as "GOING" | "MAYBE" | "DECLINED",
    },
  });

  return NextResponse.json(rsvp);
}
