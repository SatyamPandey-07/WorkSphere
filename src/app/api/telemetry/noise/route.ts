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
import { Prisma } from "@prisma/client";
import {
  addGaussianNoise,
  calibrateGaussianSigma,
  clipByL2Sensitivity,
  composeRdp,
  DEFAULT_RDP_ORDERS,
  gaussianRdp,
  rdpToEpsilon,
} from "@/lib/privacy/rdpAccountant";
import { z } from "zod";

const DAILY_EPSILON_BUDGET = 1;
const DAILY_DELTA = 1e-5;
const DECIBEL_SENSITIVITY = 150;

class PrivacyBudgetExhaustedError extends Error {}

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

  const epochKey = new Date().toISOString().slice(0, 10);

  try {
    const result = await prisma.$transaction(
      async (transaction) => {
        const prior = await transaction.noiseTelemetryRelease.findUnique({
          where: { venueId_epochKey: { venueId, epochKey } },
          select: { rdpCosts: true, submissions: true },
        });
        const spentRdp = prior
          ? (prior.rdpCosts as number[])
          : DEFAULT_RDP_ORDERS.map(() => 0);
        if (
          spentRdp.length !== DEFAULT_RDP_ORDERS.length ||
          spentRdp.some((cost) => !Number.isFinite(cost) || cost < 0)
        ) {
          throw new Error("Stored privacy accountant state is invalid");
        }

        const sigma = calibrateGaussianSigma(
          DECIBEL_SENSITIVITY,
          DAILY_EPSILON_BUDGET,
          DAILY_DELTA,
          spentRdp,
        );
        if (sigma === null) throw new PrivacyBudgetExhaustedError();

        const clipped = clipByL2Sensitivity(
          [decibelLevel],
          DECIBEL_SENSITIVITY,
        );
        const privateDecibels = Math.min(
          150,
          Math.max(0, addGaussianNoise(clipped, sigma)[0]),
        );
        const noiseCategory =
          privateDecibels < 50
            ? "quiet"
            : privateDecibels < 70
              ? "moderate"
              : "loud";
        const updatedRdp = composeRdp(
          spentRdp,
          gaussianRdp(sigma, DECIBEL_SENSITIVITY),
        );
        const submissions = (prior?.submissions ?? 0) + 1;

        await transaction.noiseTelemetryRelease.upsert({
          where: { venueId_epochKey: { venueId, epochKey } },
          create: {
            venueId,
            epochKey,
            avgDecibels: privateDecibels,
            rdpCosts: updatedRdp,
            submissions,
          },
          update: {
            avgDecibels: privateDecibels,
            rdpCosts: updatedRdp,
            submissions,
          },
        });
        await transaction.venue.update({
          where: { id: venueId },
          data: { noiseLevel: noiseCategory },
        });

        return {
          noiseCategory,
          submissions,
          epsilon: rdpToEpsilon(updatedRdp, DAILY_DELTA),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return NextResponse.json({
      success: true,
      venueId,
      noiseCategory: result.noiseCategory,
      timestamp: timestamp.toISOString(),
      sensorId: sensorId ?? null,
      privacy: {
        epsilon: result.epsilon,
        delta: DAILY_DELTA,
        submissions: result.submissions,
      },
    });
  } catch (err) {
    if (err instanceof PrivacyBudgetExhaustedError) {
      return NextResponse.json(
        { error: "Daily telemetry privacy budget exhausted" },
        { status: 429 },
      );
    }
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2034"
    ) {
      return NextResponse.json(
        { error: "Concurrent telemetry update; please retry" },
        { status: 409 },
      );
    }
    console.error("[telemetry/noise] DB write failed:", err);
    return NextResponse.json(
      { error: "Failed to store telemetry" },
      { status: 500 },
    );
  }
}
