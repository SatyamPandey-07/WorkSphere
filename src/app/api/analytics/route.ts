import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { ensureUserExists } from "@/lib/auth";
import { calculateLevel } from "@/lib/gamification";
import { isValidTimeZone } from "@/lib/booking/dateTimeAdapter";

export const dynamic = "force-dynamic";

/**
 * Resolves the 0-23 local hour of a Date in the target IANA timezone.
 */
export function getLocalHourInTimeZone(date: Date, timeZone: string): number {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return 12; // safe non-night-owl default
  }
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    hour: "numeric",
  }).formatToParts(date);
  const hourPart = parts.find((p) => p.type === "hour");
  const hour = Number(hourPart?.value ?? 0);
  return hour === 24 ? 0 : hour;
}

/**
 * Determines whether a review qualifies for the Night Owl badge
 * (created at or after 21:00 or before 05:00 in the user's configured timezone).
 */
export function isNightOwlReview(
  createdAt: Date,
  timeZone?: string | null,
): boolean {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const hours = getLocalHourInTimeZone(createdAt, zone);
  return hours >= 21 || hours < 5;
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 0. Ensure Identity 💎
    await ensureUserExists(userId);

    // 1. Get User Details with full inclusions
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        bookings: {
          take: 10,
          orderBy: { createdAt: "desc" },
          include: {
            venue: {
              select: {
                name: true,
                category: true,
                address: true,
                latitude: true,
                longitude: true,
              },
            },
          },
        },
        favorites: {
          take: 10,
          orderBy: { createdAt: "desc" },
          include: {
            venue: {
              select: { name: true, category: true },
            },
          },
        },
        ratings: {
          take: 10,
          orderBy: { createdAt: "desc" },
          include: {
            venue: {
              select: { name: true },
            },
          },
        },
        _count: {
          select: {
            bookings: true,
            favorites: true,
            ratings: true,
            conversations: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found in neural ledger" },
        { status: 404 },
      );
    }

    const u = user as any;

    // 1.5. Calculate Gamification Data via Database Aggregates
    // Execute database-level aggregations in parallel instead of unbounded in-memory table scans
    const [
      reviewsCount,
      speedtestsCount,
      uniqueCafeGroups,
      venuesAddedCount,
      nightOwlRatings,
    ] = await Promise.all([
      // A. Database count of all user ratings
      prisma.venueRating.count({
        where: { userId },
      }),
      // B. Database count of verified speedtests (wifiSpeed > 0)
      prisma.venueRating.count({
        where: {
          userId,
          wifiSpeed: { gt: 0 },
        },
      }),
      // C. Database groupBy for distinct cafe venues
      prisma.booking.groupBy({
        by: ["venueId"],
        where: {
          userId,
          status: "CONFIRMED",
          venue: {
            category: "cafe",
          },
        },
      }),
      // D. Count of venues created
      prisma.venue.count({
        where: { creatorId: userId },
      }),
      // E. Fetch ratings with createdAt to determine night reviews in user's timezone
      prisma.venueRating.findMany({
        where: { userId },
        select: {
          createdAt: true,
        },
      }),
    ]);

    const uniqueCafesBooked = uniqueCafeGroups.length;
    const userTimeZone = isValidTimeZone(user.timezone) ? user.timezone : "UTC";

    const nightOwlReviewsCount = nightOwlRatings.filter((r) =>
      isNightOwlReview(new Date(r.createdAt), userTimeZone),
    ).length;

    // XP Breakdown:
    // - 50 XP per Review (rating)
    // - 100 XP per Venue added
    // - 100 XP per Speedtest uploaded
    const totalXp =
      reviewsCount * 50 + venuesAddedCount * 100 + speedtestsCount * 100;

    const lvlInfo = calculateLevel(totalXp);

    const accurateVotes = user.accurateVotes;

    const badges = [
      {
        id: "wifi_scout",
        name: "WiFi Scout",
        description: "Verified 3+ venue speedtests.",
        earned: speedtestsCount >= 3,
        progress: Math.min(speedtestsCount, 3),
        target: 3,
        icon: "wifi",
      },
      {
        id: "cafe_nomad",
        name: "Cafe Nomad",
        description: "Checked in/booked at 5 different cafes.",
        earned: uniqueCafesBooked >= 5,
        progress: Math.min(uniqueCafesBooked, 5),
        target: 5,
        icon: "cafe",
      },
      {
        id: "night_owl",
        name: "Night Owl",
        description: "Left reviews at venues after 9 PM.",
        earned: nightOwlReviewsCount >= 1,
        progress: Math.min(nightOwlReviewsCount, 1),
        target: 1,
        icon: "moon",
      },
      {
        id: "verified_explorer",
        name: "Verified Explorer",
        description:
          "Made 10+ accurate amenity votes matching community consensus.",
        earned: accurateVotes >= 10,
        progress: Math.min(accurateVotes, 10),
        target: 10,
        icon: "compass",
      },
    ];

    // 2. Format User-Centric Analytics
    return NextResponse.json({
      profile: {
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        joinedAt: u.createdAt,
      },
      summary: {
        totalResidencies: u._count?.bookings || 0,
        totalFavorites: u._count?.favorites || 0,
        totalRatings: u._count?.ratings || 0,
        totalConversations: u._count?.conversations || 0,
      },
      history: {
        bookings: u.bookings || [],
        favorites: u.favorites || [],
        ratings: u.ratings || [],
      },
      gamification: {
        level: lvlInfo.level,
        xp: lvlInfo.xp,
        xpInCurrentLevel: lvlInfo.xpInCurrentLevel,
        xpForNextLevel: lvlInfo.xpForNextLevel,
        progressPercent: lvlInfo.progressPercent,
        xpBreakdown: {
          reviewsXp: reviewsCount * 50,
          venuesXp: venuesAddedCount * 100,
          speedtestsXp: speedtestsCount * 100,
        },
        stats: {
          reviewsCount,
          venuesAddedCount,
          speedtestsCount,
          uniqueCafesBooked,
          nightOwlReviewsCount,
          accurateVotes,
        },
        badges,
      },
      timestamp: Date.now(),
    });
  } catch (error: any) {
    console.error("Personalized Analytics API Error:", error);
    const errorMessage =
      process.env.NODE_ENV !== "production"
        ? `${error.message || error}`
        : "Failed to fetch neural profile";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
