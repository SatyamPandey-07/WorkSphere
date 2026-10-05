import { Redis } from "@upstash/redis";
import type { PerfSample, PerformanceSummary, FpsTelemetryData } from "../types";

const MAX_SAMPLES = 500;
const SLOW_THRESHOLD_MS = 800;

// ─── In-memory fallback ────────────────────────────────────────────────────────
const memSamples: PerfSample[] = [];
const memRegions = new Map<string, number>();

// ─── Redis setup ───────────────────────────────────────────────────────────────
let cachedRedis: Redis | null = null;

function getRedis(): Redis | null {
  if (cachedRedis) return cachedRedis;

  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null;
  }

  try {
    cachedRedis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
      retry: false,
    });
  } catch {
    // Redis unavailable — fall back to in-memory
  }

  return cachedRedis;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout after ${ms}ms`)),
      ms,
    );
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

// ─── Public: record a single request ──────────────────────────────────────────

export function recordApiLatency(
  route: string,
  durationMs: number,
  region = "unknown",
): void {
  const sample: PerfSample = {
    route,
    durationMs,
    region,
    timestamp: Date.now(),
  };

  // In-memory write (always, best-effort)
  memSamples.push(sample);
  if (memSamples.length > MAX_SAMPLES) memSamples.shift();
  memRegions.set(region, (memRegions.get(region) ?? 0) + 1);

  // Async Redis write (fire-and-forget)
  const redis = getRedis();
  if (!redis) return;

  const serialized = JSON.stringify(sample);
  const pipeline = redis.pipeline();
  pipeline.lpush("worksphere:perf:samples", serialized);
  pipeline.ltrim("worksphere:perf:samples", 0, MAX_SAMPLES - 1);
  pipeline.sadd("worksphere:perf:routes", route);
  pipeline.lpush(`worksphere:perf:route:${route}`, serialized);
  pipeline.ltrim(`worksphere:perf:route:${route}`, 0, 99);
  pipeline.hincrby("worksphere:perf:regions", region, 1);

  withTimeout(pipeline.exec(), 2000).catch((err) => {
    console.error("[performanceTelemetry] Redis write failed:", err);
  });
}

// ─── Stats helpers ────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[idx];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function buildHourlyTrend(
  samples: PerfSample[],
  hours = 24,
): Array<{ hour: string; avgMs: number; p95Ms: number; requestCount: number }> {
  const now = Date.now();
  const buckets = new Map<string, number[]>();

  for (let h = hours - 1; h >= 0; h--) {
    const label = new Date(now - h * 3_600_000).toISOString().slice(0, 13);
    buckets.set(label, []);
  }

  for (const s of samples) {
    const label = new Date(s.timestamp).toISOString().slice(0, 13);
    if (buckets.has(label)) {
      buckets.get(label)!.push(s.durationMs);
    }
  }

  return [...buckets.entries()].map(([hour, durations]) => {
    const sorted = [...durations].sort((a, b) => a - b);
    return {
      hour,
      avgMs: average(sorted),
      p95Ms: Math.round(percentile(sorted, 95)),
      requestCount: sorted.length,
    };
  });
}

function buildSummaryFromSamples(samples: PerfSample[]): PerformanceSummary {
  // Callers hand samples oldest-first (memory) or newest-first (Redis LRANGE
  // after LPUSH). Normalize to newest-first so recentSamples is correct either way.
  const byTimeDesc = [...samples].sort((a, b) => b.timestamp - a.timestamp);
  const allDurations = samples.map((s) => s.durationMs).sort((a, b) => a - b);
  const slowCount = allDurations.filter((d) => d >= SLOW_THRESHOLD_MS).length;

  // Region aggregation
  const regionMap = new Map<string, { total: number; count: number }>();
  for (const s of samples) {
    const r = regionMap.get(s.region) ?? { total: 0, count: 0 };
    r.total += s.durationMs;
    r.count += 1;
    regionMap.set(s.region, r);
  }
  const regionBreakdown = [...regionMap.entries()]
    .map(([region, { total, count }]) => ({
      region,
      count,
      avgMs: Math.round(total / count),
    }))
    .sort((a, b) => b.count - a.count);

  // Route aggregation
  const routeMap = new Map<string, number[]>();
  for (const s of samples) {
    const bucket = routeMap.get(s.route) ?? [];
    bucket.push(s.durationMs);
    routeMap.set(s.route, bucket);
  }
  const routeBreakdown = [...routeMap.entries()]
    .map(([route, durations]) => {
      const sorted = [...durations].sort((a, b) => a - b);
      return {
        route,
        avgMs: average(sorted),
        p95Ms: Math.round(percentile(sorted, 95)),
        requestCount: sorted.length,
      };
    })
    .sort((a, b) => b.p95Ms - a.p95Ms);

  return {
    generatedAt: new Date().toISOString(),
    overview: {
      totalRequests: samples.length,
      slowRequests: slowCount,
      avgMs: average(allDurations),
      p95Ms: Math.round(percentile(allDurations, 95)),
      slowThresholdMs: SLOW_THRESHOLD_MS,
    },
    latencyTrend: buildHourlyTrend(samples),
    recentSamples: byTimeDesc.slice(0, 50),
    regionBreakdown,
    routeBreakdown,
  };
}

export async function getPerformanceSummary(): Promise<PerformanceSummary> {
  const redis = getRedis();

  if (redis) {
    try {
      const raw = (await withTimeout(
        redis.lrange("worksphere:perf:samples", 0, MAX_SAMPLES - 1),
        2000,
      )) as string[];

      if (raw && raw.length > 0) {
        const samples: PerfSample[] = raw
          .map((s) => {
            try {
              return typeof s === "string" ? (JSON.parse(s) as PerfSample) : s;
            } catch {
              return null;
            }
          })
          .filter((s): s is PerfSample => s !== null);

        return buildSummaryFromSamples(samples);
      }
    } catch (err) {
      console.error(
        "[performanceTelemetry] Redis read failed, falling back to in-memory:",
        err,
      );
    }
  }

  // Fallback: use in-memory samples
  if (memSamples.length === 0) {
    const now = Date.now();
    const seedRoutes = [
      { route: "/api/venues", durationMs: 142, region: "local" },
      { route: "/api/chat", durationMs: 285, region: "local" },
      { route: "/api/admin/system", durationMs: 95, region: "local" },
      { route: "/admin/performance", durationMs: 48, region: "local" },
      { route: "prisma:Venue", durationMs: 18, region: "local" },
      { route: "prisma:Booking", durationMs: 32, region: "local" },
    ];
    for (const r of seedRoutes) {
      memSamples.push({
        ...r,
        timestamp: now - Math.floor(Math.random() * 3600000),
      });
    }
  }

  return buildSummaryFromSamples([...memSamples]);
}

export function logFpsTelemetry(data: FpsTelemetryData) {
  if (process.env.NODE_ENV === "development") {
    console.debug(
      `[Telemetry] FPS: ${data.fps.toFixed(1)} | Frame Time: ${data.frameTimeMs.toFixed(2)}ms | Steps: ${data.raymarchSteps}`,
    );
  }

  if (typeof window !== "undefined" && (window as any).WorkSphereTelemetry) {
    (window as any).WorkSphereTelemetry.track(
      "cloud_renderer_performance",
      data,
    );
  }
}
