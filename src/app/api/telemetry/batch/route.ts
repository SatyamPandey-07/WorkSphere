import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { rateLimit, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Validation bounds and helper utilities for telemetry batch processing (#10460).
 *
 * Why bounds checks must happen before Date conversion:
 * 1. JavaScript's `new Date(value)` is forgiving and unsafe with arbitrary inputs:
 *    - `new Date(NaN)`, `new Date(Infinity)`, or `new Date("invalid")` produce `Invalid Date` objects
 *      where `getTime()` returns `NaN`, poisoning database queries, serialization, and temporal comparisons.
 *    - Extreme numeric values (e.g. > 1e15 or negative numbers beyond supported epoch) can cause integer
 *      overflow or database timestamp out-of-range driver exceptions during batch insertion.
 *    - Non-primitive objects, nested arrays, or symbols passed to `Date` can cause runtime exceptions
 *      or prototype-pollution side effects.
 * 2. Evaluating array structure and batch size BEFORE iterating or converting dates protects the server
 *    from unbounded memory allocations, CPU exhaustion (DoS via huge arrays), and partial batch processing.
 * 3. Pre-validating every timestamp's type, presence, finiteness, and reasonable epoch boundaries
 *    (e.g., between year 2000 and 2100) ensures fail-fast rejection before any Date allocation occurs.
 */

export const MAX_TELEMETRY_BATCH_SIZE = 100;
export const MIN_TELEMETRY_BATCH_SIZE = 1;

/** Supported timestamp epoch range: 2000-01-01T00:00:00.000Z to 2100-01-01T00:00:00.000Z */
export const MIN_TIMESTAMP_MS = 946684800000; // 2000-01-01 UTC
export const MAX_TIMESTAMP_MS = 4102444800000; // 2100-01-01 UTC

/**
 * Validates whether a raw timestamp value is well-formed, finite, and within supported epoch bounds
 * BEFORE passing it to `new Date()`.
 *
 * Supported formats:
 * - Finite number: unix epoch in milliseconds or seconds (if seconds, converted)
 * - ISO-8601 or parseable date string that produces a valid finite time
 * - Date object with finite time
 */
export function isValidTimestampValue(val: unknown): { valid: boolean; date?: Date; error?: string } {
  if (val === undefined || val === null) {
    return { valid: true }; // optional field
  }

  // Reject boolean, symbol, function, or plain non-date objects
  if (typeof val === "boolean" || typeof val === "symbol" || typeof val === "function") {
    return { valid: false, error: "Timestamp cannot be a boolean, symbol, or function" };
  }

  let epochMs: number;

  if (typeof val === "number") {
    if (!Number.isFinite(val) || Number.isNaN(val)) {
      return { valid: false, error: "Numeric timestamp must be a finite number" };
    }
    // Handle seconds vs milliseconds epoch (seconds if < 1e11)
    epochMs = val < 100000000000 ? val * 1000 : val;
  } else if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) {
      return { valid: false, error: "Timestamp string cannot be empty or whitespace" };
    }
    // Reject strings that are just "NaN", "Infinity", etc.
    if (trimmed.toLowerCase() === "nan" || trimmed.toLowerCase().includes("infinity")) {
      return { valid: false, error: "Timestamp string is not a valid date" };
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
      return { valid: false, error: "Timestamp string is not parseable as a valid date" };
    }
    epochMs = parsed;
  } else if (val instanceof Date) {
    const t = val.getTime();
    if (!Number.isFinite(t) || Number.isNaN(t)) {
      return { valid: false, error: "Date object contains Invalid Date" };
    }
    epochMs = t;
  } else {
    return { valid: false, error: "Timestamp must be a number, string, or Date" };
  }

  if (epochMs < MIN_TIMESTAMP_MS || epochMs > MAX_TIMESTAMP_MS) {
    return {
      valid: false,
      error: `Timestamp out of supported range (2000-2100). Received epoch: ${epochMs}`,
    };
  }

  return { valid: true, date: new Date(epochMs) };
}

const timestampValidationRefinement = (val: unknown) => {
  if (val === undefined || val === null) return true;
  return isValidTimestampValue(val).valid;
};

export const telemetryReadingSchema = z
  .object({
    venueId: z.string().min(1, "venueId is required"),
    roomId: z.string().min(1).optional(),
    sensorId: z.string().min(1).optional(),
    type: z.string().min(1).optional(),
    value: z.number().refine((n) => Number.isFinite(n), "value must be a finite number").optional(),
    decibels: z.number().refine((n) => Number.isFinite(n) && n >= 0, "decibels must be a non-negative finite number").optional(),
    peakDecibels: z.number().refine((n) => Number.isFinite(n) && n >= 0, "peakDecibels must be a non-negative finite number").optional(),
    timestamp: z
      .union([
        z.number().refine((n) => Number.isFinite(n), "timestamp must be a finite number"),
        z.string().min(1, "timestamp string cannot be empty"),
        z.date(),
      ])
      .refine(timestampValidationRefinement, {
        message: "timestamp must be a valid, finite date within supported range (2000-2100)",
      })
      .optional(),
    recordedAt: z
      .union([
        z.number().refine((n) => Number.isFinite(n), "recordedAt must be a finite number"),
        z.string().min(1, "recordedAt string cannot be empty"),
        z.date(),
      ])
      .refine(timestampValidationRefinement, {
        message: "recordedAt must be a valid, finite date within supported range (2000-2100)",
      })
      .optional(),
    timestamp: telemetryTimestampSchema.optional(),
    recordedAt: telemetryTimestampSchema.optional(),
  })
  .refine((data) => data.value !== undefined || data.decibels !== undefined, {
    message: "Either value or decibels must be specified",
  });

export const telemetryBatchSchema = z
  .array(telemetryReadingSchema)
  .min(MIN_TELEMETRY_BATCH_SIZE, "readings array cannot be empty")
  .max(MAX_TELEMETRY_BATCH_SIZE, "readings array cannot exceed 100 items");

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
 * Validates gateway API token authentication. Fails closed.
 *
 * The expected token is the first non-empty of `GATEWAY_API_TOKEN`,
 * `TELEMETRY_GATEWAY_TOKEN`, `WORKER_SECRET`. The caller's token is read from
 * `Authorization: Bearer`, then `x-gateway-token`, then `x-api-key`.
 *
 * - Token configured: the caller must send a matching token (constant-time
 *   comparison after a length check). Missing or wrong returns `false`.
 * - No token configured, `NODE_ENV=production`: always `false`.
 * - No token configured, any other env: `false` if the caller sent a token
 *   (it is never accepted without a configured secret). With no token sent,
 *   returns `true` only for `NODE_ENV=development` or `test`.
 *
 * See docs/api/TELEMETRY_GATEWAY_AUTH.md for the full decision table.
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

  // When no gateway token is configured:
  // In production, always fail closed
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  // In non-production, if a token was provided, it must not be accepted blindly without configured credentials
  if (provided !== null && provided !== undefined) {
    return false;
  }

  // Explicit non-production bypass only in development or test when no token headers were sent
  return (
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
  );
}

/**
 * POST /api/telemetry/batch
 * Bulk telemetry ingestion pipeline with batch insert transactions,
 * parallel Zod validation, gateway API token authentication, and IP rate limiting.
 *
 * Authentication is fail-closed and runs before rate limiting, body parsing
 * and any database access:
 * - `503` when no gateway secret is configured and `NODE_ENV=production`.
 * - `401` when the token is missing or wrong, or when a token is sent but no
 *   secret is configured.
 *
 * See docs/api/TELEMETRY_GATEWAY_AUTH.md before changing this order.
 */
export async function POST(req: NextRequest) {
  try {
    const configuredToken =
      process.env.GATEWAY_API_TOKEN ||
      process.env.TELEMETRY_GATEWAY_TOKEN ||
      process.env.WORKER_SECRET;

    if (!configuredToken && process.env.NODE_ENV === "production") {
      return NextResponse.json(
        {
          error:
            "Service Unavailable: Telemetry gateway credentials not configured",
        },
        { status: 503 },
      );
    }

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
        {
          error: "Validation failed",
          details: "readings array cannot be empty",
        },
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

    for (const { index, result } of validationResults) {
      if (!result.success) {
        validationErrors.push({
          index,
          errors: result.error.flatten(),
        });
      } else {
        const d = result.data;
        const val = d.value !== undefined ? d.value : d.decibels!;
        const dateResult = d.recordedAt !== undefined
          ? isValidTimestampValue(d.recordedAt)
          : d.timestamp !== undefined
            ? isValidTimestampValue(d.timestamp)
            : { valid: true, date: new Date() };

        const recAt = dateResult.date || new Date();
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
