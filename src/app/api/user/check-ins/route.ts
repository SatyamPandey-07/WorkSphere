import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET /api/user/check-ins — the caller's most recent check-in at each venue. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checkIns = await prisma.checkIn.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      venue: {
        select: {
          id: true,
          name: true,
          address: true,
          category: true,
          wifiQuality: true,
          wifiSpeed: true,
        },
      },
    },
  });

  const now = Date.now();
  return NextResponse.json({
    checkIns: checkIns.map((c) => ({
      id: c.id,
      checkedInAt: c.createdAt,
      expiresAt: c.expiresAt,
      active: c.expiresAt.getTime() > now,
      venue: c.venue,
    })),
  });
}
