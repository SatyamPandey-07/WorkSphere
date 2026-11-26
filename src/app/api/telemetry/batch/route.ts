import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { rateLimit, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export const DEFAULT_TELEMETRY_MAX_PAST_SKEW_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_TELEMETRY_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_DATE_TIMESTAMP_MS = 8_640_000_000_000_000;

type TelemetryTimestampInput = number | string | Date;

function parseTelemetryTimestampMs(
  value: TelemetryTimestampInput,
): number | null {
  let timestampMs: number;

  if (typeof value === "number") {
    // Numeric telemetry timestamps retain the route's existing epoch-millisecond contract.
    // Reject current-era Unix seconds instead of misreading them as milliseconds.
    if (value >= 1_000_000_000 && value < 100_000_000_000) return null;
    timestampMs = value;
  } else if (value instanceof Date) {
    timestampMs = value.getTime();
  } else {
    const timezoneLessIsoDateTime =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
    const normalizedValue = timezoneLessIsoDateTime.test(value)
      ? `${value}Z`
      : value;
    timestampMs = Date.parse(normalizedValue);
  }

  if (
    !Number.isSafeInteger(timestampMs) ||
    Math.abs(timestampMs) > MAX_DATE_TIMESTAMP_MS ||
    !Number.isFinite(new Date(timestampMs).getTime())
  ) {
    return null;
  }

  return timestampMs;
}

function getConfiguredTimestampSkewMs(
  name: string,
  defaultValue: number,
): number {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue.trim() === "") return defaultValue;

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer in milliseconds`);
  }

  return value;
}

export function getTelemetryTimestampSkewWindow() {
  return {
    maxPastSkewMs: getConfiguredTimestampSkewMs(
      "TELEMETRY_TIMESTAMP_MAX_PAST_SKEW_MS",
      DEFAULT_TELEMETRY_MAX_PAST_SKEW_MS,
    ),
    maxFutureSkewMs: getConfiguredTimestampSkewMs(
      "TELEMETRY_TIMESTAMP_MAX_FUTURE_SKEW_MS",
      DEFAULT_TELEMETRY_MAX_FUTURE_SKEW_MS,
    ),
  };
}

const telemetryTimestampSchema = z.union([
  z
    .number()
    .int()
    .positive("timestamp must be a positive integer epoch in milliseconds")
    .refine((value) => parseTelemetryTimestampMs(value) !== null, {
      message: "timestamp must be a valid epoch-millisecond value",
    }),
  z.string().min(1).refine((value) => parseTelemetryTimestampMs(value) !== null, {
    message: "timestamp must be a valid date string",
  }),
  z.date().refine((value) => parseTelemetryTimestampMs(value) !== null, {
    message: "timestamp must be a valid date",
  }),
]);

export const telemetryReadingSchema = z
  .object({
    venueId: z.string().min(1, "venueId is required"),
    roomId: z.string().min(1).optional(),
    sensorId: z.string().min(1).optional(),
    type: z.string().min(1).optional(),
    value: z.number().optional(),
    decibels: z.number().min(0, "decibels must be non-negative").optional(),
    peakDecibels: z.number().min(0, "peakDecibels must be non-negative").optional(),
    timestamp: telemetryTimestampSchema.optional(),
    recordedAt: telemetryTimestampSchema.optional(),
  })
  .refine(
    (data) => data.value !== undefined || data.decibels !== undefined,
    {
      message: "Either value or decibels must be specified",
    },
  );

export const telemetryBatchSchema = z
  .array(telemetryReadingSchema)
  .min(1, "readings array cannot be empty")
  .max(100, "readings array cannot exceed 100 items");

/**
 * Validates telemetry records in parallel using Zod schema array parser.
 */
export async function validateTelemetryBatchParallel(readings: unknown[]) {
  if (!Array.isArray(readings)) {
    throw new Error("readings must be an array");
  }
  if (readings.length === 0) {
    throw new Error("readings array cannot be empty");
  }
  if (readings.length > 100) {
    throw new Error("readings array cannot exceed 100 items");
  }

  return Promise.all(
    readings.map(async (item, index) => {
      const result = await telemetryReadingSchema.safeParseAsync(item);
      return { index, result };
    }),
  );
}

/**
 * Validates gateway API token authentication if configured in environment.
 */
export function verifyGatewayToken(req: NextRequest): boolean {
  const configuredToken =
    process.env.GATEWAY_API_TOKEN ||
    process.env.TELEMETRY_GATEWAY_TOKEN ||
    process.env.WORKER_SECRET;

  const authHeader = req.headers.get("authorization");
  const customHeader =
    req.headers.get("x-gateway-token") || req.headers.get("x-api-key");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : authHeader?.startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : null;
  const provided = bearerToken || customHeader;

  // If gateway token is configured in environment, require and validate it
  if (configuredToken) {
    if (!provided) return false;
    try {
      const bufA = Buffer.from(provided);
      const bufB = Buffer.from(configuredToken);
      return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
    } catch {
      return false;
    }
  }

  // If a token header was provided without an env secret, ensure it is non-empty
  if (provided !== null && provided !== undefined) {
    return provided.length > 0;
  }

  return true;
}

/**
 * POST /api/telemetry/batch
 * Bulk telemetry ingestion pipeline with batch insert transactions,
 * parallel Zod validation, gateway API token authentication, and IP rate limiting.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Gateway API Token Authentication
    if (!verifyGatewayToken(req)) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid or missing gateway API token" },
        { status: 401 },
      );
    }

    // 2. IP Rate Limiting (60 requests / minute)
    const ip = getClientIp(req);

    const allowed = await rateLimit(`telemetry:batch:${ip}`, 60, 60_000);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please retry later." },
        { status: 429 },
      );
    }

    // 3. Parse JSON Body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        { status: 400 },
      );
    }

    // 4. Validate Batch Size (up to 100 readings per payload)
    const rawReadings = Array.isArray(body)
      ? body
      : (body as any)?.readings ||
        (body as any)?.sensorReadings ||
        (body as any)?.data;

    if (!Array.isArray(rawReadings)) {
      return NextResponse.json(
        { error: "Validation failed", details: "readings must be an array" },
        { status: 400 },
      );
    }

    if (rawReadings.length === 0) {
      return NextResponse.json(
        { error: "Validation failed", details: "readings array cannot be empty" },
        { status: 400 },
      );
    }

    if (rawReadings.length > 100) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: "readings array cannot exceed 100 items",
        },
        { status: 400 },
      );
    }

    // 5. Parallel Zod Schema Array Parsing
    const validationResults = await validateTelemetryBatchParallel(rawReadings);

    const validationErrors: Array<{ index: number; errors: any }> = [];
    const validRecords: Array<{
      venueId: string;
      roomId: string;
      sensorId: string;
      type: string;
      value: number;
      recordedAt: Date;
    }> = [];
    const timestampSkewWindow = getTelemetryTimestampSkewWindow();
    const nowMs = Date.now();
    const earliestAllowedTimestampMs =
      nowMs - timestampSkewWindow.maxPastSkewMs;
    const latestAllowedTimestampMs =
      nowMs + timestampSkewWindow.maxFutureSkewMs;

    if (
      !Number.isFinite(new Date(earliestAllowedTimestampMs).getTime()) ||
      !Number.isFinite(new Date(latestAllowedTimestampMs).getTime())
    ) {
      throw new Error("Telemetry timestamp skew window exceeds the Date range");
    }

    for (const { index, result } of validationResults) {
      if (!result.success) {
        validationErrors.push({
          index,
          errors: result.error.flatten(),
        });
      } else {
        const d = result.data;
        const val = d.value !== undefined ? d.value : d.decibels!;
        const timestampInput = d.recordedAt ?? d.timestamp;
        const parsedTimestampMs =
          timestampInput === undefined
            ? nowMs
            : parseTelemetryTimestampMs(timestampInput);

        if (parsedTimestampMs === null) {
          const timestampField =
            d.recordedAt !== undefined ? "recordedAt" : "timestamp";
          validationErrors.push({
            index,
            errors: {
              formErrors: [],
              fieldErrors: {
                [timestampField]: ["Timestamp is invalid"],
              },
            },
          });
          continue;
        }

        const recAt = new Date(
          Math.max(
            earliestAllowedTimestampMs,
            Math.min(latestAllowedTimestampMs, parsedTimestampMs),
          ),
        );
        const sensor =
          d.sensorId || `sensor-${d.venueId}-${d.type || "noise"}-${index}`;

        validRecords.push({
          venueId: d.venueId,
          roomId: d.roomId || "main",
          sensorId: sensor,
          type: d.type || (d.decibels !== undefined ? "noise" : "sensor"),
          value: Number(val),
          recordedAt: recAt,
        });
      }
    }

    if (validationErrors.length > 0) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: validationErrors,
        },
        { status: 400 },
      );
    }

    // 6. Execute Single prisma.venueTelemetry.createMany({ data: [...] }) Batch Call
    let result: { count: number } | null = null;

    if ((prisma as any).venueTelemetry?.createMany) {
      result = await (prisma as any).venueTelemetry.createMany({
        data: validRecords,
        skipDuplicates: true,
      });
    } else if ((prisma as any).noiseReading?.createMany) {
      // Compatibility fallback for legacy noiseReading mock
      result = await (prisma as any).noiseReading.createMany({
        data: validRecords.map((r) => ({
          venueId: r.venueId,
          decibels: r.value,
          peakDecibels: r.value,
          timestamp: r.recordedAt,
        })),
      });
    } else {
      result = await (prisma as any).venueTelemetry.createMany({
        data: validRecords,
        skipDuplicates: true,
      });
    }

    return NextResponse.json(
      {
        success: true,
        count: result?.count ?? validRecords.length,
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
