import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import type { TelemetryRecord } from "../types";
import { TelemetryPipeline } from "../pipeline";

const QUEUE_KEY = "worksphere:telemetry:queue";
const MAX_BATCH_SIZE = 100;
const FLUSH_INTERVAL_MS = 5_000;

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

async function flushFromRedis(targetBuffer: TelemetryRecord[]): Promise<void> {
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

    targetBuffer.push(JSON.parse(result) as TelemetryRecord);
    drained++;
  }
}

export const wifiTelemetryPipeline = new TelemetryPipeline<TelemetryRecord>({
  name: "wifi",
  batchSize: MAX_BATCH_SIZE,
  flushIntervalMs: FLUSH_INTERVAL_MS,
  batchHandler: async (records) => {
    try {
      const extraRedisRecords: TelemetryRecord[] = [];
      await flushFromRedis(extraRedisRecords);
      const allRecords = [...records, ...extraRedisRecords];
      await flushBatch(allRecords);
    } catch (error) {
      console.error("[wifiTelemetryCollector] DB flush failed, re-enqueuing:", error);
      const redis = getRedis();
      if (redis) {
        try {
          for (const record of records) {
            await redis.lpush(QUEUE_KEY, JSON.stringify(record));
          }
          return;
        } catch {
          console.error(
            "[wifiTelemetryCollector] Re-enqueue failed, records lost:",
            records.length,
          );
        }
      }
      throw error;
    }
  },
});

export async function enqueueTelemetry(record: TelemetryRecord): Promise<void> {
  const redis = getRedis();

  if (redis) {
    try {
      await redis.lpush(QUEUE_KEY, JSON.stringify(record));
      return;
    } catch (error) {
      console.error(
        "[wifiTelemetryCollector] Redis enqueue failed, falling back to pipeline:",
        error,
      );
    }
  }

  await wifiTelemetryPipeline.enqueue(record);
}

export function startTelemetryFlusher(): void {
  wifiTelemetryPipeline.startFlusher();
}

export function stopTelemetryFlusher(): void {
  void wifiTelemetryPipeline.stopFlusher();
}

export async function getTelemetryQueueDepth(): Promise<number> {
  const redis = getRedis();
  const pipelineDepth = wifiTelemetryPipeline.getQueueDepth();
  if (!redis) return pipelineDepth;

  try {
    const redisDepth = (await redis.llen(QUEUE_KEY)) as number;
    return redisDepth + pipelineDepth;
  } catch {
    return pipelineDepth;
  }
}

if (typeof globalThis.__telemetryFlusherStarted === "undefined") {
  globalThis.__telemetryFlusherStarted = true;
  startTelemetryFlusher();
}

declare global {
  var __telemetryFlusherStarted: boolean | undefined;
}
