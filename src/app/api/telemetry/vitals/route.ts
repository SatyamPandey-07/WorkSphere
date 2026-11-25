import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { trackEvent } from "@/lib/analytics";
import {
  checkTokenBucketRateLimit,
  getClientIp,
  RATE_TIERS,
} from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const MAX_VITALS_BODY_BYTES = 2048;

const navigationTypes = [
  "navigate",
  "reload",
  "back-forward",
  "back-forward-cache",
  "prerender",
  "restore",
  "soft-navigation",
  "unknown",
] as const;

export const webVitalsPayloadSchema = z
  .object({
    name: z.enum(["CLS", "INP", "LCP", "FCP", "TTFB"]),
    value: z.number().finite().min(0).max(1_000_000_000),
    rating: z.enum(["good", "needs-improvement", "poor"]),
    navigationType: z.enum(navigationTypes),
    deviceType: z.enum(["mobile", "tablet", "desktop", "unknown"]),
    metricId: z.string().min(1).max(128).optional(),
    timestamp: z.number().int().positive(),
  })
  .strict();

async function readBoundedBody(request: NextRequest): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_VITALS_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function POST(request: NextRequest) {
  try {
    const rateLimit = await checkTokenBucketRateLimit(
      RATE_TIERS.telemetry,
      getClientIp(request),
    );
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: "Too many telemetry requests" },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfter) },
        },
      );
    }

    const contentType = request.headers
      .get("content-type")
      ?.split(";")[0]
      .trim()
      .toLowerCase();
    if (contentType !== "application/json") {
      return NextResponse.json(
        { error: "Content-Type must be application/json" },
        { status: 415 },
      );
    }

    const contentLength = Number(request.headers.get("content-length"));
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_VITALS_BODY_BYTES
    ) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    let rawBody: string | null;
    try {
      rawBody = await readBoundedBody(request);
    } catch {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }
    if (rawBody === null) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON payload" },
        { status: 400 },
      );
    }

    const parsed = webVitalsPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid Web Vitals payload",
          details: parsed.error.issues.map(({ path, code }) => ({
            path,
            code,
          })),
        },
        { status: 400 },
      );
    }

    const { metricId, ...metric } = parsed.data;
    trackEvent("web_vital_reported", {
      ...metric,
      ...(metricId ? { metricId } : {}),
    });

    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (error) {
    console.error("[telemetry/vitals] Request processing failed:", error);
    return NextResponse.json(
      { error: "Unable to accept Web Vitals telemetry" },
      { status: 500 },
    );
  }
}
