import { Redis } from "@upstash/redis";

type RedisGlobal = typeof globalThis & {
  __workSphereRedis?: Redis;
};

const globalForRedis = globalThis as RedisGlobal;
let redisInstance: Redis | null = null;

export function getRedis(): Redis | null {
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null;
  }

  if (process.env.NODE_ENV !== "production") {
    if (!globalForRedis.__workSphereRedis) {
      globalForRedis.__workSphereRedis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
    }

    return globalForRedis.__workSphereRedis;
  }

  if (!redisInstance) {
    redisInstance = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }

  return redisInstance;
}

export const redis = getRedis();

export const DEFAULT_REDIS_PING_TIMEOUT_MS = 2000;

export interface RedisPingOptions {
  /**
   * Maximum duration (in milliseconds) to wait for Redis to respond to a ping.
   * Defaults to 2000ms.
   */
  pingTimeoutMs?: number;
}

export interface RedisPingResult {
  ok: boolean;
  connected: boolean;
  latencyMs: number | null;
  latency?: number | null;
  error?: string;
}

/**
 * Diagnostic helper that pings Redis with an optional timeout bound.
 * Allows callers to detect stalled connections and fail fast.
 *
 * @param options Configuration options including optional pingTimeoutMs
 * @param client Optional custom Redis instance (defaults to shared getRedis() instance)
 * @returns RedisPingResult indicating success, latency, or error
 */
export async function pingRedisDiagnostic(
  options?: RedisPingOptions,
  client?: Redis | null
): Promise<RedisPingResult> {
  const timeoutMs = options?.pingTimeoutMs ?? DEFAULT_REDIS_PING_TIMEOUT_MS;
  let redisClient: Redis | null = null;

  try {
    redisClient = client !== undefined ? client : getRedis();
  } catch (err: unknown) {
    return {
      ok: false,
      connected: false,
      latencyMs: null,
      latency: null,
      error:
        err instanceof Error
          ? err.message
          : String(err || "Redis client initialization failed"),
    };
  }

  // Guard disconnected, unconfigured, or mocked clients missing a callable ping method
  if (!redisClient || typeof (redisClient as unknown as { ping?: unknown }).ping !== "function") {
    return {
      ok: false,
      connected: false,
      latencyMs: null,
      latency: null,
      error: "Redis client is not configured, disconnected, or unavailable",
    };
  }

  // Guard against clients with explicit disconnected or offline status
  const clientStatus = (redisClient as unknown as { status?: string }).status;
  if (
    clientStatus &&
    (clientStatus === "disconnecting" ||
      clientStatus === "close" ||
      clientStatus === "end" ||
      clientStatus === "offline")
  ) {
    return {
      ok: false,
      connected: false,
      latencyMs: null,
      latency: null,
      error: `Redis client is ${clientStatus}`,
    };
  }

  const startTime = typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
  let timer: NodeJS.Timeout | null = null;

  try {
    const pingPromise = Promise.resolve(redisClient.ping());

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Redis ping timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    await Promise.race([pingPromise, timeoutPromise]);
    const endTime = typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
    const duration = endTime - startTime;
    const latencyMs = Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : null;

    return {
      ok: true,
      connected: true,
      latencyMs,
      latency: latencyMs,
    };
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : String(err || "Unknown Redis ping error");

    return {
      ok: false,
      connected: false,
      latencyMs: null,
      latency: null,
      error: errorMessage,
    };
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }
}
