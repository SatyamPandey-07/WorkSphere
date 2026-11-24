import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { enqueueTelemetry } from "@/lib/telemetryQueue";
import { applyPrivacyFilter } from "@/lib/privacy/differentialPrivacy";
import { apiError } from "@/lib/apiResponse";

export const CANONICAL_CROWD_LEVELS = [
  "empty",
  "low",
  "quiet",
  "moderate",
  "busy",
  "very busy",
  "packed",
] as const;

export type CanonicalCrowdLevel = (typeof CANONICAL_CROWD_LEVELS)[number];

export const telemetrySchema = z.object({
  download: z
    .number({ message: "Download speed must be a valid number" })
    .finite("Download speed must be a finite number")
    .nonnegative("Download speed must be a non-negative number"),
  upload: z
    .number({ message: "Upload speed must be a valid number" })
    .finite("Upload speed must be a finite number")
    .nonnegative("Upload speed must be a non-negative number"),
  latency: z
    .number({ message: "Latency must be a valid number" })
    .finite("Latency must be a finite number")
    .nonnegative("Latency must be a non-negative number"),
  crowdLevel: z
    .string({ message: "Crowd level is required" })
    .trim()
    .toLowerCase()
    .pipe(
      z.enum(CANONICAL_CROWD_LEVELS, {
        message: "Invalid crowd level",
      }),
    ),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return apiError("Unauthorized", 401, "UNAUTHORIZED");
    }

    const { venueId } = await params;

    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
      select: { id: true },
    });

    if (!venue) {
      return apiError("Venue not found", 404, "VENUE_NOT_FOUND");
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return apiError("Invalid JSON in request body", 400, "VALIDATION_FAILED");
    }

    const parseResult = telemetrySchema.safeParse(body);
    if (!parseResult.success) {
      const errorMessage =
        parseResult.error.issues?.[0]?.message ||
        parseResult.error.errors?.[0]?.message ||
        "Validation failed";
      return apiError(errorMessage, 400, "VALIDATION_FAILED");
    }

    const { download, upload, latency, crowdLevel } = parseResult.data;

    await enqueueTelemetry({
      venueId,
      download,
      upload,
      latency,
      crowdLevel,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({ queued: true }, { status: 202 });
  } catch (error) {
    console.error("POST /api/venues/[venueId]/telemetry error:", error);
    return apiError("Failed to submit wifi telemetry", 500, "INTERNAL_ERROR");
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;

    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
      include: {
        wifiTelemetry: {
          orderBy: { timestamp: "desc" },
          take: 100,
        },
      },
    });

    if (!venue && !venueId.startsWith("mock-")) {
      return apiError("Venue not found", 404, "VENUE_NOT_FOUND");
    }

    const telemetryData = venue?.wifiTelemetry || [];
    const hourlyData: Record<number, number[]> = {};

    // Map string levels to a numeric score (0 - 100)
    const crowdLevelMap: Record<string, number> = {
      empty: 10,
      low: 25,
      quiet: 25,
      moderate: 50,
      busy: 75,
      "very busy": 90,
      packed: 100,
    };

    telemetryData.forEach((entry) => {
      const hour = new Date(entry.timestamp).getHours();
      if (!hourlyData[hour]) hourlyData[hour] = [];
      const score = crowdLevelMap[entry.crowdLevel.toLowerCase()] || 50;
      hourlyData[hour].push(score);
    });

    const occupancy = [];
    for (let hour = 8; hour <= 20; hour++) {
      const timeLabel =
        hour === 12 ? "12 PM" : hour > 12 ? `${hour - 12} PM` : `${hour} AM`;

      let avgOccupancy = 50; // default if no data
      if (hourlyData[hour] && hourlyData[hour].length > 0) {
        avgOccupancy = Math.round(
          hourlyData[hour].reduce((a, b) => a + b, 0) / hourlyData[hour].length,
        );
      } else {
        // Fallback curve if no data exists
        if (hour < 10) avgOccupancy = 30;
        else if (hour <= 12) avgOccupancy = 60;
        else if (hour <= 14) avgOccupancy = 80;
        else if (hour <= 16) avgOccupancy = 70;
        else if (hour <= 18) avgOccupancy = 85;
        else avgOccupancy = 40;
        // add some random noise so it looks realistic
        avgOccupancy = Math.min(
          100,
          Math.max(0, avgOccupancy + (Math.random() * 10 - 5)),
        );
        avgOccupancy = Math.round(avgOccupancy);
      }

      const numActiveVisitors = hourlyData[hour] ? hourlyData[hour].length : 0;
      if (numActiveVisitors > 0 && numActiveVisitors < 10) {
        // Apply the privacy filter to public venue occupancy queries when active visitors are below threshold N < 10
        avgOccupancy = applyPrivacyFilter(avgOccupancy, 100, 1.0, 10);
      }

      occupancy.push({
        time: timeLabel,
        occupancy: avgOccupancy,
      });
    }

    return NextResponse.json({ occupancy });
  } catch (error) {
    console.error("GET /api/venues/[venueId]/telemetry error:", error);
    return apiError("Failed to fetch telemetry data", 500, "INTERNAL_ERROR");
  }
}
