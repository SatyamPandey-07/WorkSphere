import { getRedis } from "@/lib/redis";
import { WebhookEvent } from "./schemas";

// Resolved lazily so importing this module never throws when Redis is not configured.
function requireRedis() {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is not configured");
  return redis;
}
const WEBHOOK_QUEUE_KEY = "work-sphere:webhook-events-queue";
const WEBHOOK_PROCESSING_QUEUE_KEY = "work-sphere:webhook-events-processing";

export const EventBus = {
  /**
   * Emits an internal system event. This event will be pushed to a Redis queue.
   * A background worker or cron job should consume this queue to dispatch webhooks.
   */
  emit: async (event: Omit<WebhookEvent, "id" | "timestamp">) => {
    try {
      const fullEvent: WebhookEvent = {
        ...event,
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      };

      // Push to the background queue (left push)
      await requireRedis().lpush(WEBHOOK_QUEUE_KEY, JSON.stringify(fullEvent));

      console.log(`[EventBus] Emitted event ${fullEvent.type} to queue.`);
    } catch (error) {
      console.error("[EventBus] Failed to emit event:", error);
      // We do not throw to avoid failing the main user request when event logging fails
    }
  },

  /**
   * Helper function for the worker to pop events from the queue reliably
   */
  popEvent: async (): Promise<WebhookEvent | null> => {
    try {
      // Pop from the right side of the list and push to the processing list
      const raw = await requireRedis().lmove(
        WEBHOOK_QUEUE_KEY,
        WEBHOOK_PROCESSING_QUEUE_KEY,
        "right",
        "left",
      );
      if (!raw) return null;

      let parsedObj;
      if (typeof raw === "string") {
        parsedObj = JSON.parse(raw);
      } else {
        parsedObj = raw;
      }
      return parsedObj as WebhookEvent;
    } catch (error) {
      console.error("[EventBus] Failed to pop event:", error);
      return null;
    }
  },

  /**
   * Acknowledge and remove successfully processed event from the processing queue
   */
  ackEvent: async (event: WebhookEvent) => {
    try {
      await requireRedis().lrem(
        WEBHOOK_PROCESSING_QUEUE_KEY,
        1,
        JSON.stringify(event),
      );
    } catch (error) {
      console.error("[EventBus] Failed to acknowledge event:", error);
    }
  },

  /**
   * Recover stale/abandoned webhook events from the processing queue
   */
  recoverStaleEvents: async () => {
    try {
      const processingEvents = await requireRedis().lrange(
        WEBHOOK_PROCESSING_QUEUE_KEY,
        0,
        -1,
      );
      if (!processingEvents || processingEvents.length === 0) return;

      const now = Date.now();
      const STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

      for (const eventStr of processingEvents) {
        if (!eventStr) continue;
        try {
          const event = JSON.parse(eventStr) as WebhookEvent;
          const eventTime = new Date(event.timestamp).getTime();
          const age = now - eventTime;

          if (age > STALE_TIMEOUT_MS) {
            console.log(
              `[EventBus] Webhook event ${event.id} is stale (age: ${Math.round(age / 1000)}s). Re-queuing...`,
            );
            await requireRedis().lpush(WEBHOOK_QUEUE_KEY, eventStr);
            await requireRedis().lrem(
              WEBHOOK_PROCESSING_QUEUE_KEY,
              1,
              eventStr,
            );
          }
        } catch (err) {
          console.error("[EventBus] Error parsing stale event:", eventStr, err);
        }
      }
    } catch (error) {
      console.error("[EventBus] Failed to recover stale events:", error);
    }
  },
};
