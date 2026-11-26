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

let latestRedisPingLatencyMs: number | null = null;

export async function pingRedis(): Promise<number | null> {
  if (!redis || typeof redis.ping !== "function") {
    latestRedisPingLatencyMs = null;
    return null;
  }

  const startTime = performance.now();
  try {
    await redis.ping();
    const pingMs = Math.round(performance.now() - startTime);
    latestRedisPingLatencyMs =
      Number.isFinite(pingMs) && pingMs >= 0 ? pingMs : null;
    return latestRedisPingLatencyMs;
  } catch {
    latestRedisPingLatencyMs = null;
    throw new Error("Redis ping failed");
  }
}

export function getRedisPingLatency(): number | null {
  return Number.isFinite(latestRedisPingLatencyMs) &&
    latestRedisPingLatencyMs !== null &&
    latestRedisPingLatencyMs >= 0
    ? latestRedisPingLatencyMs
    : null;
}
