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

    // 2. Fetch active CheckIns with user's WorkBuddy consent status
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
            workStatus: {
              select: {
                isPublic: true,
                until: true,
                venueId: true,
              },
            },
          },
        },
      },
      take: 20,
    });

    // 3. Fetch active today's confirmed bookings with user's WorkBuddy consent status
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
            workStatus: {
              select: {
                isPublic: true,
                until: true,
                venueId: true,
              },
            },
          },
        },
      },
      take: 20,
    });

    // Calculate total aggregate occupancy across all sources without leaking identities
    const allOccupantUserIds = new Set<string>();
    for (const b of buddyStatuses)
      if (b.userId) allOccupantUserIds.add(b.userId);
    for (const c of checkIns) if (c.userId) allOccupantUserIds.add(c.userId);
    for (const bk of activeBookings)
      if (bk.userId) allOccupantUserIds.add(bk.userId);
    const totalOccupants = allOccupantUserIds.size;

    // Unauthenticated callers receive aggregate occupancy only (zero PII exposure)
    if (!currentUserId) {
      return NextResponse.json({
        venueId: venue.id,
        venueName: venue.name,
        activeCount: totalOccupants,
        totalOccupancy: totalOccupants,
        colleagues: [],
        isSelfPresent: false,
      });
    }

    const hasPublicConsent = (
      user: {
        id: string;
        workStatus?: { isPublic: boolean; until: Date; venueId: string } | null;
      } | null,
    ): boolean => {
      if (!user) return false;
      if (user.id === currentUserId) return true; // User can always view their own status
      if (!user.workStatus) return false;
      return (
        user.workStatus.isPublic === true &&
        user.workStatus.venueId === venue.id &&
        new Date(user.workStatus.until) > now
      );
    };

    // Deduplicate colleagues by userId (only users with explicit public consent)
    const colleagueMap = new Map<string, ColleaguePresenceItem>();

    for (const b of buddyStatuses) {
      if (!b.user) continue;
      const name =
        [b.user.firstName, b.user.lastName].filter(Boolean).join(" ") ||
        "WorkSphere Member";
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
      // Require explicit public presence consent before exposing attendee details
      if (!hasPublicConsent(c.user)) continue;

      const name =
        [c.user.firstName, c.user.lastName].filter(Boolean).join(" ") ||
        "WorkSphere Member";
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
        // Require explicit public presence consent before exposing attendee details
        if (!hasPublicConsent(bk.user)) continue;

        const name =
          [bk.user.firstName, bk.user.lastName].filter(Boolean).join(" ") ||
          "WorkSphere Member";
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
    const isSelfPresent = currentUserId
      ? allOccupantUserIds.has(currentUserId)
      : false;

    return NextResponse.json({
      venueId: venue.id,
      venueName: venue.name,
      activeCount: totalOccupants,
      totalOccupancy: totalOccupants,
      colleagues,
      isSelfPresent,
    });
  } catch (error: any) {
    console.error("[GET /api/venues/[venueId]/presence] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch venue presence",
        activeCount: 0,
        colleagues: [],
      },
      { status: 500 },
    );
  }
}
