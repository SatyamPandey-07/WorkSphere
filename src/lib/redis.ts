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
  latencyMs: number;
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
  const redisClient = client !== undefined ? client : getRedis();

  if (!redisClient) {
    return {
      ok: false,
      latencyMs: -1,
      error: "Redis client is not configured or unavailable",
    };
  }

  const startTime = performance.now();
  let timer: NodeJS.Timeout | null = null;

  try {
    const pingPromise = (async () => {
      if (typeof redisClient.ping === "function") {
        return await redisClient.ping();
      }
      return "PONG";
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Redis ping timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    await Promise.race([pingPromise, timeoutPromise]);
    const latencyMs = Math.round(performance.now() - startTime);

    return {
      ok: true,
      latencyMs,
    };
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - startTime);
    const errorMessage =
      err instanceof Error ? err.message : String(err || "Unknown Redis ping error");

    return {
      ok: false,
      latencyMs,
      error: errorMessage,
    };
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }
}
