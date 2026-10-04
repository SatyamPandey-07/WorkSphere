import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { apiError } from "@/lib/apiResponse";

const VALID_REASONS = [
  "permanently_closed",
  "wrong_hours",
  "no_wifi",
  "wrong_address",
  "duplicate",
  "other",
] as const;

type FlagReason = (typeof VALID_REASONS)[number];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED");
  }

  // Rate limit: 5 flag reports per user per hour
  const limited = await rateLimit(`venue-flag:${userId}`, 5, 3_600_000);
  if (!limited) {
    return apiError(
      "Too many reports. Please try again later.",
      429,
      "RATE_LIMITED",
    );
  }

  const { venueId } = await params;
  const body = await req.json();
  const reason: FlagReason = body.reason;

  if (!VALID_REASONS.includes(reason)) {
    return apiError(
      `Invalid reason. Must be one of: ${VALID_REASONS.join(", ")}`,
      400,
      "VALIDATION_FAILED",
    );
  }

  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
    select: { id: true },
  });
  if (!venue) {
    return apiError("Venue not found", 404, "VENUE_NOT_FOUND");
  }

  // Prevent duplicate flags from the same user for the same venue + reason
  const existing = await prisma.flaggedItem.findFirst({
    where: { itemId: venueId, reportedById: userId, reason, status: "PENDING" },
  });
  if (existing) {
    return NextResponse.json(
      { message: "You have already reported this issue." },
      { status: 200 },
    );
  }

  await prisma.flaggedItem.create({
    data: {
      type: "VENUE",
      itemId: venueId,
      reason,
      reportedById: userId,
    },
  });

  return NextResponse.json({
    message: "Report submitted. Thank you for your feedback!",
  });
}
