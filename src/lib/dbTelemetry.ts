import { getRedis } from "@/lib/redis";

/**
 * Lightweight DB query latency telemetry.
 *
 * Queries are buffered in memory and flushed to Redis in batches every 5
 * seconds. This avoids firing a Redis pipeline on every single Prisma call,
 * which would otherwise exhaust the connection pool under high traffic.
 */

const MAX_SAMPLES_PER_MODEL = 200;
const SLOW_QUERY_THRESHOLD_MS = 200;
const FLUSH_INTERVAL_MS = 5_000;

type QuerySample = { durationMs: number; timestamp: number };

// ─── In-memory state ─────────────────────────────────────────────────────────
const samplesByModel = new Map<string, QuerySample[]>();
let slowQueryCount = 0;
let totalQueryCount = 0;

// Buffer for pending writes to Redis
let pendingGlobalTotal = 0;
let pendingGlobalSlow = 0;
const pendingSamplesByModel = new Map<string, QuerySample[]>();
const pendingNewModels = new Set<string>();
let flushTimer: ReturnType<typeof setInterval> | null = null;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// ─── Batch flush ─────────────────────────────────────────────────────────────

async function flushBuffer(): Promise<void> {
  if (pendingGlobalTotal === 0 && pendingSamplesByModel.size === 0) return;

  const redis = getRedis();
  if (!redis) {
    pendingGlobalTotal = 0;
    pendingGlobalSlow = 0;
    pendingSamplesByModel.clear();
    pendingNewModels.clear();
    return;
  }

  const globalTotal = pendingGlobalTotal;
  const globalSlow = pendingGlobalSlow;
  const samplesSnapshot = new Map(pendingSamplesByModel);
  const newModelsSnapshot = new Set(pendingNewModels);

  pendingGlobalTotal = 0;
  pendingGlobalSlow = 0;
  pendingSamplesByModel.clear();
  pendingNewModels.clear();

  try {
    const pipeline = redis.pipeline();
    const globalKey = "worksphere:telemetry:global";
    const modelsKey = "worksphere:telemetry:models";

    if (globalTotal > 0) {
      pipeline.hincrby(globalKey, "totalQueryCount", globalTotal);
    }
    if (globalSlow > 0) {
      pipeline.hincrby(globalKey, "slowQueryCount", globalSlow);
    }

    for (const model of newModelsSnapshot) {
      pipeline.sadd(modelsKey, model);
    }

    for (const [model, samples] of samplesSnapshot) {
      const samplesKey = `worksphere:telemetry:samples:${model}`;
      for (const sample of samples) {
        pipeline.lpush(samplesKey, JSON.stringify(sample));
      }
      pipeline.ltrim(samplesKey, 0, MAX_SAMPLES_PER_MODEL - 1);
    }

    await withTimeout(pipeline.exec(), 3000);
  } catch (error) {
    console.error("[dbTelemetry] Redis batch flush failed:", error);
  }
}

function startFlusher(): void {
  if (flushTimer) return;
  if (typeof window !== "undefined") return;

  flushTimer = setInterval(() => {
    flushBuffer().catch((error) => {
      console.error("[dbTelemetry] Unhandled flush error:", error);
    });
  }, FLUSH_INTERVAL_MS);

  if (flushTimer.unref) {
    flushTimer.unref();
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function recordQueryDuration(model: string, durationMs: number) {
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

  // Buffer writes for periodic Redis flush
  pendingGlobalTotal += 1;
  if (durationMs >= SLOW_QUERY_THRESHOLD_MS) {
    pendingGlobalSlow += 1;
  }

  if (!pendingNewModels.has(key)) {
    pendingNewModels.add(key);
  }

  const pendingSamples = pendingSamplesByModel.get(key) ?? [];
  pendingSamples.push(sample);
  if (pendingSamples.length > 50) {
    pendingSamplesByModel.set(key, pendingSamples.slice(-50));
  } else {
    pendingSamplesByModel.set(key, pendingSamples);
  }
}

export function flushTelemetryBuffer(): Promise<void> {
  return flushBuffer();
}

if (typeof globalThis.__dbTelemetryFlusherStarted === "undefined") {
  globalThis.__dbTelemetryFlusherStarted = true;
  startFlusher();
}

declare global {
  var __dbTelemetryFlusherStarted: boolean | undefined;
}

// ─── Read API ─────────────────────────────────────────────────────────────────

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

      const [globalStats, models] = await Promise.all([
        withTimeout(redis.hgetall(globalKey), 1500) as Promise<Record<
          string,
          string | number
        > | null>,
        withTimeout(redis.smembers(modelsKey), 1500) as Promise<string[]>,
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
        const samplesListsRaw = await withTimeout(pipeline.exec(), 1500);

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
