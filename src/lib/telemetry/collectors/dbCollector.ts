import { getRedis } from "@/lib/redis";
import type { DbQuerySample } from "../types";

const MAX_SAMPLES_PER_MODEL = 200;
const MAX_TOTAL_SAMPLES = 1_000;
const MAX_PENDING_SAMPLES = 1_000;
const SLOW_QUERY_THRESHOLD_MS = 200;
const FLUSH_INTERVAL_MS = 5_000;
const SAMPLE_DECAY_START = 0.5;
const CIRCUIT_BREAKER_THRESHOLD = 0.95;

type BufferedSample = { model: string; sample: DbQuerySample };

// A fixed-size global ring also bounds memory when model names are high-cardinality.
const samplesByModel = new Map<string, DbQuerySample[]>();
const sampleRing: Array<BufferedSample | undefined> = new Array(MAX_TOTAL_SAMPLES);
let sampleRingCursor = 0;
let sampleRingSize = 0;

let slowQueryCount = 0;
let totalQueryCount = 0;
let pendingGlobalTotal = 0;
let pendingGlobalSlow = 0;
let pendingSamples: BufferedSample[] = [];
let flushInFlight: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;

function getHeapPressure(): number {
  if (typeof process === "undefined" || typeof process.memoryUsage !== "function") return 0;
  try {
    const { heapUsed, heapTotal } = process.memoryUsage();
    if (heapTotal <= 0) return 0;
    return Math.min(1, Math.max(0, (heapUsed / heapTotal - 0.6) / 0.38));
  } catch {
    return 0;
  }
}

function getBufferPressure(): number {
  return Math.max(pendingSamples.length / MAX_PENDING_SAMPLES, getHeapPressure());
}

/** Detailed samples decay smoothly under load; aggregate counters remain exact. */
function getDetailedSampleRate(): number {
  const pressure = getBufferPressure();
  if (pressure <= SAMPLE_DECAY_START) return 1;
  if (pressure >= CIRCUIT_BREAKER_THRESHOLD) return 0;

  const progress = (pressure - SAMPLE_DECAY_START) /
    (CIRCUIT_BREAKER_THRESHOLD - SAMPLE_DECAY_START);
  return Math.max(0, 1 - 0.9 * progress * progress);
}

export function getDbTelemetryBufferStatus() {
  const pressure = getBufferPressure();
  return {
    inMemorySamples: sampleRingSize,
    maxInMemorySamples: MAX_TOTAL_SAMPLES,
    pendingSamples: pendingSamples.length,
    maxPendingSamples: MAX_PENDING_SAMPLES,
    sampleRate: getDetailedSampleRate(),
    circuitBreakerOpen: pressure >= CIRCUIT_BREAKER_THRESHOLD,
  };
}

function addInMemorySample(model: string, sample: DbQuerySample): void {
  if (sampleRingSize === MAX_TOTAL_SAMPLES) {
    const oldest = sampleRing[sampleRingCursor];
    if (oldest) {
      const oldModelSamples = samplesByModel.get(oldest.model);
      if (oldModelSamples) {
        const oldIndex = oldModelSamples.indexOf(oldest.sample);
        if (oldIndex >= 0) oldModelSamples.splice(oldIndex, 1);
        if (oldModelSamples.length === 0) samplesByModel.delete(oldest.model);
      }
    }
  } else {
    sampleRingSize += 1;
  }

  sampleRing[sampleRingCursor] = { model, sample };
  sampleRingCursor = (sampleRingCursor + 1) % MAX_TOTAL_SAMPLES;

  const modelSamples = samplesByModel.get(model) ?? [];
  modelSamples.push(sample);
  if (modelSamples.length > MAX_SAMPLES_PER_MODEL) modelSamples.shift();
  samplesByModel.set(model, modelSamples);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
    promise.then((val) => {
      clearTimeout(timer);
      resolve(val);
    }).catch((err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function flushBuffer(): Promise<void> {
  if (flushInFlight) return flushInFlight;

  const runFlush = async (): Promise<void> => {
    if (pendingGlobalTotal === 0 && pendingSamples.length === 0) return;

    const redis = getRedis();
    if (!redis) {
      pendingGlobalTotal = 0;
      pendingGlobalSlow = 0;
      pendingSamples = [];
      return;
    }

    const globalTotal = pendingGlobalTotal;
    const globalSlow = pendingGlobalSlow;
    const samplesSnapshot = pendingSamples.slice();
    const groupedSamples = new Map<string, DbQuerySample[]>();

    for (const entry of samplesSnapshot) {
      const modelSamples = groupedSamples.get(entry.model) ?? [];
      modelSamples.push(entry.sample);
      groupedSamples.set(entry.model, modelSamples);
    }

    try {
      const pipeline = redis.pipeline();
      const globalKey = "worksphere:telemetry:global";
      const modelsKey = "worksphere:telemetry:models";

      if (globalTotal > 0) pipeline.hincrby(globalKey, "totalQueryCount", globalTotal);
      if (globalSlow > 0) pipeline.hincrby(globalKey, "slowQueryCount", globalSlow);

      for (const [model, samples] of groupedSamples) {
        pipeline.sadd(modelsKey, model);
        const samplesKey = `worksphere:telemetry:samples:${model}`;
        for (const sample of samples) pipeline.lpush(samplesKey, JSON.stringify(sample));
        pipeline.ltrim(samplesKey, 0, MAX_SAMPLES_PER_MODEL - 1);
      }

      await withTimeout(pipeline.exec(), 3000);

      pendingGlobalTotal = Math.max(0, pendingGlobalTotal - globalTotal);
      pendingGlobalSlow = Math.max(0, pendingGlobalSlow - globalSlow);
      const flushedSamples = new Set(samplesSnapshot);
      pendingSamples = pendingSamples.filter((entry) => !flushedSamples.has(entry));
    } catch (error) {
      console.error("[dbTelemetry] Redis batch flush failed:", error);
    }
  };

  flushInFlight = runFlush().finally(() => { flushInFlight = null; });
  return flushInFlight;
}

function startFlusher(): void {
  if (flushTimer || typeof window !== "undefined") return;
  flushTimer = setInterval(() => {
    flushBuffer().catch((error) => {
      console.error("[dbTelemetry] Unhandled flush error:", error);
    });
  }, FLUSH_INTERVAL_MS);
  if (flushTimer.unref) flushTimer.unref();
}

export function recordQueryDuration(model: string, durationMs: number) {
  totalQueryCount += 1;
  if (durationMs >= SLOW_QUERY_THRESHOLD_MS) slowQueryCount += 1;

  pendingGlobalTotal += 1;
  if (durationMs >= SLOW_QUERY_THRESHOLD_MS) pendingGlobalSlow += 1;

  const sampleRate = getDetailedSampleRate();
  if (sampleRate <= 0 || pendingSamples.length >= MAX_PENDING_SAMPLES) return;
  if (Math.random() >= sampleRate) return;

  const key = model || "unknown";
  const sample = { durationMs, timestamp: Date.now() };
  addInMemorySample(key, sample);
  pendingSamples.push({ model: key, sample });
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

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function getDbLatencyStatsSync() {
  const allDurations: number[] = [];
  const byModel: Array<{ model: string; avgMs: number; p95Ms: number; sampleCount: number }> = [];

  for (const [model, samples] of samplesByModel.entries()) {
    const durations = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
    allDurations.push(...durations);
    byModel.push({
      model,
      avgMs: Math.round(durations.reduce((sum, duration) => sum + duration, 0) / (durations.length || 1)),
      p95Ms: Math.round(percentile(durations, 95)),
      sampleCount: durations.length,
    });
  }

  allDurations.sort((a, b) => a - b);
  return {
    totalQueryCount,
    slowQueryCount,
    slowQueryThresholdMs: SLOW_QUERY_THRESHOLD_MS,
    avgMs: Math.round(allDurations.reduce((sum, duration) => sum + duration, 0) / (allDurations.length || 1)),
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
        withTimeout(redis.hgetall(globalKey), 1500) as Promise<Record<string, string | number> | null>,
        withTimeout(redis.smembers(modelsKey), 1500) as Promise<string[]>,
      ]);

      const redisTotalQueryCount = globalStats ? Number(globalStats.totalQueryCount || 0) : 0;
      const redisSlowQueryCount = globalStats ? Number(globalStats.slowQueryCount || 0) : 0;
      const byModel: Array<{ model: string; avgMs: number; p95Ms: number; sampleCount: number }> = [];
      const allDurations: number[] = [];

      if (models && models.length > 0) {
        const pipeline = redis.pipeline();
        for (const model of models) pipeline.lrange(`worksphere:telemetry:samples:${model}`, 0, -1);
        const samplesListsRaw = await withTimeout(pipeline.exec(), 1500);

        for (let index = 0; index < models.length; index += 1) {
          const model = models[index];
          const rawSamples = samplesListsRaw[index] as any[];
          if (!rawSamples || rawSamples.length === 0) continue;

          const durations = rawSamples.map((raw) => {
            try {
              const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
              return typeof parsed?.durationMs === "number" ? parsed.durationMs : null;
            } catch {
              return null;
            }
          }).filter((duration): duration is number => duration !== null).sort((a, b) => a - b);

          if (durations.length === 0) continue;
          allDurations.push(...durations);
          byModel.push({
            model,
            avgMs: Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length),
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
        avgMs: Math.round(allDurations.reduce((sum, duration) => sum + duration, 0) / (allDurations.length || 1)),
        p95Ms: Math.round(percentile(allDurations, 95)),
        byModel: byModel.sort((a, b) => b.avgMs - a.avgMs),
      };
    } catch (error) {
      console.error("[dbTelemetry] Redis read failed, falling back to in-memory:", error);
    }
  }

  return getDbLatencyStatsSync();
}
