import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";

const telemetryReadingSchema = z.object({
  venueId: z.string().min(1, "venueId is required"),
  decibels: z.number().min(0, "decibels must be non-negative"),
  peakDecibels: z.number().min(0, "peakDecibels must be non-negative"),
  timestamp: z.number().int().positive("timestamp must be a positive integer"),
});

const batchPayloadSchema = z.object({
  readings: z
    .array(telemetryReadingSchema)
    .min(1, "readings array cannot be empty")
    .max(50, "readings array cannot exceed 50 items"),
});

export async function POST(req: NextRequest) {
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "anonymous";

    const allowed = await rateLimit(`telemetry:batch:${ip}`, 60, 60_000);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please retry later." },
        { status: 429 },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        { status: 400 },
      );
    }

    const validation = batchPayloadSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: validation.error.flatten(),
        },
        { status: 400 },
      );
    }

    const { readings } = validation.data;

    // Execute batch write using prisma.noiseReading.createMany()
    const result = await (prisma as any).noiseReading.createMany({
      data: readings.map((r) => ({
        venueId: r.venueId,
        decibels: r.decibels,
        peakDecibels: r.peakDecibels,
        timestamp: new Date(r.timestamp),
      })),
    });

    return NextResponse.json(
      {
        success: true,
        count: result?.count ?? readings.length,
      },
      { status: 201 },
    );
  } catch (error: any) {
    console.error("[telemetry/batch] Batch processing failed:", error);
    return NextResponse.json(
      { error: "Failed to persist telemetry readings" },
      { status: 500 },
    );
  }
}
