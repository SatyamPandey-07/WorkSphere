import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import {
  PROMETHEUS_CONTENT_TYPE,
  renderWsMetrics,
} from "@/lib/telemetry/wsMetrics";

export const dynamic = "force-dynamic";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * The scraper must send `Authorization: Bearer <TELEMETRY_METRICS_TOKEN>`.
 * With no token configured the endpoint stays closed.
 */
export function isAuthorizedScrape(req: NextRequest): boolean {
  const configuredToken = process.env.TELEMETRY_METRICS_TOKEN;
  if (!configuredToken) return false;

  const match = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!match) return false;

  // Hashing first gives both buffers the same length for timingSafeEqual.
  return timingSafeEqual(sha256(match[1].trim()), sha256(configuredToken));
}

/**
 * GET /api/metrics/telemetry
 * Telemetry WebSocket metrics in the Prometheus text exposition format.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedScrape(req)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }

  return new NextResponse(renderWsMetrics(), {
    status: 200,
    headers: {
      "Content-Type": PROMETHEUS_CONTENT_TYPE,
      "Cache-Control": "no-store",
    },
  });
}
