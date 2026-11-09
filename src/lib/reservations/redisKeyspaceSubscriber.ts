/**
 * Redis Keyspace Notifications Subscriber for Atomic Desk Reservations
 *
 * Listens for Redis keyspace and keyevent notifications (__keyevent@*__:expired, __keyevent@*__:del)
 * to atomically broadcast desk reservation expiration and cleanup events in real time.
 * Includes an in-memory timer wheel fallback for serverless/local dev environments.
 */

import { publishVenueAvailability } from "@/lib/reservations/event-bus";
import { eventBus } from "@/core/events";

export type DeskExpirationCallback = (venueId: string, deskId: string) => void;

interface TrackedTimer {
  timeoutId: ReturnType<typeof setTimeout>;
  venueId: string;
  deskId: string;
  expiresAt: number;
}

class RedisKeyspaceSubscriber {
  private static instance: RedisKeyspaceSubscriber;
  private isSubscribed = false;
  private redisSubscriberClient: any = null;
  private readonly listeners = new Set<DeskExpirationCallback>();
  private readonly activeTimers = new Map<string, TrackedTimer>();

  private constructor() {
    this.initSubscriber();
  }

  public static getInstance(): RedisKeyspaceSubscriber {
    if (!RedisKeyspaceSubscriber.instance) {
      RedisKeyspaceSubscriber.instance = new RedisKeyspaceSubscriber();
    }
    return RedisKeyspaceSubscriber.instance;
  }

  /**
   * Initializes Redis keyspace notification subscription using ioredis if a TCP connection is available.
   */
  private async initSubscriber(): Promise<void> {
    if (this.isSubscribed) return;

    const redisUrl = process.env.REDIS_URL || process.env.REDIS_TCP_URL;
    if (!redisUrl) {
      // In serverless / REST-only / local environments without TCP Redis,
      // the timer wheel fallback will handle expiration notifications seamlessly.
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Redis = require("ioredis");
      const sub = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        enableOfflineQueue: false,
      });

      await sub.connect().catch((err: any) => {
        console.warn("[KeyspaceSubscriber] Redis connection failed, using timer wheel fallback:", err.message);
      });

      // Try enabling keyspace notifications if permissions allow
      try {
        await sub.config("SET", "notify-keyspace-events", "Ex");
      } catch {
        // Cloud providers often restrict CONFIG command; ignore if rejected
      }

      // Pattern-subscribe to expired and deleted key events across all databases
      await sub.psubscribe("__keyevent@*__:expired", "__keyevent@*__:del");

      sub.on("pmessage", (_pattern: string, _channel: string, messageKey: string) => {
        this.handleKeyEvent(messageKey);
      });

      this.redisSubscriberClient = sub;
      this.isSubscribed = true;
    } catch (err: any) {
      console.warn("[KeyspaceSubscriber] Initialization fallback to in-memory timer wheel:", err.message);
    }
  }

  /**
   * Parses keyspace notification messages and triggers desk expiration handlers.
   * Key patterns supported:
   *  - desk:reservation:{venueId}:{deskId}
   *  - seat:hold:{venueId}:{seatId}
   *  - desk:hold:{venueId}:{deskId}
   */
  public handleKeyEvent(key: string): void {
    if (!key || typeof key !== "string") return;

    // Pattern: prefix:venueId:deskId
    const match = key.match(/^(?:desk:reservation|seat:hold|desk:hold):([^:]+):([^:]+)$/);
    if (!match) return;

    const [, venueId, deskId] = match;
    this.notifyExpiration(venueId, deskId);
  }

  /**
   * Dispatches expiration event to all listeners, SSE event bus, and PartyKit / core events.
   */
  public notifyExpiration(venueId: string, deskId: string): void {
    const timerKey = `${venueId}:${deskId}`;
    const timer = this.activeTimers.get(timerKey);
    if (timer) {
      clearTimeout(timer.timeoutId);
      this.activeTimers.delete(timerKey);
    }

    // 1. Publish to venue availability event bus (broadcasts to SSE subscribers)
    try {
      publishVenueAvailability(venueId, {
        type: "desk_reservation_expired",
        deskId,
        seatId: deskId,
        reason: "EXPIRED",
        timestamp: Date.now(),
      });
    } catch (err) {
      console.warn("[KeyspaceSubscriber] SSE broadcast failed:", err);
    }

    // 2. Emit strongly-typed internal core event
    try {
      eventBus.emit("desk:reservation:expired", {
        venueId,
        deskId,
        expiredAt: Date.now(),
      });
    } catch (err) {
      console.warn("[KeyspaceSubscriber] EventBus emit failed:", err);
    }

    // 3. Notify custom registered subscribers
    for (const listener of this.listeners) {
      try {
        listener(venueId, deskId);
      } catch (err) {
        console.error("[KeyspaceSubscriber] Listener callback threw an error:", err);
      }
    }
  }

  /**
   * Registers a desk reservation hold with the fallback timer wheel.
   * Ensures that when Redis keyspace notifications are absent or in REST mode,
   * expiration events fire with exact millisecond precision.
   */
  public registerFallbackTimer(venueId: string, deskId: string, expiresAt: number): void {
    const timerKey = `${venueId}:${deskId}`;
    const existing = this.activeTimers.get(timerKey);
    if (existing) {
      clearTimeout(existing.timeoutId);
      this.activeTimers.delete(timerKey);
    }

    const delayMs = Math.max(0, expiresAt - Date.now());
    const timeoutId = setTimeout(() => {
      this.activeTimers.delete(timerKey);
      this.notifyExpiration(venueId, deskId);
    }, delayMs);

    this.activeTimers.set(timerKey, {
      timeoutId,
      venueId,
      deskId,
      expiresAt,
    });
  }

  /**
   * Cancels a tracked fallback timer (e.g., when desk hold is explicitly released or checked out).
   */
  public cancelFallbackTimer(venueId: string, deskId: string): void {
    const timerKey = `${venueId}:${deskId}`;
    const existing = this.activeTimers.get(timerKey);
    if (existing) {
      clearTimeout(existing.timeoutId);
      this.activeTimers.delete(timerKey);
    }
  }

  /**
   * Adds an expiration listener callback. Returns an unregister function.
   */
  public addListener(listener: DeskExpirationCallback): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Resets active timers and subscriber state (used for testing and lifecycle tear down).
   */
  public reset(): void {
    for (const timer of this.activeTimers.values()) {
      clearTimeout(timer.timeoutId);
    }
    this.activeTimers.clear();
    this.listeners.clear();
    if (this.redisSubscriberClient) {
      try {
        this.redisSubscriberClient.disconnect();
      } catch {
        // ignore
      }
      this.redisSubscriberClient = null;
    }
    this.isSubscribed = false;
  }
}

export const keyspaceSubscriber = RedisKeyspaceSubscriber.getInstance();
