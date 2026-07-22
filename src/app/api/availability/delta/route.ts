import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

const STATUS_THRESHOLD: Record<string, number> = {
  green: 0.6,
  yellow: 1,
};

function computeStatus(count: number, capacity: number): string {
  if (capacity <= 0) return "red";
  const ratio = count / capacity;
  if (ratio >= STATUS_THRESHOLD.red) return "red";
  if (ratio >= STATUS_THRESHOLD.yellow) return "yellow";
  return "green";
}

export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ venues: [] });
    }

    const favorites = await prisma.favorite.findMany({
      where: { userId },
      select: { venueId: true },
    });

    if (favorites.length === 0) {
      return NextResponse.json({ venues: [] });
    }

    const venueIds = favorites.map((f) => f.venueId);

    const venues = await prisma.venue.findMany({
      where: { id: { in: venueIds } },
      select: {
        id: true,
        name: true,
        currentOccupancy: true,
        maxCapacity: true,
      },
    });

    const result = venues.map((v) => ({
      venueId: v.id,
      venueName: v.name,
      count: v.currentOccupancy,
      capacity: v.maxCapacity,
      status: computeStatus(v.currentOccupancy, v.maxCapacity),
    }));

    return NextResponse.json({ venues: result });
  } catch (error) {
    console.error("GET /api/availability/delta error:", error);
    return NextResponse.json({ venues: [] });
  }
}
