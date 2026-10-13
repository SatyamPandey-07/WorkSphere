import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const venues = await prisma.venue.findMany({
      where: { ownerId: userId },
    });

    return NextResponse.json(venues);
  } catch (error: unknown) {
    console.error("[MANAGED_GET]", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal Server Error",
      },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: unknown = await req.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }
    const values = body as Record<string, unknown>;
    const { venueId } = values;

    if (typeof venueId !== "string" || !venueId) {
      return NextResponse.json(
        { error: "Venue ID is required" },
        { status: 400 },
      );
    }

    const textFields = ["hostMessage", "name", "address", "openingHours"];
    const invalidField = textFields.find(
      (field) => values[field] != null && typeof values[field] !== "string",
    );
    if (invalidField) {
      return NextResponse.json(
        { error: `${invalidField} must be a string` },
        { status: 400 },
      );
    }
    const { hostMessage, name, address, openingHours } = values as Record<
      string,
      string | null | undefined
    >;

    const calibrationProvided =
      values.beaconReferenceRssi !== undefined ||
      values.beaconPathLossExponent !== undefined;
    if (
      calibrationProvided &&
      (typeof values.beaconReferenceRssi !== "number" ||
        !Number.isFinite(values.beaconReferenceRssi) ||
        values.beaconReferenceRssi < -150 ||
        values.beaconReferenceRssi > 0 ||
        typeof values.beaconPathLossExponent !== "number" ||
        !Number.isFinite(values.beaconPathLossExponent) ||
        values.beaconPathLossExponent <= 0 ||
        values.beaconPathLossExponent > 10)
    ) {
      return NextResponse.json(
        { error: "Invalid beacon calibration values" },
        { status: 400 },
      );
    }

    // Verify ownership
    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
    });

    if (!venue) {
      return NextResponse.json({ error: "Venue not found" }, { status: 404 });
    }

    if (venue.ownerId !== userId) {
      return NextResponse.json(
        { error: "Forbidden: You do not own this venue" },
        { status: 403 },
      );
    }

    const updatedVenue = await prisma.venue.update({
      where: { id: venueId },
      data: {
        hostMessage,
        name: name || venue.name,
        address: address !== undefined ? address : venue.address,
        openingHours:
          openingHours !== undefined ? openingHours : venue.openingHours,
        ...(calibrationProvided
          ? {
              beaconReferenceRssi: values.beaconReferenceRssi as number,
              beaconPathLossExponent: values.beaconPathLossExponent as number,
            }
          : {}),
      },
    });

    return NextResponse.json({ success: true, venue: updatedVenue });
  } catch (error: unknown) {
    console.error("[MANAGED_PUT]", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal Server Error",
      },
      { status: 500 },
    );
  }
}
