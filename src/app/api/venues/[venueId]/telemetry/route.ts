import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { venueId } = await params;
    const body = await req.json();

    const { download, upload, latency, crowdLevel } = body;

    if (!download || !upload || !latency || !crowdLevel) {
      return NextResponse.json(
        { error: "Missing required telemetry fields" },
        { status: 400 },
      );
    }

    // Ensure the venue exists
    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
    });

    if (!venue) {
      return NextResponse.json({ error: "Venue not found" }, { status: 404 });
    }

    const telemetry = await prisma.wifiTelemetry.create({
      data: {
        venueId,
        download: parseFloat(download),
        upload: parseFloat(upload),
        latency: parseFloat(latency),
        crowdLevel,
        timestamp: new Date(),
      },
    });

    return NextResponse.json({ telemetry }, { status: 201 });
  } catch (error) {
    console.error("POST /api/venues/[venueId]/telemetry error:", error);
    return NextResponse.json(
      { error: "Failed to submit wifi telemetry" },
      { status: 500 },
    );
  }
}
