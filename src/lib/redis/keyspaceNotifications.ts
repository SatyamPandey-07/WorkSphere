/**
 * Redis Keyspace Notifications for Desk & Seat Reservations
 *
 * Implements a high-performance pub/sub subscriber that monitors Redis keyspace/keyevent
 * notifications (specifically `__keyevent@*__:expired` and `__keyspace@*__:*`).
 * When an atomic desk reservation countdown timer reaches 0 and its Redis key expires,
 * this listener intercepts the expiration event, identifies the venue and desk, and
 * atomically broadcasts the release to connected clients via EventBus, SSE, and WebSockets.
 */

import { publishVenueAvailability } from "@/lib/reservations/event-bus";
import Redis from "ioredis";

export interface ParsedReservationKey {
  valid: boolean;
  prefix: string;
  venueId: string;
  deskId: string;
  seatId: string;
  rawKey: string;
}

export interface DeskReservationExpiredEvent {
  venueId: string;
  deskId: string;
  seatId: string;
  rawKey: string;
  timestamp: number;
  source: "redis_keyspace" | "in_memory_simulation";
}

type ExpiryListener = (event: DeskReservationExpiredEvent) => void | Promise<void>;

/**
 * Parses Redis key patterns used for seat and desk reservation holds.
 * Supported patterns:
 * - `seat:hold:${venueId}:${seatId}`
 * - `desk:hold:${venueId}:${deskId}`
 * - `desk:reservation:${venueId}:${deskId}`
 */
export function parseReservationKey(rawKey: string): ParsedReservationKey {
  if (typeof rawKey !== "string") {
    return { valid: false, prefix: "", venueId: "", deskId: "", seatId: "", rawKey: "" };
  }

  // Handle keys that might include Redis keyspace prefixes like `__keyspace@0__:seat:hold:...`
  let cleanKey = rawKey;
  const keyspacePrefixIdx = cleanKey.indexOf(":");
  if (cleanKey.startsWith("__keyspace@") || cleanKey.startsWith("__keyevent@")) {
    cleanKey = cleanKey.slice(keyspacePrefixIdx + 1);
  }

  const parts = cleanKey.split(":");
  if (parts.length >= 4 && parts[0] === "seat" && parts[1] === "hold") {
    const venueId = parts[2];
    const seatId = parts.slice(3).join(":");
    return {
      valid: true,
      prefix: "seat:hold",
      venueId,
      deskId: seatId,
      seatId,
      rawKey,
    };
  }

  if (parts.length >= 4 && parts[0] === "desk" && (parts[1] === "hold" || parts[1] === "reservation")) {
    const venueId = parts[2];
    const deskId = parts.slice(3).join(":");
    return {
      valid: true,
      prefix: `desk:${parts[1]}`,
      venueId,
      deskId,
      seatId: deskId,
      rawKey,
    };
  }

  return { valid: false, prefix: "", venueId: "", deskId: "", seatId: "", rawKey };
}

export class RedisKeyspaceNotificationManager {
  private static instance: RedisKeyspaceNotificationManager | null = null;
  private subscriberClient: Redis | null = null;
  private adminClient: Redis | null = null;
  private isSubscribed = false;
  private isConnecting = false;
  private listeners = new Set<ExpiryListener>();

  // In-memory fallback simulation for local dev or offline mode
  private simulatedTimers = new Map<string, { timer: NodeJS.Timeout; expiresAt: number; event: DeskReservationExpiredEvent }>();

  public static getInstance(): RedisKeyspaceNotificationManager {
    if (!RedisKeyspaceNotificationManager.instance) {
      RedisKeyspaceNotificationManager.instance = new RedisKeyspaceNotificationManager();
    }
    return RedisKeyspaceNotificationManager.instance;
  }

  /**
   * Subscribes a listener to desk reservation expiration notifications.
   * Returns an unsubscribe function.
   */
  public onDeskReservationExpired(listener: ExpiryListener): () => void {
    this.listeners.add(listener);
    this.ensureInitialized().catch((err) => {
      console.warn("[RedisKeyspace] Failed to initialize live Redis subscriber, using fallback:", err);
    });

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Registers a desk reservation countdown timer with the manager.
   * Ensures that even if the Redis connection or keyspace notifications are delayed,
   * the expiration is guaranteed to be handled atomically.
   */
  public registerDeskTimer(
    venueId: string,
    deskId: string,
    expiresAt: number,
  ): void {
    const key = `seat:hold:${venueId}:${deskId}`;
    const now = Date.now();
    const delayMs = Math.max(0, expiresAt - now);

    // Clear any existing simulated timer for this key
    this.clearSimulatedTimer(key);

    const event: DeskReservationExpiredEvent = {
      venueId,
      deskId,
      seatId: deskId,
      rawKey: key,
      timestamp: expiresAt,
      source: "in_memory_simulation",
    };

    const timer = setTimeout(() => {
      this.simulatedTimers.delete(key);
      this.dispatchExpiration(event);
    }, delayMs);

    this.simulatedTimers.set(key, { timer, expiresAt, event });
  }

  /**
   * Clears a registered desk reservation countdown timer (e.g. on manual release or checkout).
   */
  public unregisterDeskTimer(venueId: string, deskId: string): void {
    const key = `seat:hold:${venueId}:${deskId}`;
    this.clearSimulatedTimer(key);
  }

  private clearSimulatedTimer(key: string): void {
    const existing = this.simulatedTimers.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      this.simulatedTimers.delete(key);
    }
  }

  /**
   * Broadcasts the desk hold expiration event to all registered in-process listeners
   * and dispatches a live availability event to connected clients.
   */
  public dispatchExpiration(event: DeskReservationExpiredEvent): void {
    // 1. Notify event bus for SSE / live streams
    try {
      publishVenueAvailability(event.venueId, {
        type: "DESK_HOLD_EXPIRED",
        seatId: event.seatId,
        deskId: event.deskId,
        source: event.source,
        timestamp: event.timestamp,
      });
    } catch (err) {
      console.error("[RedisKeyspace] Failed to publish availability event:", err);
    }

    // 2. Notify all registered in-process listeners
    for (const listener of this.listeners) {
      try {
        void listener(event);
      } catch (err) {
        console.error("[RedisKeyspace] Expiry listener error:", err);
      }
    }
  }

  /**
   * Initializes Redis subscriber connection and configures keyspace notifications.
   */
  public async ensureInitialized(): Promise<void> {
    if (this.isSubscribed || this.isConnecting) return;
    this.isConnecting = true;

    const redisUrl =
      process.env.REDIS_URL ||
      process.env.UPSTASH_REDIS_URL ||
      (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_URL.startsWith("redis")
        ? process.env.UPSTASH_REDIS_REST_URL
        : null);

    if (!redisUrl) {
      this.isConnecting = false;
      return;
    }

    try {
      this.subscriberClient = new Redis(redisUrl, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        retryStrategy(times) {
          if (times > 3) return null; // stop reconnecting if down
          return Math.min(times * 100, 1000);
        },
      });

      this.adminClient = new Redis(redisUrl, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      });

      this.subscriberClient.on("error", (err) => {
        console.warn("[RedisKeyspace] Subscriber connection error (falling back to timer simulation):", err.message);
      });

      this.adminClient.on("error", (err) => {
        console.warn("[RedisKeyspace] Admin connection error:", err.message);
      });

      await Promise.all([
        this.subscriberClient.connect().catch(() => {}),
        this.adminClient.connect().catch(() => {}),
      ]);

      // Enable Redis keyspace notifications for expired events (Ex) if permitted
      if (this.adminClient.status === "ready") {
        try {
          await this.adminClient.config("SET", "notify-keyspace-events", "Ex");
        } catch {
          // Cloud Redis providers like Upstash may restrict CONFIG SET; ignore
        }
      }

      if (this.subscriberClient.status === "ready") {
        // Subscribe to keyspace notifications across databases
        await this.subscriberClient.psubscribe("__keyevent@*__:expired");

        this.subscriberClient.on("pmessage", (_pattern, channel, message) => {
          // message is the expired key name
          const parsed = parseReservationKey(message);
          if (parsed.valid) {
            // Cancel simulated timer since live Redis notification arrived
            this.clearSimulatedTimer(parsed.rawKey);

            this.dispatchExpiration({
              venueId: parsed.venueId,
              deskId: parsed.deskId,
              seatId: parsed.seatId,
              rawKey: message,
              timestamp: Date.now(),
              source: "redis_keyspace",
            });
          }
        });

        this.isSubscribed = true;
      }
    } catch (err: any) {
      console.warn("[RedisKeyspace] Live keyspace subscription unavailable, continuing with memory fallback:", err?.message || err);
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Resets all state and active timers (for test isolation).
   */
  public reset(): void {
    for (const [key, item] of this.simulatedTimers.entries()) {
      clearTimeout(item.timer);
    }
    this.simulatedTimers.clear();
    this.listeners.clear();
  }
}

export function getRedisKeyspaceManager(): RedisKeyspaceNotificationManager {
  return RedisKeyspaceNotificationManager.getInstance();
}

export function onDeskReservationExpired(listener: ExpiryListener): () => void {
  return getRedisKeyspaceManager().onDeskReservationExpired(listener);
}

