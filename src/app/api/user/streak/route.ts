import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { calculateStreak, getUnlockedMilestones } from "@/lib/streak";

// ─── GET /api/user/streak ─────────────────────────────────────────────────────
// Returns the current streak data for the authenticated user.
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        currentStreak: true,
        longestStreak: true,
        lastCheckInDate: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      currentStreak: user.currentStreak,
      longestStreak: user.longestStreak,
      lastCheckInDate: user.lastCheckInDate,
      unlockedMilestones: getUnlockedMilestones(user.currentStreak),
    });
  } catch (error) {
    console.error("GET /api/user/streak error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// ─── POST /api/user/streak/checkin ────────────────────────────────────────────
// Records today's activity check-in and updates the streak.
// Safe to call multiple times per day — duplicates are ignored.
export async function POST() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch current streak state
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        currentStreak: true,
        longestStreak: true,
        lastCheckInDate: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Calculate the new streak values using pure logic
    const result = calculateStreak(
      user.lastCheckInDate,
      user.currentStreak,
      user.longestStreak,
    );

    // Only write to DB if the streak actually changed (not a same-day duplicate)
    if (result.incremented) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          currentStreak: result.currentStreak,
          longestStreak: result.longestStreak,
          lastCheckInDate: result.lastCheckInDate,
        },
      });
    }

    return NextResponse.json({
      currentStreak: result.currentStreak,
      longestStreak: result.longestStreak,
      lastCheckInDate: result.lastCheckInDate,
      incremented: result.incremented,
      newMilestones: result.newMilestones,
      unlockedMilestones: getUnlockedMilestones(result.currentStreak),
    });
  } catch (error) {
    console.error("POST /api/user/streak error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
