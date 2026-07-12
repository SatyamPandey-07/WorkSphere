/**
 * Lightweight DB query latency telemetry.
 *
 * We deliberately do NOT log every query into the main analytics event
 * stream (src/lib/analytics.ts) — that would flood Redis/memory with one
 * event per Prisma call. Instead we keep a small in-memory rolling window
 * of recent query durations (per model) and expose aggregate stats
 * (avg / p95 / slow-query count) for the admin dashboard.
 */

const MAX_SAMPLES_PER_MODEL = 200;
const SLOW_QUERY_THRESHOLD_MS = 200;

type QuerySample = { durationMs: number; timestamp: number };

const samplesByModel = new Map<string, QuerySample[]>();
let slowQueryCount = 0;
let totalQueryCount = 0;

export function recordQueryDuration(model: string, durationMs: number) {
  totalQueryCount += 1;
  if (durationMs >= SLOW_QUERY_THRESHOLD_MS) slowQueryCount += 1;

  const key = model || "unknown";
  const samples = samplesByModel.get(key) ?? [];
  samples.push({ durationMs, timestamp: Date.now() });

  if (samples.length > MAX_SAMPLES_PER_MODEL) {
    samples.shift();
  }

  samplesByModel.set(key, samples);
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[index];
}

export function getDbLatencyStats() {
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