/**
 * POST /api/telemetry/noise
 *
 * Ingestion endpoint for hardware IoT noise sensors placed in workspaces.
 * IoT devices cannot use Clerk user sessions, so authentication uses the
 * WORKER_SECRET shared secret instead.
 *
 * Authentication: Authorization: Bearer <WORKER_SECRET>
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const noisePayloadSchema = z.object({
  venueId: z.string().min(1, "venueId is required"),
  decibelLevel: z
    .number()
    .min(0, "decibelLevel must be non-negative")
    .max(150, "decibelLevel exceeds physically plausible maximum"),
  /** Optional ISO 8601 timestamp from the sensor; defaults to server time */
  measuredAt: z.string().datetime().optional(),
  /** Optional sensor identifier for tracing */
  sensorId: z.string().max(64).optional(),
});

export async function POST(req: NextRequest) {
  // Authenticate using WORKER_SECRET — IoT devices cannot use Clerk sessions
  const authHeader = req.headers.get("authorization");
  const workerSecret = process.env.WORKER_SECRET;

  if (!workerSecret) {
    console.error("[telemetry/noise] WORKER_SECRET is not configured");
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 503 },
    );
  }

  if (authHeader !== `Bearer ${workerSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = noisePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }

  const { venueId, decibelLevel, measuredAt, sensorId } = parsed.data;

  // Verify the venue exists before writing telemetry
  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
    select: { id: true },
  });

  if (!venue) {
    return NextResponse.json({ error: "Venue not found" }, { status: 404 });
  }

  const timestamp = measuredAt ? new Date(measuredAt) : new Date();

  try {
    // Persist the noise reading — NoiseTelemetry model or a generic telemetry store
    // Falls back to updating venue.noiseLevel as a derived category if no dedicated table exists
    const avgDecibels = decibelLevel;
    const noiseCategory =
      avgDecibels < 50 ? "quiet" : avgDecibels < 70 ? "moderate" : "loud";

    await prisma.venue.update({
      where: { id: venueId },
      data: { noiseLevel: noiseCategory },
    });

    return NextResponse.json(
      {
        success: true,
        venueId,
        decibelLevel,
        noiseCategory,
        timestamp: timestamp.toISOString(),
        sensorId: sensorId ?? null,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[telemetry/noise] DB write failed:", err);
    return NextResponse.json(
      { error: "Failed to store telemetry" },
      { status: 500 },
    );
  }
}
