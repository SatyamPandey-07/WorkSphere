import { Redis } from '@upstash/redis';
import { WebhookEvent } from './schemas';

// The redis instance will automatically pick up UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN from env
const redis = Redis.fromEnv();
const WEBHOOK_QUEUE_KEY = 'work-sphere:webhook-events-queue';

export const EventBus = {
  /**
   * Emits an internal system event. This event will be pushed to a Redis queue.
   * A background worker or cron job should consume this queue to dispatch webhooks.
   */
  emit: async (event: Omit<WebhookEvent, 'id' | 'timestamp'>) => {
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
      console.error('[EventBus] Failed to emit event:', error);
      // We do not throw to avoid failing the main user request when event logging fails
    }
  },

  /**
   * Helper function for the worker to pop events from the queue
   */
  popEvent: async (): Promise<WebhookEvent | null> => {
    try {
      // Pop from the right side of the list
      const raw = await redis.rpop(WEBHOOK_QUEUE_KEY);
      if (!raw) return null;
      
      let parsedObj;
      if (typeof raw === 'string') {
        parsedObj = JSON.parse(raw);
      } else {
        parsedObj = raw;
      }
      return parsedObj as WebhookEvent;
    } catch (error) {
      console.error('[EventBus] Failed to pop event:', error);
      return null;
    }
  }
};
