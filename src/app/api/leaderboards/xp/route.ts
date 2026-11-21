import { NextResponse } from "next/server";
import { getXpLeaderboard } from "@/lib/leaderboards/xpLeaderboard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await getXpLeaderboard();
    return NextResponse.json({
      success: true,
      leaderboard: result.data,
      stale: result.stale,
    });
  } catch (error) {
    console.error("[GET /api/leaderboards/xp] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load XP leaderboard." },
      { status: 500 },
    );
  }
}
