import { Redis } from "@upstash/redis";

/**
 * Lightweight DB query latency telemetry.
 *
 * We deliberately do NOT log every query into the main analytics event
 * stream (src/lib/analytics.ts) — that would flood Redis/memory with one
 * event per Prisma call. Instead we keep a small rolling window of recent
 * query durations (per model) and expose aggregate stats (avg / p95 / slow-query count)
 * for the admin dashboard.
 *
 * Production: Upstash Redis provides durable distributed counters/events.
 * Development: an in-memory fallback keeps local analytics functional without Redis.
 */

const MAX_SAMPLES_PER_MODEL = 200;
const SLOW_QUERY_THRESHOLD_MS = 200;

type QuerySample = { durationMs: number; timestamp: number };

// ─── In-memory fallback (development / no Redis) ─────────────────────────────
const samplesByModel = new Map<string, QuerySample[]>();
let slowQueryCount = 0;
let totalQueryCount = 0;

// ─── Redis Setup ─────────────────────────────────────────────────────────────
let cachedRedis: Redis | null = null;
let nextServerAfter: typeof import("next/server").after | null = null;

if (typeof window === "undefined") {
  import("next/server")
    .then(({ after }) => {
      nextServerAfter = after;
    })
    .catch(() => {
      // Ignored: outside of Next.js server environment
    });
}

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
      retry: false, // Disable automatic retries for telemetry writes
    });
  } catch (error) {
    console.error("[dbTelemetry] Redis initialization failed:", error);
  }

  return cachedRedis;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function recordQueryDuration(model: string, durationMs: number) {
  // Always update local in-memory values as fallback/best-effort
  totalQueryCount += 1;
  if (durationMs >= SLOW_QUERY_THRESHOLD_MS) slowQueryCount += 1;

  const key = model || "unknown";
  const samples = samplesByModel.get(key) ?? [];
  const sample = { durationMs, timestamp: Date.now() };
  samples.push(sample);

  if (samples.length > MAX_SAMPLES_PER_MODEL) {
    samples.shift();
  }

  samplesByModel.set(key, samples);

  // Write to Upstash Redis asynchronously if configured
  const redis = getRedis();
  if (redis) {
    const pipeline = redis.pipeline();
    const globalKey = "worksphere:telemetry:global";
    const modelsKey = "worksphere:telemetry:models";
    const samplesKey = `worksphere:telemetry:samples:${key}`;

    pipeline.hincrby(globalKey, "totalQueryCount", 1);
    if (durationMs >= SLOW_QUERY_THRESHOLD_MS) {
      pipeline.hincrby(globalKey, "slowQueryCount", 1);
    }
    pipeline.sadd(modelsKey, key);
    pipeline.lpush(samplesKey, JSON.stringify(sample));
    pipeline.ltrim(samplesKey, 0, MAX_SAMPLES_PER_MODEL - 1);

    const promise = pipeline
      .exec({ signal: AbortSignal.timeout(2000) })
      .catch((error) => {
        console.error("[dbTelemetry] Redis write failed:", error);
      });

    // Request lifecycle integration for Next.js 15+ serverless environments
    if (nextServerAfter) {
      try {
        nextServerAfter(() => promise);
      } catch {
        // Ignored: outside of request context
      }
    }
  }
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[index];
}

function getDbLatencyStatsSync() {
  const allDurations: number[] = [];
  const byModel: Array<{
    model: string;
    avgMs: number;
    p95Ms: number;
    sampleCount: number;
  }> = [];

  for (const [model, samples] of samplesByModel.entries()) {
    const durations = samples.map((s) => s.durationMs).sort((a, b) => a - b);
    allDurations.push(...durations);

    byModel.push({
      model,
      avgMs: Math.round(
        durations.reduce((sum, d) => sum + d, 0) / (durations.length || 1),
      ),
      p95Ms: Math.round(percentile(durations, 95)),
      sampleCount: durations.length,
    });
  }

  allDurations.sort((a, b) => a - b);

  return {
    totalQueryCount,
    slowQueryCount,
    slowQueryThresholdMs: SLOW_QUERY_THRESHOLD_MS,
    avgMs: Math.round(
      allDurations.reduce((sum, d) => sum + d, 0) / (allDurations.length || 1),
    ),
    p95Ms: Math.round(percentile(allDurations, 95)),
    byModel: byModel.sort((a, b) => b.avgMs - a.avgMs),
  };
}

export async function getDbLatencyStats() {
  const redis = getRedis();

  if (redis) {
    try {
      const globalKey = "worksphere:telemetry:global";
      const modelsKey = "worksphere:telemetry:models";

      const timeoutSignal = AbortSignal.timeout(1500);

      const [globalStats, models] = await Promise.all([
        redis.hgetall(globalKey, { signal: timeoutSignal }) as Promise<Record<
          string,
          string | number
        > | null>,
        redis.smembers(modelsKey, { signal: timeoutSignal }) as Promise<
          string[]
        >,
      ]);

      const redisTotalQueryCount = globalStats
        ? Number(globalStats.totalQueryCount || 0)
        : 0;
      const redisSlowQueryCount = globalStats
        ? Number(globalStats.slowQueryCount || 0)
        : 0;

      const byModel: Array<{
        model: string;
        avgMs: number;
        p95Ms: number;
        sampleCount: number;
      }> = [];
      const allDurations: number[] = [];

      if (models && models.length > 0) {
        const pipeline = redis.pipeline();
        for (const model of models) {
          pipeline.lrange(`worksphere:telemetry:samples:${model}`, 0, -1);
        }
        const samplesListsRaw = await pipeline.exec({ signal: timeoutSignal });

        for (let i = 0; i < models.length; i++) {
          const model = models[i];
          const rawSamples = samplesListsRaw[i] as any[];
          if (!rawSamples || rawSamples.length === 0) continue;

          const durations = rawSamples
            .map((s) => {
              try {
                const parsed = typeof s === "string" ? JSON.parse(s) : s;
                return typeof parsed?.durationMs === "number"
                  ? parsed.durationMs
                  : null;
              } catch {
                return null;
              }
            })
            .filter((d): d is number => d !== null)
            .sort((a, b) => a - b);

          if (durations.length === 0) continue;

          allDurations.push(...durations);

          byModel.push({
            model,
            avgMs: Math.round(
              durations.reduce((sum, d) => sum + d, 0) / durations.length,
            ),
            p95Ms: Math.round(percentile(durations, 95)),
            sampleCount: durations.length,
          });
        }
      }

      allDurations.sort((a, b) => a - b);

      return {
        totalQueryCount: redisTotalQueryCount,
        slowQueryCount: redisSlowQueryCount,
        slowQueryThresholdMs: SLOW_QUERY_THRESHOLD_MS,
        avgMs: Math.round(
          allDurations.reduce((sum, d) => sum + d, 0) /
            (allDurations.length || 1),
        ),
        p95Ms: Math.round(percentile(allDurations, 95)),
        byModel: byModel.sort((a, b) => b.avgMs - a.avgMs),
      };
    } catch (error) {
      console.error(
        "[dbTelemetry] Redis read failed, falling back to in-memory:",
        error,
      );
    }
  }

  return getDbLatencyStatsSync();
}
