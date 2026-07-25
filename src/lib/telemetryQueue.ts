import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";

const QUEUE_KEY = "worksphere:telemetry:queue";
const FLUSH_INTERVAL_MS = 5_000;
const MAX_BATCH_SIZE = 100;

export interface TelemetryRecord {
  venueId: string;
  download: number;
  upload: number;
  latency: number;
  crowdLevel: string;
  timestamp: string;
}

let flushTimer: ReturnType<typeof setInterval> | null = null;
let memoryBuffer: TelemetryRecord[] = [];

export async function enqueueTelemetry(record: TelemetryRecord): Promise<void> {
  const redis = getRedis();

  if (redis) {
    try {
      await redis.lpush(QUEUE_KEY, JSON.stringify(record));
      return;
    } catch (error) {
      console.error(
        "[telemetryQueue] Redis enqueue failed, falling back to memory:",
        error,
      );
    }
  }

  memoryBuffer.push(record);
  if (memoryBuffer.length > MAX_BATCH_SIZE * 10) {
    memoryBuffer = memoryBuffer.slice(-MAX_BATCH_SIZE * 10);
  }
}

async function flushBatch(records: TelemetryRecord[]): Promise<void> {
  if (records.length === 0) return;

  await prisma.wifiTelemetry.createMany({
    data: records.map((r) => ({
      venueId: r.venueId,
      download: r.download,
      upload: r.upload,
      latency: r.latency,
      crowdLevel: r.crowdLevel,
      timestamp: new Date(r.timestamp),
    })),
    skipDuplicates: true,
  });
}

async function flushFromRedis(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  let drained = 0;

  while (drained < MAX_BATCH_SIZE) {
    const result = (await redis.lmove(
      QUEUE_KEY,
      "worksphere:telemetry:processing",
      "right",
      "left",
    )) as string | null;

    if (!result) break;

    memoryBuffer.push(JSON.parse(result) as TelemetryRecord);
    drained++;
  }
}

async function flushTelemetryQueue(): Promise<void> {
  try {
    await flushFromRedis();
  } catch (error) {
    console.error("[telemetryQueue] Redis drain failed:", error);
  }

  const batch = memoryBuffer.splice(0, MAX_BATCH_SIZE);
  if (batch.length === 0) return;

  try {
    await flushBatch(batch);
  } catch (error) {
    console.error("[telemetryQueue] DB flush failed, re-enqueuing:", error);
    const redis = getRedis();
    if (redis) {
      try {
        for (const record of batch) {
          await redis.lpush(QUEUE_KEY, JSON.stringify(record));
        }
      } catch {
        console.error(
          "[telemetryQueue] Re-enqueue failed, records lost:",
          batch.length,
        );
      }
    }
  }
}

export function startTelemetryFlusher(): void {
  if (flushTimer) return;

  flushTimer = setInterval(() => {
    flushTelemetryQueue().catch((error) => {
      console.error("[telemetryQueue] Unhandled flush error:", error);
    });
  }, FLUSH_INTERVAL_MS);

  if (flushTimer.unref) {
    flushTimer.unref();
  }
}

export function stopTelemetryFlusher(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }

  if (memoryBuffer.length > 0) {
    flushBatch([...memoryBuffer]).catch((error) => {
      console.error("[telemetryQueue] Final flush failed:", error);
    });
    memoryBuffer = [];
  }
}

export async function getTelemetryQueueDepth(): Promise<number> {
  const redis = getRedis();
  if (!redis) return memoryBuffer.length;

  try {
    const redisDepth = (await redis.llen(QUEUE_KEY)) as number;
    return redisDepth + memoryBuffer.length;
  } catch {
    return memoryBuffer.length;
  }
}

if (typeof globalThis.__telemetryFlusherStarted === "undefined") {
  globalThis.__telemetryFlusherStarted = true;
  startTelemetryFlusher();
}

declare global {
  var __telemetryFlusherStarted: boolean | undefined;
}
