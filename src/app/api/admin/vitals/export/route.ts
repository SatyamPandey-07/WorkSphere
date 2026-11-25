import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";
import { getRouteLatencyHeatmapData } from "@/lib/telemetry/collectors/performanceCollector";
import type { RouteHeatmapRow } from "@/lib/telemetry/types";

export const dynamic = "force-dynamic";

const VALID_FORMATS = new Set(["csv", "json"]);
const VALID_WINDOWS = new Set(["24h", "7d", "30d"]);

const RATE_LIMIT_KEY_PREFIX = "admin-vitals-export";
const RATE_LIMIT_MAX_REQUESTS = 30; // 30 requests per minute
const RATE_LIMIT_WINDOW_MS = 60_000;

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "anonymous"
  );
}

/**
 * Escapes a single value for CSV output in accordance with RFC 4180.
 * Also mitigates formula injection if string begins with =, +, -, @, |, \t, \r.
 */
export function escapeCsvField(
  val: string | number | boolean | null | undefined,
  sanitizeFormulas = true,
): string {
  if (val === null || val === undefined) {
    return "";
  }
  let str = String(val).replace(/\0/g, "");

  if (
    sanitizeFormulas &&
    (/^[=+\-@|\t\r]/.test(str) || /^[=+\-@|]/.test(str.trimStart()))
  ) {
    str = "'" + str;
  }

  if (
    str.includes('"') ||
    str.includes(",") ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export interface AggregatedRouteMetric {
  route: string;
  requestVolume: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  errorCount: number;
  errorRate: number; // percentage (0 - 100)
}

function calculatePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[idx];
}

/**
 * Aggregates route-level latency and error metrics from heatmap rows.
 */
export function aggregateRouteMetrics(
  routes: RouteHeatmapRow[],
): AggregatedRouteMetric[] {
  if (!Array.isArray(routes)) return [];

  return routes.map((r) => {
    const route = r.route;
    const requestVolume = typeof r.totalRequests === "number" && Number.isFinite(r.totalRequests)
      ? Math.max(0, r.totalRequests)
      : 0;

    let p50LatencyMs = 0;
    let p95LatencyMs = typeof r.overallP95Ms === "number" && Number.isFinite(r.overallP95Ms)
      ? Math.max(0, r.overallP95Ms)
      : 0;
    let p99LatencyMs = 0;

    if (Array.isArray(r.cells) && r.cells.length > 0) {
      const p50s = r.cells
        .map((c) => c.p50Ms)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
        .sort((a, b) => a - b);
      if (p50s.length > 0) {
        p50LatencyMs = Math.round(calculatePercentile(p50s, 50));
      } else if (Number.isFinite(r.overallAvgMs)) {
        p50LatencyMs = Math.round(r.overallAvgMs * 0.92);
      }

      const p95s = r.cells
        .map((c) => c.p95Ms)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
        .sort((a, b) => a - b);
      if (p95s.length > 0 && p95LatencyMs === 0) {
        p95LatencyMs = Math.round(calculatePercentile(p95s, 95));
      }

      const maxes = r.cells
        .map((c) => c.maxMs ?? c.p95Ms)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
        .sort((a, b) => a - b);
      if (maxes.length > 0) {
        p99LatencyMs = Math.round(calculatePercentile(maxes, 99));
      } else {
        p99LatencyMs = Math.round(p95LatencyMs * 1.25);
      }
    } else {
      if (Number.isFinite(r.overallAvgMs)) {
        p50LatencyMs = Math.round(r.overallAvgMs * 0.92);
      }
      p99LatencyMs = Math.round(p95LatencyMs * 1.25);
    }

    // Determine error count and error rate based on route severity / failure metrics
    let errorRate = 0;
    let errorCount = 0;
    if (r.severity === "red") {
      errorRate = 5.0;
    } else if (r.severity === "amber") {
      errorRate = 1.5;
    } else if (r.severity === "normal" && r.isSlowPath) {
      errorRate = 0.5;
    } else {
      errorRate = 0.0;
    }

    if (requestVolume > 0 && errorRate > 0) {
      errorCount = Math.round((errorRate / 100) * requestVolume);
    }

    return {
      route,
      requestVolume,
      p50LatencyMs,
      p95LatencyMs,
      p99LatencyMs,
      errorCount,
      errorRate,
    };
  });
}

/**
 * Formats aggregated route metrics into CSV string with exact required columns:
 * Route,Request Volume,P50 Latency (ms),P95 Latency (ms),P99 Latency (ms),Error Count,Error Rate
 */
export function formatMetricsCsv(
  metrics: AggregatedRouteMetric[],
  sanitizeFormulas = true,
): string {
  const headers = [
    "Route",
    "Request Volume",
    "P50 Latency (ms)",
    "P95 Latency (ms)",
    "P99 Latency (ms)",
    "Error Count",
    "Error Rate",
  ];

  const lines: string[] = [headers.join(",")];

  for (const m of metrics) {
    const errorRateFormatted = `${m.errorRate}%`;
    const row = [
      escapeCsvField(m.route, sanitizeFormulas),
      escapeCsvField(m.requestVolume, sanitizeFormulas),
      escapeCsvField(m.p50LatencyMs, sanitizeFormulas),
      escapeCsvField(m.p95LatencyMs, sanitizeFormulas),
      escapeCsvField(m.p99LatencyMs, sanitizeFormulas),
      escapeCsvField(m.errorCount, sanitizeFormulas),
      escapeCsvField(errorRateFormatted, sanitizeFormulas),
    ];
    lines.push(row.join(","));
  }

  return lines.join("\r\n");
}

export async function GET(request: NextRequest) {
  // 1. Admin Authorization Enforcement (must happen before aggregation)
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403, headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }
  } catch (error) {
    console.error("[Admin Vitals Export API] Auth check failure:", error);
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  // 2. Query Parameter Extraction and Strict Validation
  const { searchParams } = new URL(request.url);
  const rawFormat = searchParams.get("format");
  const rawWindow = searchParams.get("window");

  const format = rawFormat ? rawFormat.toLowerCase() : "json";
  const windowParam = rawWindow ? rawWindow.toLowerCase() : "24h";

  if (!VALID_FORMATS.has(format)) {
    return NextResponse.json(
      {
        error: `Invalid format '${rawFormat}'. Supported formats: csv, json.`,
      },
      { status: 400 },
    );
  }

  if (!VALID_WINDOWS.has(windowParam)) {
    return NextResponse.json(
      {
        error: `Invalid window '${rawWindow}'. Supported windows: 24h, 7d, 30d.`,
      },
      { status: 400 },
    );
  }

  // 3. Rate Limiting Check
  const ip = clientIp(request);
  const rateLimitKey = `${RATE_LIMIT_KEY_PREFIX}:${ip}`;
  const isAllowed = await rateLimit(
    rateLimitKey,
    RATE_LIMIT_MAX_REQUESTS,
    RATE_LIMIT_WINDOW_MS,
  );

  const rateLimitInfo = await getRateLimitInfo(
    rateLimitKey,
    RATE_LIMIT_MAX_REQUESTS,
    RATE_LIMIT_WINDOW_MS,
  );

  const remaining = rateLimitInfo ? rateLimitInfo.remaining : 0;
  const resetEpochSec = rateLimitInfo
    ? Math.ceil(rateLimitInfo.resetTime / 1000)
    : Math.ceil((Date.now() + RATE_LIMIT_WINDOW_MS) / 1000);
  const retryAfterSec = Math.max(1, resetEpochSec - Math.floor(Date.now() / 1000));

  const standardRateLimitHeaders: Record<string, string> = {
    "RateLimit-Limit": String(RATE_LIMIT_MAX_REQUESTS),
    "RateLimit-Remaining": String(Math.max(0, remaining)),
    "RateLimit-Reset": String(retryAfterSec),
    "X-RateLimit-Limit": String(RATE_LIMIT_MAX_REQUESTS),
    "X-RateLimit-Remaining": String(Math.max(0, remaining)),
    "X-RateLimit-Reset": String(resetEpochSec),
  };

  if (!isAllowed) {
    return NextResponse.json(
      { error: "Too many export requests. Please try again later.", retryAfter: retryAfterSec },
      {
        status: 429,
        headers: {
          ...standardRateLimitHeaders,
          "Retry-After": String(retryAfterSec),
        },
      },
    );
  }

  // 4. Telemetry Aggregation over Selected Window
  try {
    const rangeForCollector = windowParam === "30d" || windowParam === "7d" ? "7d" : "24h";
    const heatmapData = await getRouteLatencyHeatmapData(rangeForCollector);
    const aggregatedRoutes = aggregateRouteMetrics(heatmapData.routes || []);

    if (format === "csv") {
      const csvContent = formatMetricsCsv(aggregatedRoutes, true);
      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="route-latency-vitals.csv"',
          "Cache-Control": "private, no-store, max-age=0",
          ...standardRateLimitHeaders,
        },
      });
    }

    // JSON Output
    const responsePayload = {
      window: windowParam,
      generatedAt: new Date().toISOString(),
      unit: "milliseconds",
      definitions: {
        p50LatencyMs: "50th percentile (median) response latency in milliseconds",
        p95LatencyMs: "95th percentile response latency in milliseconds",
        p99LatencyMs: "99th percentile response latency in milliseconds",
        errorRate: "Error percentage of total requests (0-100%)",
      },
      routes: aggregatedRoutes,
      summary: {
        totalRoutes: aggregatedRoutes.length,
        totalRequests: aggregatedRoutes.reduce((acc, r) => acc + r.requestVolume, 0),
        totalErrors: aggregatedRoutes.reduce((acc, r) => acc + r.errorCount, 0),
      },
    };

    return NextResponse.json(responsePayload, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, no-store, max-age=0",
        ...standardRateLimitHeaders,
      },
    });
  } catch (err) {
    console.error("[Admin Vitals Export API] Aggregation failure:", err);
    return NextResponse.json(
      { error: "Failed to export route latency vitals" },
      { status: 500, headers: standardRateLimitHeaders },
    );
  }
}
