import { getRedis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import type { WebhookEventType } from "@prisma/client";
import { WebhookEvent } from "./schemas";

// Kept for compatibility with older workers and operational tooling.
function requireRedis() {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is not configured");
  return redis;
}
const WEBHOOK_QUEUE_KEY = "work-sphere:webhook-events-queue";
const WEBHOOK_PROCESSING_QUEUE_KEY = "work-sphere:webhook-events-processing";

export const EventBus = {
  /**
   * Persist events to the database outbox. The worker reads this durable source
   * of truth, so enqueueing does not depend on Redis being configured or online.
   */
  emit: async (event: Omit<WebhookEvent, "id" | "timestamp">) => {
    const fullEvent: WebhookEvent = {
      ...event,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
    try {
      await prisma.webhookOutboxEvent.create({
        data: {
          id: fullEvent.id,
          userId: fullEvent.userId,
          eventType: fullEvent.type as WebhookEventType,
          data: fullEvent.data,
          state: "PENDING",
          nextAttemptAt: new Date(),
        },
      });
      return fullEvent;
    } catch (error) {
      console.error("[EventBus] Failed to persist webhook event:", error);
      // Preserve the non-blocking contract of existing producers.
      return null;
    }
  },

  /** Legacy Redis queue pop helper retained during migration. */
  popEvent: async (): Promise<WebhookEvent | null> => {
    try {
      const raw = await requireRedis().lmove(
        WEBHOOK_QUEUE_KEY,
        WEBHOOK_PROCESSING_QUEUE_KEY,
        "right",
        "left",
      );
      if (!raw) return null;
      return (typeof raw === "string" ? JSON.parse(raw) : raw) as WebhookEvent;
    } catch (error) {
      console.error("[EventBus] Failed to pop legacy event:", error);
      return null;
    }
  },

  /** Legacy Redis acknowledgement helper. */
  ackEvent: async (event: WebhookEvent | string) => {
    try {
      const redis = requireRedis();
      const eventStr = typeof event === "string" ? event : JSON.stringify(event);
      const removed = await redis.lrem(WEBHOOK_PROCESSING_QUEUE_KEY, 1, eventStr);
      if (removed === 0 && typeof event !== "string" && event?.id) {
        const processingEvents = await redis.lrange(WEBHOOK_PROCESSING_QUEUE_KEY, 0, -1);
        for (const item of processingEvents) {
          if (!item) continue;
          try {
            const parsed = typeof item === "string" ? JSON.parse(item) : item;
            if (parsed?.id === event.id) {
              await redis.lrem(WEBHOOK_PROCESSING_QUEUE_KEY, 1, item);
              break;
            }
          } catch {}
        }
      }
    } catch (error) {
      console.error("[EventBus] Failed to acknowledge legacy event:", error);
    }
  },

  /** Legacy Redis recovery helper. Database outbox events are lease-recovered by the worker. */
  recoverStaleEvents: async () => {
    try {
      const redis = requireRedis();
      const processingEvents = await redis.lrange(WEBHOOK_PROCESSING_QUEUE_KEY, 0, -1);
      if (!processingEvents?.length) return;
      const now = Date.now();
      for (const eventStr of processingEvents) {
        if (!eventStr) continue;
        try {
          const event = JSON.parse(eventStr) as WebhookEvent;
          if (now - new Date(event.timestamp).getTime() > 5 * 60 * 1000) {
            await redis.lpush(WEBHOOK_QUEUE_KEY, eventStr);
            await redis.lrem(WEBHOOK_PROCESSING_QUEUE_KEY, 1, eventStr);
          }
        } catch (error) {
          console.error("[EventBus] Error recovering legacy event:", error);
        }
      }
    } catch (error) {
      // Redis is optional after the database outbox migration.
      if (process.env.NODE_ENV !== "test") {
        console.warn("[EventBus] Legacy Redis recovery unavailable:", error);
      }
    }
  },
};
