import { auth } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { eventBus } from "@/core/events";
import { autoPromoteSessionWaitlist } from "@/lib/social/waitlistPromotion";
import { generateSessionIcs } from "@/lib/social/sessionIcs";
import "@/core/subscribers/discord";

const allowed = new Set(["GOING", "MAYBE", "DECLINED", "CANCELLED"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const { slug } = await params;
  const body = await request.json();
  let status = typeof body.status === "string" ? body.status.toUpperCase() : "";

  if (!allowed.has(status)) {
    return NextResponse.json({ error: "Invalid RSVP status" }, { status: 400 });
  }

  if (status === "CANCELLED") {
    status = "DECLINED";
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const session = await tx.coworkingSession.findUnique({
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
          throw new Error("SESSION_NOT_FOUND");
        }

        const existing = await tx.sessionRsvp.findUnique({
          where: {
            sessionId_userId: {
              sessionId: session.id,
              userId,
            },
          },
        });

        if (
          status === "GOING" &&
          session.maxGuests &&
          session._count.rsvps >= session.maxGuests &&
          (!existing || existing.status !== "GOING")
        ) {
          throw new Error("SESSION_FULL");
        }

        const wasPreviouslyGoing = existing?.status === "GOING";

        const rsvp = await tx.sessionRsvp.upsert({
          where: {
            sessionId_userId: {
              sessionId: session.id,
              userId,
            },
          },
          update: {
            status: status as "GOING" | "MAYBE" | "DECLINED",
          },
          create: {
            sessionId: session.id,
            userId,
            status: status as "GOING" | "MAYBE" | "DECLINED",
          },
        });

        return {
          session,
          rsvp,
          wasPreviouslyGoing,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    await eventBus.emit("session:rsvp", {
      sessionId: result.session.id,
      rsvpId: result.rsvp.id,
      userId,
      status: result.rsvp.status,
    });

    let promotionResult = null;
    if (result.wasPreviouslyGoing && status !== "GOING") {
      promotionResult = await autoPromoteSessionWaitlist(result.session.id);
    }

    const calendar =
      status === "GOING"
        ? {
            icsString: generateSessionIcs({
              title: session.title,
              description: session.description,
              startsAt: session.startsAt,
              endsAt: session.endsAt,
              venueName: session.venue?.name,
              venueAddress: session.venue?.address,
              slug: session.slug,
              organizerName: session.host
                ? `${session.host.firstName || ""} ${session.host.lastName || ""}`.trim()
                : undefined,
            }),
            downloadUrl: `/api/social/sessions/${session.slug}/rsvp?download=ics`,
          }
        : null;

    return NextResponse.json({
      ...result.rsvp,
      promotedWaitlist: promotionResult?.promotedRsvps ?? [],
      calendar,
    });
  } catch (error: any) {
    if (error.message === "SESSION_NOT_FOUND") {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (error.message === "SESSION_FULL") {
      return NextResponse.json({ error: "Session is full" }, { status: 409 });
    }

    if (error.code === "P2034") {
      return NextResponse.json({ error: "Session is full" }, { status: 409 });
    }

    throw error;
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const { slug } = await params;

  const session = await prisma.coworkingSession.findUnique({
    where: { slug },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const existing = await prisma.sessionRsvp.findUnique({
    where: {
      sessionId_userId: {
        sessionId: session.id,
        userId,
      },
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "RSVP not found" }, { status: 404 });
  }

  const wasGoing = existing.status === "GOING";

  await prisma.sessionRsvp.delete({
    where: {
      sessionId_userId: {
        sessionId: session.id,
        userId,
      },
    },
  });

  await eventBus.emit("session:rsvp", {
    sessionId: session.id,
    rsvpId: existing.id,
    userId,
    status: "DECLINED",
  });

  let promotionResult = null;
  if (wasGoing) {
    promotionResult = await autoPromoteSessionWaitlist(session.id);
  }

  return NextResponse.json({
    success: true,
    message: "RSVP cancelled successfully",
    promotedWaitlist: promotionResult?.promotedRsvps ?? [],
  });
}
