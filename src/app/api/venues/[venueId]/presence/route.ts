import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ venueId: string }> };

export interface ColleaguePresenceItem {
  userId: string;
  name: string;
  imageUrl: string | null;
  statusNote: string | null;
  seatNumber: string | null;
  until: string | null;
  presenceType: "buddy_status" | "checked_in" | "active_booking";
}

/**
 * GET /api/venues/[venueId]/presence
 * Returns live presence of colleagues and teammates working at the specified venue.
 */
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { userId: currentUserId } = await auth();
    const { venueId } = await context.params;

    const venue = await prisma.venue.findFirst({
      where: { OR: [{ id: venueId }, { placeId: venueId }] },
      select: { id: true, name: true },
    });

    if (!venue) {
      return NextResponse.json({ activeCount: 0, colleagues: [] });
    }

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    // 1. Fetch active WorkBuddyStatus records
    const buddyStatuses = await prisma.workBuddyStatus.findMany({
      where: {
        venueId: venue.id,
        isPublic: true,
        until: { gt: now },
      },
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
      take: 20,
    });

    // 2. Fetch active CheckIns
    const checkIns = await prisma.checkIn.findMany({
      where: {
        venueId: venue.id,
        expiresAt: { gt: now },
      },
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
      take: 20,
    });

    // 3. Fetch active today's confirmed bookings
    const activeBookings = await prisma.booking.findMany({
      where: {
        venueId: venue.id,
        date: todayStr,
        status: "CONFIRMED",
      },
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
      take: 20,
    });

    // Deduplicate colleagues by userId
    const colleagueMap = new Map<string, ColleaguePresenceItem>();

    for (const b of buddyStatuses) {
      if (!b.user) continue;
      const name = [b.user.firstName, b.user.lastName].filter(Boolean).join(" ") || "WorkSphere Member";
      colleagueMap.set(b.user.id, {
        userId: b.user.id,
        name,
        imageUrl: b.user.imageUrl,
        statusNote: b.note,
        seatNumber: null,
        until: b.until.toISOString(),
        presenceType: "buddy_status",
      });
    }

    for (const c of checkIns) {
      if (!c.user || colleagueMap.has(c.user.id)) continue;
      const name = [c.user.firstName, c.user.lastName].filter(Boolean).join(" ") || "WorkSphere Member";
      colleagueMap.set(c.user.id, {
        userId: c.user.id,
        name,
        imageUrl: c.user.imageUrl,
        statusNote: "Working here right now",
        seatNumber: null,
        until: c.expiresAt.toISOString(),
        presenceType: "checked_in",
      });
    }

    for (const bk of activeBookings) {
      if (!bk.user) continue;
      if (colleagueMap.has(bk.user.id)) {
        // Enhance existing entry with seatNumber if present
        const existing = colleagueMap.get(bk.user.id)!;
        if (!existing.seatNumber && bk.seatNumber) {
          existing.seatNumber = bk.seatNumber;
        }
      } else {
        const name = [bk.user.firstName, bk.user.lastName].filter(Boolean).join(" ") || "WorkSphere Member";
        colleagueMap.set(bk.user.id, {
          userId: bk.user.id,
          name,
          imageUrl: bk.user.imageUrl,
          statusNote: `Reserved session at ${bk.time}`,
          seatNumber: bk.seatNumber,
          until: null,
          presenceType: "active_booking",
        });
      }
    }

    const colleagues = Array.from(colleagueMap.values());
    const isSelfPresent = currentUserId ? colleagueMap.has(currentUserId) : false;

    return NextResponse.json({
      venueId: venue.id,
      venueName: venue.name,
      activeCount: colleagues.length,
      colleagues,
      isSelfPresent,
    });
  } catch (error: any) {
    console.error("[GET /api/venues/[venueId]/presence] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch venue presence", activeCount: 0, colleagues: [] },
      { status: 500 },
    );
  }
}
