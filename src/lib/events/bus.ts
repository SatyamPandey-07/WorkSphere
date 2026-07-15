import { Redis } from "@upstash/redis";
import { WebhookEvent } from "./schemas";

// The redis instance will automatically pick up UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN from env
const redis = Redis.fromEnv();
const WEBHOOK_QUEUE_KEY = "work-sphere:webhook-events-queue";

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
      await redis.lpush(WEBHOOK_QUEUE_KEY, JSON.stringify(fullEvent));

      console.log(`[EventBus] Emitted event ${fullEvent.type} to queue.`);
    } catch (error) {
      console.error("[EventBus] Failed to emit event:", error);
      // We do not throw to avoid failing the main user request when event logging fails
    }
  },

  /**
   * Helper function for the worker to pop events from the queue
   */
  popEvent: async (): Promise<{ event: WebhookEvent; raw: string } | null> => {
    try {
      // Pop from the right side of the list and push to processing queue
      const raw = await redis.lmove(
        WEBHOOK_QUEUE_KEY,
        `${WEBHOOK_QUEUE_KEY}:processing`,
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
      return {
        event: parsedObj as WebhookEvent,
        raw: typeof raw === "string" ? raw : JSON.stringify(raw),
      };
    } catch (error) {
      console.error("[EventBus] Failed to pop event:", error);
      return null;
    }
  },

  /**
   * Acknowledge successful processing of an event
   */
  ackEvent: async (raw: string) => {
    try {
      await redis.lrem(`${WEBHOOK_QUEUE_KEY}:processing`, 1, raw);
    } catch (error) {
      console.error("[EventBus] Failed to ack event:", error);
    }
  },

  /**
   * Recover stuck events from the processing queue back to the main queue
   */
  recoverEvents: async (): Promise<number> => {
    try {
      let recovered = 0;
      while (true) {
        const raw = await redis.lmove(
          `${WEBHOOK_QUEUE_KEY}:processing`,
          WEBHOOK_QUEUE_KEY,
          "right",
          "left",
        );
        if (!raw) break;
        recovered++;
      }
      if (recovered > 0) {
        console.log(`[EventBus] Recovered ${recovered} stuck events`);
      }
      return recovered;
    } catch (error) {
      console.error("[EventBus] Failed to recover events:", error);
      return 0;
    }
  },
};
