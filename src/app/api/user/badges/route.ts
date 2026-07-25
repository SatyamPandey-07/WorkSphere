import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { badges: true },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 },
      );
    }

    const hasVerifiedExplorer = user.badges.some(
      (b) => b.badgeType === "verified_explorer",
    );
    const progress = Math.min(user.accurateVotes, 10);
    const earned = hasVerifiedExplorer || user.accurateVotes >= 10;

    const badges = [
      {
        id: "verified_explorer",
        name: "Verified Explorer",
        description:
          "Made 10+ accurate amenity votes that matched community consensus.",
        earned,
        progress,
        target: 10,
        icon: "compass",
      },
    ];

    return NextResponse.json({ success: true, accurateVotes: user.accurateVotes, badges });
  } catch (error: any) {
    console.error("GET /api/user/badges error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}
