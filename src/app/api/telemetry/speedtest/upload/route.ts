/**
 * route.ts
 * POST /api/telemetry/speedtest/upload
 * Low-overhead sink endpoint for measuring client-to-server upload bandwidth.
 */

import { NextRequest, NextResponse } from "next/server";
import { getClientIp, getRateLimitInfo, rateLimit } from "@/lib/rateLimit";

/**
 * Normal client benchmark upload in `src/lib/wifi/speedBenchmarkEngine.ts`
 * sends 1.5 MiB (1,572,864 bytes). 2 MiB leaves comfortable headroom while
 * preventing unbounded memory/bandwidth exhaustion.
 */
export const DEFAULT_MAX_SPEEDTEST_UPLOAD_BYTES = 2 * 1024 * 1024;
export const SPEEDTEST_UPLOAD_RATE_LIMIT = 15;
export const SPEEDTEST_UPLOAD_WINDOW_MS = 60_000;

export function getMaxSpeedtestUploadBytes(): number {
  const raw = process.env.SPEEDTEST_MAX_UPLOAD_BYTES?.trim();
  if (!raw) {
    return DEFAULT_MAX_SPEEDTEST_UPLOAD_BYTES;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return DEFAULT_MAX_SPEEDTEST_UPLOAD_BYTES;
  }
  return parsed;
}

class PayloadTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Upload payload exceeds maximum allowed size of ${maxBytes} bytes`);
    this.name = "PayloadTooLargeError";
  }
}

async function countStreamedBytesBounded(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<number> {
  const reader = body.getReader();
  let bytesReceived = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      bytesReceived += value.byteLength;
      if (bytesReceived > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new PayloadTooLargeError(maxBytes);
      }
    }
    return bytesReceived;
  } finally {
    reader.releaseLock();
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rlKey = `speedtest-upload:${ip}`;
    const allowed = await rateLimit(
      rlKey,
      SPEEDTEST_UPLOAD_RATE_LIMIT,
      SPEEDTEST_UPLOAD_WINDOW_MS,
    );

    if (!allowed) {
      const info = await getRateLimitInfo(
        rlKey,
        SPEEDTEST_UPLOAD_RATE_LIMIT,
        SPEEDTEST_UPLOAD_WINDOW_MS,
      );
      const retryAfter = info?.resetTime
        ? Math.max(1, Math.ceil((info.resetTime - Date.now()) / 1000))
        : 60;
      return NextResponse.json(
        {
          error: "Too many speedtest upload requests. Please try again later.",
          retryAfter,
        },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    const maxBytes = getMaxSpeedtestUploadBytes();
    const rawContentLength = req.headers.get("content-length");

    if (rawContentLength !== null) {
      const trimmed = rawContentLength.trim();
      if (!/^\d+$/.test(trimmed)) {
        return NextResponse.json(
          { error: "Invalid Content-Length header" },
          { status: 400 },
        );
      }
      const declaredBytes = Number(trimmed);
      if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
        return NextResponse.json(
          {
            error: `Payload Too Large: maximum allowed upload size is ${maxBytes} bytes`,
            maxBytes,
          },
          { status: 413 },
        );
      }
    }

    const bytesReceived = req.body
      ? await countStreamedBytesBounded(req.body, maxBytes)
      : 0;

    return NextResponse.json({
      success: true,
      bytesReceived,
      receivedAt: Date.now(),
    });
  } catch (error: unknown) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json(
        {
          error: `Payload Too Large: maximum allowed upload size is ${error.maxBytes} bytes`,
          maxBytes: error.maxBytes,
        },
        { status: 413 },
      );
    }

    return NextResponse.json(
      { error: "Upload measurement error" },
      { status: 500 },
    );
  }
}
